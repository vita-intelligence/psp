defmodule BackendWeb.ProfileController do
  use BackendWeb, :controller

  alias Backend.Accounts
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

    case Accounts.change_password(user, params) do
      {:ok, _updated} ->
        json(conn, %{ok: true})

      {:error, %Ecto.Changeset{} = cs} ->
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
end
