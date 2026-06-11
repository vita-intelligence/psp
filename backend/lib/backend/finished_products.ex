defmodule Backend.FinishedProducts do
  @moduledoc """
  Boundary for the finished-product specification subtable.
  """

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Items.{FinishedProductSpec, Item}
  alias Backend.Repo

  @audit_fields ~w(regulatory_category dosage_form capsule_size tablet_size_mm powder_type serving_size serving_size_uom_id servings_per_pack net_quantity net_quantity_uom_id directions_of_use suggested_dosage warnings_text appearance disintegration_spec weight_uniformity_pct shelf_life_months storage_conditions food_contact_status active_claims general_claims nutrition_table target_markets spec_document_file_id may_contain_allergens may_contain_justification may_contain_assessed_at contaminant_limits_overrides)a

  def get(item_id) when is_integer(item_id) do
    Repo.get(FinishedProductSpec, item_id)
    |> case do
      nil ->
        nil

      row ->
        Repo.preload(row, [
          :serving_size_uom,
          :net_quantity_uom,
          :may_contain_assessed_by,
          :spec_document_file
        ])
    end
  end

  def upsert(%User{} = actor, %Item{} = item, attrs) do
    existing = Repo.get(FinishedProductSpec, item.id)
    before_state = existing && snapshot(existing)
    base = existing || %FinishedProductSpec{item_id: item.id}

    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("item_id", item.id)
      |> maybe_stamp_may_contain_assessor(actor, existing)

    changeset = FinishedProductSpec.changeset(base, attrs)

    case Repo.insert_or_update(changeset) do
      {:ok, row} ->
        after_state = snapshot(row)

        if before_state do
          Audit.record_updated(
            actor,
            "finished_product_spec",
            row,
            before_state,
            after_state
          )
        else
          Audit.record_created(
            actor,
            "finished_product_spec",
            row,
            after_state
          )
        end

        {:ok,
         Repo.preload(row, [
           :serving_size_uom,
           :net_quantity_uom,
           :may_contain_assessed_by,
           :spec_document_file
         ])}

      other ->
        other
    end
  end

  # When the user edits may_contain_* without explicitly naming an
  # assessor, attribute it to themselves so the audit trail captures
  # who flagged the cross-contamination warning.
  defp maybe_stamp_may_contain_assessor(attrs, actor, existing) do
    touched_may_contain =
      Map.has_key?(attrs, "may_contain_allergens") or
        Map.has_key?(attrs, "may_contain_justification")

    if touched_may_contain and
         not Map.has_key?(attrs, "may_contain_assessed_by_id") and
         (is_nil(existing) or is_nil(existing.may_contain_assessed_by_id)) do
      attrs
      |> Map.put("may_contain_assessed_by_id", actor.id)
      |> Map.put_new_lazy("may_contain_assessed_at", fn ->
        DateTime.utc_now() |> DateTime.truncate(:second)
      end)
    else
      attrs
    end
  end

  defp snapshot(%FinishedProductSpec{} = s),
    do: Map.new(@audit_fields, fn k -> {k, Map.get(s, k)} end)

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
