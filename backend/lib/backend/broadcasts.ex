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

    :ok
  end

  def entity_changed(_entity, _id, _company_id, _action), do: :ok

  defp id_string(id) when is_binary(id), do: id
  defp id_string(id) when is_integer(id), do: Integer.to_string(id)
  defp id_string(_), do: nil
end
