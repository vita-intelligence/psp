defmodule Backend.RawMaterials do
  @moduledoc """
  Boundary for raw-material compliance + risk assessment + allergen
  attachment. The Items context handles the parent row; this context
  composes the per-type subtables in one transaction so an item save
  is atomic.

  Reads expose two preloadable assocs (`compliance`, `risk`) and an
  allergen list — the items controller stitches them into the show
  payload.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Allergens.Allergen
  alias Backend.Audit
  alias Backend.Items.Item
  alias Backend.Items.ItemAllergen
  alias Backend.Items.RawMaterialCompliance
  alias Backend.Items.RawMaterialRiskAssessment
  alias Backend.Repo

  @compliance_audit_fields ~w(use_as allergen_status vegan_status halal_status kosher_status organic_status novel_food_status gmo_status country_of_origin purity_pct extract_ratio overage_pct powder_water_dose_mg_per_ml shelf_life_months storage_conditions spec_document_file_id last_reviewed_at review_frequency_months review_due_at)a

  @risk_audit_fields ~w(physical_risk_score chemical_risk_score biological_risk_score allergen_risk_score radiological_risk_score fraud_vulnerability_score malicious_risk_score computed_overall_level overridden_overall_level override_justification justification required_controls assessed_at)a

  # ----- read ------------------------------------------------------

  def get_compliance(item_id) when is_integer(item_id) do
    Repo.get(RawMaterialCompliance, item_id)
    |> case do
      nil -> nil
      row -> Repo.preload(row, [:last_reviewed_by, :spec_document_file])
    end
  end

  def get_risk(item_id) when is_integer(item_id) do
    Repo.get(RawMaterialRiskAssessment, item_id)
    |> case do
      nil -> nil
      row -> Repo.preload(row, [:assessed_by])
    end
  end

  def list_allergens(item_id) when is_integer(item_id) do
    Repo.all(
      from(ia in ItemAllergen,
        join: a in Allergen,
        on: a.id == ia.allergen_id,
        where: ia.item_id == ^item_id,
        order_by: [asc: a.sort_order],
        select: a
      )
    )
  end

  # ----- compliance ------------------------------------------------

  def upsert_compliance(%User{} = actor, %Item{} = item, attrs) do
    existing = Repo.get(RawMaterialCompliance, item.id)
    before_state = existing && snapshot(existing, @compliance_audit_fields)

    base = existing || %RawMaterialCompliance{item_id: item.id}

    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("item_id", item.id)
      # Default last_reviewed_by to actor when the user is bumping
      # last_reviewed_at without naming someone — common pattern.
      |> maybe_default_reviewer(actor, existing)

    changeset = RawMaterialCompliance.changeset(base, attrs)

    case Repo.insert_or_update(changeset) do
      {:ok, row} ->
        after_state = snapshot(row, @compliance_audit_fields)

        if before_state do
          Audit.record_updated(
            actor,
            "raw_material_compliance",
            row,
            before_state,
            after_state
          )
        else
          Audit.record_created(actor, "raw_material_compliance", row, after_state)
        end

        {:ok, Repo.preload(row, [:last_reviewed_by, :spec_document_file])}

      other ->
        other
    end
  end

  defp maybe_default_reviewer(attrs, actor, existing) do
    bumping_reviewed_at =
      Map.has_key?(attrs, "last_reviewed_at") and
        not is_nil(attrs["last_reviewed_at"]) and
        not Map.has_key?(attrs, "last_reviewed_by_id")

    if bumping_reviewed_at and (is_nil(existing) or is_nil(existing.last_reviewed_by_id)) do
      Map.put(attrs, "last_reviewed_by_id", actor.id)
    else
      attrs
    end
  end

  # ----- risk assessment -------------------------------------------

  def upsert_risk(%User{} = actor, %Item{} = item, attrs) do
    existing = Repo.get(RawMaterialRiskAssessment, item.id)
    before_state = existing && snapshot(existing, @risk_audit_fields)
    base = existing || %RawMaterialRiskAssessment{item_id: item.id}

    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("item_id", item.id)
      # If the actor's just bumping the form without explicitly naming
      # an assessor, attribute it to themselves.
      |> Map.put_new("assessed_by_id", actor.id)
      |> Map.put_new_lazy("assessed_at", fn ->
        DateTime.utc_now() |> DateTime.truncate(:second)
      end)

    changeset = RawMaterialRiskAssessment.changeset(base, attrs)

    case Repo.insert_or_update(changeset) do
      {:ok, row} ->
        after_state = snapshot(row, @risk_audit_fields)

        if before_state do
          Audit.record_updated(
            actor,
            "raw_material_risk_assessment",
            row,
            before_state,
            after_state
          )
        else
          Audit.record_created(
            actor,
            "raw_material_risk_assessment",
            row,
            after_state
          )
        end

        {:ok, Repo.preload(row, [:assessed_by])}

      other ->
        other
    end
  end

  # ----- allergens -------------------------------------------------

  @doc """
  Full-replace allergen attachment. Caller sends the desired list of
  allergen UUIDs; we diff against existing and apply the changes in
  one transaction so reads never see a partial state.
  """
  def set_allergens(%User{} = _actor, %Item{} = item, allergen_uuids)
      when is_list(allergen_uuids) do
    cast_uuids =
      allergen_uuids
      |> Enum.map(&Ecto.UUID.cast/1)
      |> Enum.flat_map(fn
        {:ok, u} -> [u]
        :error -> []
      end)

    target_ids =
      if cast_uuids == [] do
        []
      else
        Repo.all(
          from(a in Allergen, where: a.uuid in ^cast_uuids, select: a.id)
        )
      end

    now = DateTime.utc_now() |> DateTime.truncate(:second)

    Repo.transaction(fn ->
      Repo.delete_all(
        from(ia in ItemAllergen, where: ia.item_id == ^item.id)
      )

      if target_ids != [] do
        rows =
          Enum.map(target_ids, fn aid ->
            %{item_id: item.id, allergen_id: aid, inserted_at: now}
          end)

        Repo.insert_all(ItemAllergen, rows)
      end

      :ok
    end)
  end

  # ----- helpers ---------------------------------------------------

  defp snapshot(struct, fields),
    do: Map.new(fields, fn f -> {f, Map.get(struct, f)} end)

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
