defmodule BackendWeb.RawMaterialController do
  @moduledoc """
  Per-item raw-material compliance + risk + allergen attachment.
  All nested under the item resource so RBAC and entity scoping flow
  through the parent.

  Routes:
    * `PUT /api/items/:uuid/raw-material-compliance` — upsert the
      compliance row. RBAC `items.edit`.
    * `PUT /api/items/:uuid/raw-material-risk`       — upsert the
      risk scorecard. RBAC `risk_assessments.create`. Overrides
      require `risk_assessments.approve` (enforced inline).
    * `PUT /api/items/:uuid/allergens`                — full-replace
      the allergen list. RBAC `items.edit`.
  """

  use BackendWeb, :controller

  alias Backend.{Items, RawMaterials, RBAC}
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "items.edit" when action in [:upsert_compliance, :set_allergens]
  plug RequirePermission, "risk_assessments.create" when action in [:upsert_risk]

  action_fallback BackendWeb.FallbackController

  def upsert_compliance(conn, %{"item_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = item <- Items.get_for_company(actor.company_id, uuid),
         :ok <- ensure_raw_material(item),
         {:ok, row} <-
           RawMaterials.upsert_compliance(
             actor,
             item,
             Map.drop(params, ["item_id", "id"])
           ) do
      json(conn, %{compliance: Payloads.raw_material_compliance(row)})
    else
      nil ->
        {:error, :not_found}

      {:error, :wrong_type} ->
        send_error(
          conn,
          :unprocessable_entity,
          "wrong_item_type",
          "Compliance can only be set on raw-material items. This item is #{item_type_label(actor, uuid)}."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def upsert_risk(conn, %{"item_id" => uuid} = params) do
    actor = conn.assigns.current_user

    # The override gate is enforced inline rather than as a plug
    # because the gate only fires when the user is actually
    # overriding — basic scorecard edits use create perm only.
    is_overriding =
      params["overridden_overall_level"] not in [nil, ""]

    cond do
      is_overriding and not RBAC.has_permission?(actor, "risk_assessments.approve") ->
        send_error(
          conn,
          :forbidden,
          "missing_permission",
          "Overriding the computed risk level needs the `risk_assessments.approve` permission."
        )

      true ->
        with %{} = item <- Items.get_for_company(actor.company_id, uuid),
             :ok <- ensure_raw_material(item),
             {:ok, row} <-
               RawMaterials.upsert_risk(
                 actor,
                 item,
                 Map.drop(params, ["item_id", "id"])
               ) do
          json(conn, %{risk: Payloads.raw_material_risk(row)})
        else
          nil ->
            {:error, :not_found}

          {:error, :wrong_type} ->
            send_error(
              conn,
              :unprocessable_entity,
              "wrong_item_type",
              "Risk assessments only apply to raw-material items."
            )

          {:error, %Ecto.Changeset{} = cs} ->
            changeset_error(conn, cs)
        end
    end
  end

  def set_allergens(conn, %{"item_id" => uuid} = params) do
    actor = conn.assigns.current_user
    uuids = List.wrap(params["allergen_uuids"])

    with %{} = item <- Items.get_for_company(actor.company_id, uuid),
         :ok <- ensure_raw_material(item),
         {:ok, _} <- RawMaterials.set_allergens(actor, item, uuids) do
      allergens = RawMaterials.list_allergens(item.id)
      json(conn, %{allergens: Enum.map(allergens, &Payloads.allergen/1)})
    else
      nil ->
        {:error, :not_found}

      {:error, :wrong_type} ->
        send_error(
          conn,
          :unprocessable_entity,
          "wrong_item_type",
          "Allergens only apply to raw-material items."
        )

      _ ->
        send_error(
          conn,
          :unprocessable_entity,
          "allergen_update_failed",
          "Couldn't update the allergen list. Try again."
        )
    end
  end

  defp ensure_raw_material(%{item_type: "raw_material"}), do: :ok
  defp ensure_raw_material(_), do: {:error, :wrong_type}

  defp item_type_label(actor, uuid) do
    case Items.get_for_company(actor.company_id, uuid) do
      %{item_type: type} -> String.replace(type, "_", " ")
      _ -> "another type"
    end
  end

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
