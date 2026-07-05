defmodule BackendWeb.ProfileController do
  use BackendWeb, :controller

  alias Backend.{Accounts, SecurityLog}
  alias BackendWeb.{Errors, Payloads}

  action_fallback BackendWeb.FallbackController

  def update(conn, params) do
    user = conn.assigns.current_user

    case Accounts.update_profile(user, params) do
      {:ok, updated} ->
        json(conn, %{user: user_payload(updated)})

      {:error, %Ecto.Changeset{} = cs} ->
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

  def change_password(conn, params) do
    user = conn.assigns.current_user
    remote_ip = SecurityLog.remote_ip(conn)

    case Accounts.change_password(user, params) do
      {:ok, updated} ->
        SecurityLog.record(:password_changed,
          user_id: user.id,
          email: user.email,
          remote_ip: remote_ip
        )

        # `password_changeset` bumps `token_version` on success —
        # every previously-issued session token for this user now
        # fails verification. Recording it explicitly makes that
        # side effect visible in the log.
        SecurityLog.record(:sessions_revoked,
          user_id: user.id,
          reason: :password_change,
          remote_ip: remote_ip
        )

        # Return a token minted against the NEW token_version so the
        # caller stays signed in on the current device. Without this,
        # the request that just changed the password succeeds but
        # every follow-up 401s until the user logs in again.
        fresh_token = Accounts.sign_token(updated)
        json(conn, %{ok: true, token: fresh_token})

      {:error, %Ecto.Changeset{} = cs} ->
        # Track failed change attempts — a wrong current password
        # here is a compromised session probing, or a benign typo.
        # Aggregating rate lets ops distinguish.
        SecurityLog.record(:password_changed,
          user_id: user.id,
          email: user.email,
          remote_ip: remote_ip,
          reason: :validation_failed
        )

        # Surface the field-level errors (e.g. current_password "is
        # incorrect") so the form can highlight the right input.
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "validation_failed",
            "Couldn't change your password — check the fields below.",
            Errors.changeset_fields(cs)
          )
        )
    end
  end

  defp user_payload(user), do: Payloads.user(user)

  @doc """
  User self-service "log out other devices". Bumps the user's
  `token_version`, invalidating every prior session token, and
  hands back a fresh token so the caller stays signed in on the
  current device.
  """
  def revoke_other_sessions(conn, _params) do
    user = conn.assigns.current_user
    remote_ip = SecurityLog.remote_ip(conn)

    {:ok, updated, fresh_token} = Accounts.revoke_other_sessions(user)

    SecurityLog.record(:sessions_revoked,
      user_id: updated.id,
      email: updated.email,
      remote_ip: remote_ip,
      reason: :self_revoke_other_devices
    )

    json(conn, %{token: fresh_token, user: Payloads.user(updated)})
  end
end
