defmodule BackendWeb.PackagingController do
  @moduledoc """
  Per-item packaging compliance.

  Routes:
    * `PUT /api/items/:uuid/packaging-compliance` — upsert. RBAC
      `items.edit`. Item must be type `packaging`.
  """

  use BackendWeb, :controller

  alias Backend.{Items, Packaging}
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "items.edit"

  action_fallback BackendWeb.FallbackController

  def upsert(conn, %{"item_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, uuid),
         :ok <- ensure_packaging(item),
         {:ok, row} <-
           Packaging.upsert(actor, item, Map.drop(params, ["item_id", "id"])) do
      json(conn, %{packaging_compliance: Payloads.packaging_compliance(row)})
    else
      nil ->
        {:error, :not_found}

      {:error, :wrong_type} ->
        send_error(
          conn,
          :unprocessable_entity,
          "wrong_item_type",
          "Packaging compliance only applies to packaging items."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  defp ensure_packaging(%{item_type: "packaging"}), do: :ok
  defp ensure_packaging(_), do: {:error, :wrong_type}

  defp changeset_error(conn, cs) do
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

  defp send_error(conn, status, code, detail) do
    conn
    |> put_status(status)
    |> json(Errors.payload(code, detail))
  end
end
