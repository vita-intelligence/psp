defmodule BackendWeb.Presence do
  @moduledoc """
  Tracks which authenticated users are currently connected over the
  realtime socket. Backed by Phoenix.Presence (BEAM CRDT).

  Keyed by user id (string) → meta map. A user with two tabs open
  produces two entries under the same key, so we count keys not metas
  when answering "who's online".
  """

  use Phoenix.Presence,
    otp_app: :backend,
    pubsub_server: Backend.PubSub

  @doc """
  Set of user ids currently online in the given tenant's lobby. The
  lobby topic is sharded per company (`lobby:<company_id>`), so
  callers must pass their `company_id` — a naked `list("lobby")` is
  now empty because the topic has been split.
  """
  def list_online_user_ids(company_id) when is_integer(company_id) do
    list("lobby:#{company_id}")
    |> Map.keys()
    |> Enum.map(fn id ->
      case Integer.parse(to_string(id)) do
        {n, _} -> n
        :error -> id
      end
    end)
    |> MapSet.new()
  end
end
