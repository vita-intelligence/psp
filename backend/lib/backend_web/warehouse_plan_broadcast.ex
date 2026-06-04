defmodule BackendWeb.WarehousePlanBroadcast do
  @moduledoc """
  Fan-out helper for the warehouse plan channel.

  Mutations on floors and storage locations go through `Plans.*` and
  reply over HTTP — this module is the side-channel that tells every
  other tab joined to the same warehouse "the truth in the DB just
  moved." Peers then refetch via the existing REST endpoints.

  Topic: `plan:warehouse:<warehouse_uuid>` (matches
  `BackendWeb.WarehousePlanChannel`).

  Event: `floor:invalidated` with a small JSON payload:

      %{
        floor_uuid: "…",       # nil-safe; absent for warehouse-wide
        by_user_id: 42,        # so the local tab can ignore its own
        kind: "floor_saved" | "floor_added" | "floor_deleted"
              | "location_added" | "location_updated"
              | "location_deleted"
      }
  """

  alias BackendWeb.Endpoint

  @event "floor:invalidated"

  @doc """
  Broadcast an invalidation event to every peer in the warehouse's
  plan channel. Accepts either a `%Warehouse{}` or the bare UUID
  string for ergonomic call sites.

  Opts:
    * `:actor` — `%User{}` whose mutation triggered this. Defaults
      to `nil` (e.g. background job). The user_id ends up in the
      payload so the originating tab can skip the round-trip.
    * `:kind` — semantic event label; see module doc.
  """
  def invalidate(warehouse_or_uuid, floor_uuid, opts \\ []) do
    uuid = uuid_for(warehouse_or_uuid)
    if uuid, do: do_broadcast(uuid, floor_uuid, opts)
    :ok
  end

  defp do_broadcast(warehouse_uuid, floor_uuid, opts) do
    actor = Keyword.get(opts, :actor)
    kind = Keyword.get(opts, :kind, "floor_saved")

    Endpoint.broadcast("plan:warehouse:#{warehouse_uuid}", @event, %{
      floor_uuid: floor_uuid,
      by_user_id: if(actor, do: actor.id, else: nil),
      kind: kind
    })
  end

  defp uuid_for(%{uuid: uuid}) when is_binary(uuid), do: uuid
  defp uuid_for(uuid) when is_binary(uuid), do: uuid
  defp uuid_for(_), do: nil
end
