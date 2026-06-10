defmodule BackendWeb.Plugs.RequireAuth do
  @moduledoc """
  Halts the request with 401 unless the `Authorization: Bearer <token>`
  header resolves to an active `Backend.Accounts.User`. Two paths:

    1. **Session token** (Phoenix.Token from laptop login) — primary.
    2. **Device token** (DB-backed, paired phone/tablet) — fallback.
       Lets the mobile shell hit normal API endpoints without
       reimplementing every controller.

  On success assigns `:current_user`, `:current_token`, and (when the
  device-token path matched) `:current_device`.
  """

  import Plug.Conn
  alias Backend.{Accounts, Devices}
  alias BackendWeb.Errors

  def init(opts), do: opts

  def call(conn, _opts) do
    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] -> authenticate(conn, token)
      _ -> deny(conn)
    end
  end

  defp authenticate(conn, token) do
    case Accounts.verify_token(token) do
      {:ok, %{is_active: true} = user} ->
        conn
        |> assign(:current_user, user)
        |> assign(:current_token, token)

      _ ->
        case Devices.authenticate_token(token) do
          {:ok, {device, %{is_active: true} = user}} ->
            conn
            |> assign(:current_user, user)
            |> assign(:current_token, token)
            |> assign(:current_device, device)

          _ ->
            deny(conn)
        end
    end
  end

  defp deny(conn) do
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
