defmodule BackendWeb.FinishedProductController do
  @moduledoc """
  Per-item finished-product specification.

  Routes:
    * `PUT /api/items/:uuid/finished-product-spec` — upsert the spec.
      RBAC `items.edit`. Item must be of type `finished_product`.
  """

  use BackendWeb, :controller

  alias Backend.{FinishedProducts, Items}
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "items.edit"

  action_fallback BackendWeb.FallbackController

  def upsert(conn, %{"item_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, uuid),
         :ok <- ensure_finished_product(item),
         {:ok, row} <-
           FinishedProducts.upsert(
             actor,
             item,
             Map.drop(params, ["item_id", "id"])
           ) do
      json(conn, %{finished_product_spec: Payloads.finished_product_spec(row)})
    else
      nil ->
        {:error, :not_found}

      {:error, :wrong_type} ->
        send_error(
          conn,
          :unprocessable_entity,
          "wrong_item_type",
          "Finished-product spec only applies to finished-product items."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  defp ensure_finished_product(%{item_type: "finished_product"}), do: :ok
  defp ensure_finished_product(_), do: {:error, :wrong_type}

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
