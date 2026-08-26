defmodule Backend.Broadcasts do
  @moduledoc """
  Fire-and-forget entity-changed broadcasts for list-page + detail-page
  realtime refresh.

  Two topic shapes, both tenant-scoped:

    * `entity:<name>:<company_id>` — list-scoped. Every subscriber of
      the "shipments" list in a given company hears every insert /
      update / delete / state transition on any shipment in that
      company, and re-fetches. Cheap because the payload is a hint,
      not the row — the FE re-runs its existing SSR fetch.

    * `entity:<name>:<company_id>:<uuid>` — detail-scoped, optional.
      For cross-entity cascades (e.g. a lot edit that a shipment
      detail page cares about). Wire only where the FE actually
      subscribes; leaving it broadcast-without-listener is harmless.

  Called from context modules right after a successful write. Fully
  synchronous (Phoenix.PubSub is in-process); no retry, no queue —
  a lost broadcast at worst delays the FE by one manual refresh,
  which is the pre-realtime baseline.
  """

  alias BackendWeb.Endpoint

  @doc """
  Broadcast a list-scoped change. `entity` is the kebab-case entity
  name matching the FE's `useEntityChannel(entity, ...)` argument
  (e.g. "shipment", "purchase-order", "manufacturing-order"). `action`
  is a short verb — the FE doesn't act on it today but future filters
  (e.g. skip refresh on "commented") can key off it.
  """
  def entity_changed(entity, id, company_id, action \\ "changed")
      when is_binary(entity) and is_integer(company_id) do
    payload = %{
      "entity" => entity,
      "id" => id_string(id),
      "action" => to_string(action),
      "at" => DateTime.utc_now() |> DateTime.to_iso8601()
    }

    Endpoint.broadcast!("entity:#{entity}:#{company_id}", "changed", payload)

    if is_binary(id) do
      Endpoint.broadcast!(
        "entity:#{entity}:#{company_id}:#{id}",
        "changed",
        payload
      )
    end

    # Portal notification hook — every MO state change (pickup start /
    # complete, preflight sign, run start / complete, closeout, final
    # release, output QC, etc.) needs to invalidate the customer portal
    # roadmap so the website + NPD portal reflect "picking → in
    # production → closeout" in real time. Task.start inside the
    # helper so a downed NPD never blocks the local mutation.
    #
    # Same-shape hook exists for POs / invoices via
    # `Backend.Purchasing.tap_notify_cos_for_po/1` — that path predates
    # this centralised hook. Migration deferred to avoid churn.
    maybe_notify_customer_orders(entity, id)

    :ok
  end

  def entity_changed(_entity, _id, _company_id, _action), do: :ok

  # Only MO broadcasts need the CO fan-out today. Kept as a case so
  # adding new entities (e.g. shipment → CO for dispatch stage) is a
  # one-clause change without touching every callsite in the codebase.
  defp maybe_notify_customer_orders("manufacturing-order", uuid) when is_binary(uuid) do
    Task.start(fn ->
      case Backend.Repo.get_by(Backend.Production.ManufacturingOrder, uuid: uuid) do
        %Backend.Production.ManufacturingOrder{id: id} ->
          Backend.OrderWizard.notify_cos_for_mo(id)

        _ ->
          :ok
      end
    end)

    :ok
  end

  defp maybe_notify_customer_orders(_entity, _id), do: :ok

  defp id_string(id) when is_binary(id), do: id
  defp id_string(id) when is_integer(id), do: Integer.to_string(id)
  defp id_string(_), do: nil
end
