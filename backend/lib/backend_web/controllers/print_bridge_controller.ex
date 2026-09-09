defmodule BackendWeb.PrintBridgeController do
  @moduledoc """
  Phone → laptop bridge.

  Broadcasts two kinds of user-driven cross-device events on the
  actor's ``user:<uuid>`` Phoenix channel; ``<PrintBridgeListener />``
  in the FE root layout subscribes on the laptop session and reacts.

  We always broadcast to the *actor's* user — the phone can't trigger
  a print or a navigation on someone else's laptop.

  ## ``print_label`` event

  Body shape (loose — the FE owns the payload schema and the laptop
  knows how to interpret each ``kind``):

      {
        "kind": "quarantine_pack" | "stock_lot" | "three_pl_dispatch",
        "payload": { … }
      }

  ``stock_lot`` — regular lot label from the mobile lot detail page
  (post-inspection, on the pending-put-away shelf).

  ``three_pl_dispatch`` — customer-scoped 3PL order label that
  travels with the parcel from Move → Paperwork → Pickup → Confirm
  → Return. QR encodes ``/scan/three-pl/<dispatch_uuid>`` so a
  scan from any paired phone lands on the current lifecycle stage.

  ## ``open_url`` event

  Body:

      {
        "path": "/procurement/inspections/<uuid>",
        "title": "QC review · Inspection #12"
      }

  Path is validated:

    * Must begin with ``/`` (relative to the same origin).
    * No protocol (``://``) or protocol-relative (``//``) — blocks
      external redirect via a stolen socket.
    * No path traversal (``..``).

  The laptop listener pops a small confirmation dialog naming the
  actor + target, and on click navigates the current tab to the
  path. Used by the mobile QC review to bounce the operator to the
  desktop detail page (which has the full editable surface) without
  making them copy-paste a URL.
  """

  use BackendWeb, :controller

  alias BackendWeb.Endpoint

  @allowed_kinds ~w(quarantine_pack stock_lot three_pl_dispatch)

  def print_label(conn, %{"kind" => kind, "payload" => payload})
      when kind in @allowed_kinds and is_map(payload) do
    user = conn.assigns.current_user

    Endpoint.broadcast!("user:#{user.uuid}", "print_label", %{
      "kind" => kind,
      "payload" => payload,
      "actor" => %{"uuid" => user.uuid, "name" => user.name}
    })

    conn |> put_status(:ok) |> json(%{ok: true})
  end

  def print_label(conn, _params) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{detail: "Missing or unsupported kind/payload.", code: "bad_request"})
  end

  @doc """
  Push a same-origin navigation to the actor's laptop session so the
  operator can bounce from mobile back to a desktop page (typically
  the QC edit surface). Same broadcast channel as ``print_label``,
  different event name so the listener can dispatch cleanly.
  """
  def open_url(conn, %{"path" => path} = params) when is_binary(path) do
    with :ok <- validate_open_url_path(path) do
      user = conn.assigns.current_user
      title = params["title"] |> case do
        s when is_binary(s) -> String.slice(String.trim(s), 0, 120)
        _ -> ""
      end

      Endpoint.broadcast!("user:#{user.uuid}", "open_url", %{
        "path" => path,
        "title" => title,
        "actor" => %{"uuid" => user.uuid, "name" => user.name}
      })

      conn |> put_status(:ok) |> json(%{ok: true})
    else
      {:error, :unsafe_path} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          detail: "Path must be a same-origin absolute route (e.g. \"/procurement/...\").",
          code: "unsafe_path"
        })
    end
  end

  def open_url(conn, _params) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{detail: "Missing path.", code: "bad_request"})
  end

  # Same shape as ``Backend.Devices.validate_navigate_path/1`` but
  # broader — the phone-to-laptop bridge can point at any internal
  # route (not just ``/m/*`` — that guard exists on
  # push-navigate-to-device because the target IS the phone). Here
  # the target is the laptop, and the laptop is expected to reach
  # every part of the app.
  defp validate_open_url_path(path) do
    cond do
      not String.starts_with?(path, "/") -> {:error, :unsafe_path}
      # ``//`` at the start is a protocol-relative URL — resolves to
      # https://<attacker>. Reject.
      String.starts_with?(path, "//") -> {:error, :unsafe_path}
      # Absolute URL somewhere in the path — reject any protocol
      # scheme sneaking in via a mistyped ``path`` field.
      String.contains?(path, "://") -> {:error, :unsafe_path}
      # Path traversal.
      String.contains?(path, "..") -> {:error, :unsafe_path}
      true -> :ok
    end
  end
end
