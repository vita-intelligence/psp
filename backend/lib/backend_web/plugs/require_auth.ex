defmodule BackendWeb.Plugs.RequireAuth do
  @moduledoc """
  Halts the request with 401 unless the `Authorization: Bearer <token>`
  header decodes to an active `Backend.Accounts.User`. On success
  assigns `:current_user` and `:current_token` for downstream consumers.
  """

  import Plug.Conn
  alias Backend.Accounts
  alias BackendWeb.Errors

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, %{is_active: true} = user} <- Accounts.verify_token(token) do
      conn
      |> assign(:current_user, user)
      |> assign(:current_token, token)
    else
      _ ->
        body =
          Errors.payload(
            "unauthorized",
            "Your session has expired. Please sign in again."
          )

        conn
        |> put_resp_content_type("application/json")
        |> send_resp(401, Jason.encode!(body))
        |> halt()
    end
  end
end
