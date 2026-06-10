defmodule BackendWeb.LinkedDeviceController do
  @moduledoc """
  HTTP surface for device pairing + management.

  Public:
    * `GET  /api/devices/pairing-codes/:code`  (validate-before-show)
    * `POST /api/devices/claim`                (mobile exchanges code → token)

  Session-authed (the user managing their own devices from a laptop):
    * `GET    /api/devices`
    * `POST   /api/devices/pairing-codes`
    * `DELETE /api/devices/:uuid`
    * `POST   /api/devices/:uuid/ping`

  Following the profile-controller precedent, device management requires
  only an authenticated session — there's no separate RBAC perm because
  the user is always acting on their own row (scoping is enforced by
  `Backend.Devices.get_for_user/2`).
  """

  use BackendWeb, :controller

  alias Backend.Devices
  alias BackendWeb.Errors
  alias BackendWeb.Payloads

  action_fallback BackendWeb.FallbackController

  # ----- public --------------------------------------------------------

  def lookup_pairing_code(conn, %{"code" => code}) do
    case Devices.lookup_pairing_code(code) do
      {:ok, pairing} ->
        json(conn, %{pairing: Payloads.device_pairing_code(pairing)})

      {:error, :not_found} ->
        not_found(conn, "code_not_found", "That pairing code wasn't found.")

      {:error, :expired} ->
        gone(conn, "code_expired", "This pairing code has expired. Generate a new one.")

      {:error, :already_used} ->
        gone(conn, "code_used", "This pairing code has already been used.")
    end
  end

  def claim(conn, params) do
    attrs = %{
      code: params["code"],
      label: params["label"],
      platform: params["platform"],
      user_agent: get_req_header(conn, "user-agent") |> List.first()
    }

    case Devices.claim_pairing_code(attrs) do
      {:ok, %{device: device, token: token}} ->
        # Eager-load the user so the mobile shell can render the
        # "Connected as X" header without a second round trip — the
        # device-token-authed /api/auth/me path isn't wired yet, and
        # the FE has no other way to identify itself post-claim.
        user = Backend.Repo.get!(Backend.Accounts.User, device.user_id)

        conn
        |> put_status(:created)
        |> json(%{
          device: Payloads.linked_device(device),
          token: token,
          user: Payloads.user(user)
        })

      {:error, :invalid_code} ->
        unprocessable(
          conn,
          "invalid_code",
          "That pairing code isn't valid. Generate a fresh one from your computer."
        )

      {:error, :expired} ->
        gone(conn, "code_expired", "This pairing code has expired. Try again with a fresh one.")

      {:error, :already_used} ->
        gone(conn, "code_used", "This pairing code has already been used.")

      {:error, %Ecto.Changeset{} = cs} ->
        validation_error(conn, cs)
    end
  end

  # ----- authed --------------------------------------------------------

  def index(conn, _params) do
    actor = conn.assigns.current_user
    devices = Devices.list_for_user(actor)

    json(conn, %{items: Enum.map(devices, &Payloads.linked_device/1)})
  end

  def create_pairing_code(conn, _params) do
    actor = conn.assigns.current_user

    case Devices.create_pairing_code(actor) do
      {:ok, pairing} ->
        conn
        |> put_status(:created)
        |> json(%{pairing: Payloads.device_pairing_code(pairing)})

      {:error, :code_generation_exhausted} ->
        conn
        |> put_status(:service_unavailable)
        |> json(Errors.payload(
          "code_generation_failed",
          "Couldn't generate a unique pairing code. Try again."
        ))

      {:error, %Ecto.Changeset{} = cs} ->
        validation_error(conn, cs)
    end
  end

  def revoke(conn, %{"uuid" => uuid}) do
    actor = conn.assigns.current_user

    case Devices.revoke(actor, uuid) do
      {:ok, device} ->
        json(conn, %{device: Payloads.linked_device(device)})

      {:error, :not_found} ->
        not_found(conn, "device_not_found", "Device not found.")

      {:error, %Ecto.Changeset{} = cs} ->
        validation_error(conn, cs)
    end
  end

  def ping(conn, %{"uuid" => uuid} = params) do
    actor = conn.assigns.current_user
    message = params["message"] || "Ping from your laptop"

    case Devices.send_ping(actor, uuid, message) do
      {:ok, _device} ->
        send_resp(conn, :no_content, "")

      {:error, :not_found} ->
        not_found(conn, "device_not_found", "Device not found.")
    end
  end

  # ----- helpers -------------------------------------------------------

  defp not_found(conn, code, detail) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload(code, detail))
  end

  defp gone(conn, code, detail) do
    conn
    |> put_status(:gone)
    |> json(Errors.payload(code, detail))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail))
  end

  defp validation_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload(
        "validation_failed",
        "Please correct the highlighted fields.",
        Errors.changeset_fields(cs)
      )
    )
  end
end
