defmodule BackendWeb.PrintBridgeController do
  @moduledoc """
  Phone → laptop print bridge.

  The mobile inspection wizard's quarantine-label step posts here to
  ask the operator's laptop to pop a print dialog. We broadcast the
  payload on the operator's `user:<uuid>` channel; `<PrintBridgeListener />`
  in the FE root layout subscribes and pops the dialog pre-filled with
  the pack metadata.

  Authenticated via the standard `:api_authed` pipeline so both the
  device bearer (paired phone) and the session bearer (laptop) work.
  We always broadcast to the *actor's* user — the phone can't trigger
  a print on someone else's laptop.

  Body shape (loose — the FE owns the payload schema and the laptop
  knows how to interpret each `kind`):

      {
        "kind": "quarantine_pack",
        "payload": { … }
      }
  """

  use BackendWeb, :controller

  alias BackendWeb.Endpoint

  @allowed_kinds ~w(quarantine_pack)

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
end
