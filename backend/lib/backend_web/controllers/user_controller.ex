defmodule BackendWeb.UserController do
  use BackendWeb, :controller

  alias Backend.Accounts
  alias BackendWeb.Presence

  def index(conn, _params) do
    online_ids = Presence.list_online_user_ids()

    users =
      Accounts.list_users()
      |> Enum.map(fn u ->
        %{
          id: u.id,
          email: u.email,
          name: u.name,
          avatar: u.avatar,
          is_active: u.is_active,
          is_online: MapSet.member?(online_ids, u.id),
          inserted_at: u.inserted_at
        }
      end)

    json(conn, %{users: users})
  end
end
