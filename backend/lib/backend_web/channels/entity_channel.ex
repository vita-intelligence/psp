defmodule BackendWeb.EntityChannel do
  @moduledoc """
  Per-entity, per-tenant realtime hint channel. Topic shape:

      entity:<name>:<company_id>              # list-scoped
      entity:<name>:<company_id>:<uuid>       # detail-scoped

  Subscribers receive `"changed"` events emitted from
  `Backend.Broadcasts.entity_changed/4` and use them as a signal to
  re-run their SSR fetch + invalidate their DataTable cache. The
  payload is intentionally thin — a hint, not the row.

  Auth rule: the joining socket's `current_user.company_id` must
  match the `<company_id>` in the topic. Blocks cross-tenant
  eavesdropping (an editor in company A joining `entity:shipment:1`
  when they're in company 2).
  """

  use BackendWeb, :channel

  @impl true
  def join("entity:" <> rest, _params, socket) do
    with {:ok, _entity, company_id} <- parse_topic(rest),
         %{company_id: user_company_id} <- socket.assigns[:current_user],
         true <- company_id == user_company_id do
      {:ok, socket}
    else
      _ -> {:error, %{reason: "forbidden"}}
    end
  end

  # `entity:<name>:<company_id>` or `entity:<name>:<company_id>:<uuid>`.
  # We only need the company_id to authorise the join; the detail
  # form's `<uuid>` is a suffix the broadcaster narrows on but the
  # channel itself doesn't care about it.
  defp parse_topic(rest) when is_binary(rest) do
    case String.split(rest, ":") do
      [entity, company_str] ->
        parse_company(entity, company_str)

      [entity, company_str, _uuid] ->
        parse_company(entity, company_str)

      _ ->
        :error
    end
  end

  defp parse_company(entity, company_str) do
    case Integer.parse(company_str) do
      {n, ""} when is_binary(entity) and entity != "" -> {:ok, entity, n}
      _ -> :error
    end
  end
end
