defmodule BackendWeb.AdminSecurityController do
  @moduledoc """
  Admin-only security actions. Panic-button endpoints an operator
  hits during an incident to boot compromised sessions.

  Auth:
    * `require_auth` — via the pipeline
    * `is_admin` — checked inline; there's no dedicated permission
      code because these actions are unusually broad (touching every
      session in a tenant) and the audit trail matters more than
      per-user delegation.

  All actions log a structured `SecurityLog` event with the actor,
  target, and remote IP so the response is provable after the fact.
  """

  use BackendWeb, :controller

  alias Backend.{Accounts, SecurityLog}
  alias BackendWeb.{Errors, Payloads}

  action_fallback BackendWeb.FallbackController

  plug :require_admin

  @doc """
  Revoke every outstanding session for one user in the actor's
  company. The target keeps their password — this is not a
  disciplinary action, just an "eject" from every device.

  Returns the updated user payload so the admin UI can refresh its
  local view without a follow-up fetch.
  """
  def revoke_user_sessions(conn, %{"uuid" => uuid}) do
    actor = conn.assigns.current_user
    remote_ip = SecurityLog.remote_ip(conn)

    with %{} = subject <- Accounts.get_user_by_uuid(uuid),
         true <- subject.company_id == actor.company_id,
         {:ok, updated} <- Accounts.revoke_sessions_for_user(subject) do
      SecurityLog.record(:sessions_revoked,
        user_id: updated.id,
        email: updated.email,
        actor_id: actor.id,
        actor_email: actor.email,
        remote_ip: remote_ip,
        reason: :admin_revoke
      )

      json(conn, %{user: Payloads.user(updated)})
    else
      nil -> {:error, :not_found}
      false -> {:error, :not_found}
    end
  end

  @doc """
  Company-wide nuclear option: increment `token_version` on every
  user in the actor's tenant. Every session token dies on the next
  request — including the caller's own. The response instructs the
  UI to redirect to /login.

  Only fires when the request body carries `{"confirm": "REVOKE_ALL"}`
  to make it hard to hit by accident.
  """
  def revoke_all_sessions(conn, %{"confirm" => "REVOKE_ALL"}) do
    actor = conn.assigns.current_user
    remote_ip = SecurityLog.remote_ip(conn)

    {count, _} = Accounts.revoke_all_sessions_for_company(actor.company_id)

    SecurityLog.record(:sessions_revoked,
      company_id: actor.company_id,
      actor_id: actor.id,
      actor_email: actor.email,
      remote_ip: remote_ip,
      count: count,
      reason: :admin_revoke_all
    )

    json(conn, %{revoked: count, next: "/login"})
  end

  def revoke_all_sessions(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(
      Errors.payload(
        "confirmation_required",
        "Send `{\"confirm\": \"REVOKE_ALL\"}` to trigger the company-wide revoke."
      )
    )
  end

  # --- plug --------------------------------------------------------

  defp require_admin(conn, _opts) do
    if conn.assigns.current_user.is_admin do
      conn
    else
      conn
      |> put_status(:forbidden)
      |> json(
        Errors.payload(
          "forbidden",
          "This action is admin-only."
        )
      )
      |> halt()
    end
  end
end
