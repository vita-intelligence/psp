defmodule Backend.Items.Compliance do
  @moduledoc """
  Per-type regulatory readiness check.

  Pure function — no DB writes. Takes a fully-preloaded `Item` and
  returns the list of fields that block transition to `ready_for_use`.
  Used by:

    * `Backend.Items.mark_ready/2` — refuses the transition if there
      are blockers
    * The item show payload — the FE renders a live "what's missing"
      panel that mirrors the same list, so workers know exactly what
      to fix without trial-and-error save attempts

  Required-field matrix is grounded in the rules a BRCGS / FSSC 22000
  / EU 1169 / EU 1935 audit would actually score against:

    * Raw materials → BRCGS Issue 9 § 3.5.1, FSSC 22000 § 7.1.6
      (identity + origin + allergen + GMO + storage + shelf life +
      risk assessment with controls)
    * Finished products → EU 1169/2011 mandatory particulars
      (regulatory category + net qty + serving + dosage + directions
      + warnings + storage + shelf life + target markets)
    * Packaging → EU 1935/2004 + EU 10/2011 (material + food-contact
      compliance flag; declaration file is required if the flag is
      true; non-food-contact items can skip)

  Spec sheets are recommended-but-not-required in v1 so the seeded
  catalogue can move to `ready_for_use` without a 30-PDF backfill —
  the file is captured at receive-time on the lot if missing here.
  Tightening to required is a one-line change when the team is ready.
  """

  alias Backend.Items.Item

  @type blocker :: %{field: String.t(), reason: String.t()}

  @doc """
  Run the per-type check. Returns `{:ok, []}` if ready, or
  `{:missing, [blocker]}` if not. Always succeeds — never raises.
  """
  @spec check(Item.t()) :: {:ok, []} | {:missing, [blocker()]}
  def check(%Item{} = item) do
    blockers =
      identity_blockers(item) ++ type_specific_blockers(item)

    case blockers do
      [] -> {:ok, []}
      list -> {:missing, list}
    end
  end

  # ----- identity (all types) --------------------------------------

  defp identity_blockers(item) do
    []
    |> reject_if_blank(item.name, "name",
      "An item with no name can't be traced through goods-in or onto a label.")
    |> reject_if_nil(item.stock_uom_id, "stock_uom_id",
      "Stock unit of measure is required for receive + BOM maths.")
  end

  # ----- raw materials ---------------------------------------------

  defp type_specific_blockers(%Item{item_type: "raw_material"} = item) do
    rm = item.raw_material_compliance
    risk = item.raw_material_risk

    # ``use_as`` has two source-of-truth columns: the side-table
    # ``raw_material_compliance.use_as`` (snake_case, written by the
    # PSP item form) AND ``item.attributes["use_as"]`` (Title Case,
    # written by the NPD import + PSP integration wire — this is the
    # column NPD's picker also filters on). An item populated from
    # only ONE of the two is fully addressable by NPD but shows as
    # "Not set" in the form, which is the exact source of the
    # confusion. Treat either source as satisfying the requirement so
    # the banner stops firing false-negative on items imported via
    # the integration wire before the operator has hand-filled the
    # side-table.
    use_as_present? =
      cond do
        not is_nil(rm) and not blank?(rm.use_as) -> true
        true ->
          attrs = item.attributes || %{}
          not blank?(Map.get(attrs, "use_as"))
      end

    rm_blockers =
      cond do
        is_nil(rm) and use_as_present? ->
          # Attributes carry ``use_as`` but no side-table row exists —
          # emit the side-table blocker so the operator fills the rest
          # (allergen / vegan / GMO / country / shelf-life). Suppress
          # the standalone ``use_as`` blocker since it's already
          # satisfied by the attributes bag.
          [
            %{field: "raw_material_compliance",
              reason: "Compliance subtable hasn't been filled in. Open the Raw material section."}
          ]

        is_nil(rm) ->
          [
            %{field: "raw_material_compliance",
              reason: "Compliance subtable hasn't been filled in. Open the Raw material section."}
          ]

        true ->
          []
          |> reject_if_blank_use_as(use_as_present?)
          |> reject_if_blank(rm.country_of_origin, "raw_material_compliance.country_of_origin",
            "ISO 3166-1 origin is required for traceability (BRCGS § 3.5.1).")
          |> reject_if_blank(rm.allergen_status, "raw_material_compliance.allergen_status",
            "Allergen status (free / traces / contains) is mandatory for HACCP + EU 1169/2011 labelling.")
          |> reject_if_blank(rm.vegan_status, "raw_material_compliance.vegan_status",
            "Vegan/vegetarian status feeds the finished-product label claims gate.")
          |> reject_if_blank(rm.gmo_status, "raw_material_compliance.gmo_status",
            "GMO status is mandatory under EU 1829/2003.")
          |> reject_if_blank(rm.storage_conditions, "raw_material_compliance.storage_conditions",
            "Storage conditions drive warehouse cell selection + cold-chain check on receive.")
          |> reject_if_nil(rm.shelf_life_months, "raw_material_compliance.shelf_life_months",
            "Shelf life in months is required to compute lot expiry on receive.")
      end

    risk_blockers =
      cond do
        is_nil(risk) ->
          [
            %{field: "raw_material_risk",
              reason: "TACCP/VACCP/HACCP risk scorecard hasn't been completed. Open the Risk assessment section."}
          ]

        true ->
          []
          |> reject_if_nil(risk.physical_risk_score, "raw_material_risk.physical_risk_score",
            "Physical hazard score (0–5).")
          |> reject_if_nil(risk.chemical_risk_score, "raw_material_risk.chemical_risk_score",
            "Chemical hazard score (0–5).")
          |> reject_if_nil(risk.biological_risk_score, "raw_material_risk.biological_risk_score",
            "Biological hazard score (0–5).")
          |> reject_if_nil(risk.allergen_risk_score, "raw_material_risk.allergen_risk_score",
            "Allergen hazard score (0–5).")
          |> reject_if_nil(risk.radiological_risk_score, "raw_material_risk.radiological_risk_score",
            "Radiological hazard score (0–5).")
          |> reject_if_nil(risk.fraud_vulnerability_score, "raw_material_risk.fraud_vulnerability_score",
            "Fraud vulnerability score (VACCP, 0–5).")
          |> reject_if_nil(risk.malicious_risk_score, "raw_material_risk.malicious_risk_score",
            "Malicious adulteration score (TACCP, 0–5).")
          |> reject_if_blank(risk.justification, "raw_material_risk.justification",
            "Justification text is mandatory — auditors read this verbatim.")
          |> reject_if_blank(risk.required_controls, "raw_material_risk.required_controls",
            "Required controls (CoA, identity testing, ELISA, …) so QC knows what to verify on receive.")
      end

    rm_blockers ++ risk_blockers
  end

  # ----- finished products -----------------------------------------

  defp type_specific_blockers(%Item{item_type: "finished_product"} = item) do
    fp = item.finished_product_spec

    cond do
      is_nil(fp) ->
        [
          %{field: "finished_product_spec",
            reason: "Finished-product specification hasn't been filled in."}
        ]

      true ->
        []
        |> reject_if_blank(fp.regulatory_category, "finished_product_spec.regulatory_category",
          "Regulatory category (food supplement / functional food / cosmetic / medical device) drives which other regs apply.")
        |> reject_if_blank(fp.dosage_form, "finished_product_spec.dosage_form",
          "Dosage form (capsule / tablet / powder / …) is required for label compliance + production routing.")
        |> reject_if_nil(fp.net_quantity, "finished_product_spec.net_quantity",
          "Net quantity is mandatory under EU 1169/2011 Art. 9(1)(e).")
        |> reject_if_nil(fp.net_quantity_uom_id, "finished_product_spec.net_quantity_uom_id",
          "Net quantity unit of measure is required.")
        |> reject_if_nil(fp.serving_size, "finished_product_spec.serving_size",
          "Serving size is required for supplement-fact labelling.")
        |> reject_if_nil(fp.serving_size_uom_id, "finished_product_spec.serving_size_uom_id",
          "Serving-size unit of measure is required.")
        |> reject_if_nil(fp.servings_per_pack, "finished_product_spec.servings_per_pack",
          "Servings per pack is required for supplement-fact labelling.")
        |> reject_if_blank(fp.directions_of_use, "finished_product_spec.directions_of_use",
          "Directions of use must appear on the label for supplements.")
        |> reject_if_blank(fp.suggested_dosage, "finished_product_spec.suggested_dosage",
          "Suggested dosage must appear on the label for supplements.")
        |> reject_if_blank(fp.warnings_text, "finished_product_spec.warnings_text",
          "Warnings text is required for supplements (EU 1169/2011 Art. 9(1)(j)).")
        |> reject_if_nil(fp.shelf_life_months, "finished_product_spec.shelf_life_months",
          "Shelf life in months drives the best-before date stamp.")
        |> reject_if_blank(fp.storage_conditions, "finished_product_spec.storage_conditions",
          "Storage conditions are mandatory under EU 1169/2011 Art. 25.")
        |> reject_if_empty_list(fp.target_markets, "finished_product_spec.target_markets",
          "At least one target market ISO code is required so the label compliance gate knows which regs to apply.")
    end
  end

  # ----- packaging --------------------------------------------------

  defp type_specific_blockers(%Item{item_type: "packaging"} = item) do
    p = item.packaging_compliance

    cond do
      is_nil(p) ->
        [
          %{field: "packaging_compliance",
            reason: "Packaging compliance subtable hasn't been filled in."}
        ]

      true ->
        base =
          []
          |> reject_if_blank(p.material, "packaging_compliance.material",
            "Material (HDPE / PP / glass / multi-layer / …) is required for food-contact + recyclability claims.")
          |> reject_if_nil(p.food_contact_compliant, "packaging_compliance.food_contact_compliant",
            "Food-contact compliant flag (yes / no) is mandatory before this packaging can be used.")

        # If the operator says it IS food-contact compliant, EU 1935/
        # 2004 Art. 16 obliges them to hold a declaration of conformity
        # for it. Require the file then; otherwise skip.
        if p.food_contact_compliant == true do
          reject_if_nil(base, p.food_contact_declaration_file_id,
            "packaging_compliance.food_contact_declaration_file_id",
            "Declaration of Conformity file is mandatory when food-contact compliant = yes (EU 1935/2004 Art. 16).")
        else
          base
        end
    end
  end

  defp type_specific_blockers(%Item{item_type: "semi_finished"}) do
    # Semi-finished is an internal handoff — no labelling reg applies
    # directly. Treat as identity-only.
    []
  end

  defp type_specific_blockers(_), do: []

  # ----- helpers ---------------------------------------------------

  # Emit the ``use_as`` blocker only when neither source populated it.
  # ``present?`` is precomputed by the caller from both the side-table
  # column AND ``item.attributes["use_as"]`` so the check has one
  # decision surface.
  defp reject_if_blank_use_as(acc, true), do: acc
  defp reject_if_blank_use_as(acc, false) do
    acc ++
      [
        %{
          field: "raw_material_compliance.use_as",
          reason:
            "Functional role on label (active / sweetener / bulking agent / …)."
        }
      ]
  end

  defp reject_if_blank(acc, value, field, reason) do
    if blank?(value), do: acc ++ [%{field: field, reason: reason}], else: acc
  end

  defp reject_if_nil(acc, value, field, reason) do
    if is_nil(value), do: acc ++ [%{field: field, reason: reason}], else: acc
  end

  defp reject_if_empty_list(acc, list, field, reason)
       when is_list(list) and list != [],
       do: acc

  defp reject_if_empty_list(acc, _list, field, reason),
    do: acc ++ [%{field: field, reason: reason}]

  defp blank?(nil), do: true
  defp blank?(""), do: true
  defp blank?(v) when is_binary(v), do: String.trim(v) == ""
  defp blank?(_), do: false
end
