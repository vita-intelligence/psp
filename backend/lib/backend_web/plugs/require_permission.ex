defmodule BackendWeb.Plugs.RequirePermission do
  @moduledoc """
  Stops a request with 403 unless `current_user` holds the required
  permission code. Owner-role users bypass automatically.

  Usage from the router:

      pipeline :api_company_edit do
        plug :accepts, ["json"]
        plug BackendWeb.Plugs.RequireAuth
        plug BackendWeb.Plugs.RequirePermission, "company.edit"
      end

  Or inline inside a controller:

      plug BackendWeb.Plugs.RequirePermission, "company.edit" when action in [:update]
  """

  import Plug.Conn
  alias Backend.RBAC
  alias BackendWeb.Errors

  def init(code) when is_binary(code), do: code

  def call(conn, code) do
    user = conn.assigns[:current_user]

    if RBAC.has_permission?(user, code) do
      conn
    else
      body =
        Errors.payload(
          "forbidden",
          "You don't have permission to perform this action."
        )

      conn
      |> put_resp_content_type("application/json")
      |> send_resp(403, Jason.encode!(body))
      |> halt()
    end
  end
end
