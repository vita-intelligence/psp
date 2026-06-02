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

  def list_online_user_ids do
    list("lobby")
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
