defmodule Backend.Repo.Migrations.SeedEuClaimRegister do
  use Ecto.Migration
  import Ecto.Query, only: [from: 2]

  @moduledoc """
  Seed the EU register of nutrition + health claims. Two regulatory
  layers land here:

    * **Nutrition claims** — Annex of Regulation (EC) No 1924/2006
      ("low fat", "source of fibre", …). 27 entries.

    * **General-function health claims** — Article 13(1) of
      Reg 1924/2006, authorised by Commission Reg (EU) 432/2012 and
      its successive amendments. We seed the highest-value subset
      (~60 entries) covering every vitamin + mineral the supplements
      and fortified-food world actually uses, plus a handful of other
      headline substances (omega-3, beta-glucans, plant stanols, etc.).

  Idempotent: re-runs upsert via the `(source, claim_code)` unique
  index, so refreshing wording (when EFSA tweaks an opinion) is
  `mix ecto.migrate` away.
  """

  # ──────────────────────────────────────────────────────────────────
  # Nutrition claims — Annex of Regulation (EC) 1924/2006
  # `claim_code` uses "NC<n>" for stable internal references.
  # ──────────────────────────────────────────────────────────────────
  @nutrition_claims [
    {"NC01", "Low energy",
     "Product contains no more than 40 kcal (170 kJ) per 100 g for solids or 20 kcal (80 kJ) per 100 ml for liquids."},
    {"NC02", "Energy-reduced",
     "Energy value reduced by at least 30 % compared with similar products."},
    {"NC03", "Energy-free",
     "Product contains no more than 4 kcal (17 kJ) per 100 ml."},
    {"NC04", "Low fat",
     "Product contains no more than 3 g of fat per 100 g for solids or 1.5 g of fat per 100 ml for liquids."},
    {"NC05", "Fat-free",
     "Product contains no more than 0.5 g of fat per 100 g or 100 ml."},
    {"NC06", "Low saturated fat",
     "Sum of saturated fatty acids + trans-fatty acids no more than 1.5 g/100 g for solids or 0.75 g/100 ml for liquids and provides no more than 10 % of energy from saturates."},
    {"NC07", "Saturated fat-free",
     "Sum of saturated fatty acids + trans-fatty acids does not exceed 0.1 g per 100 g or 100 ml."},
    {"NC08", "Low sugars",
     "Product contains no more than 5 g of sugars per 100 g for solids or 2.5 g per 100 ml for liquids."},
    {"NC09", "Sugars-free",
     "Product contains no more than 0.5 g of sugars per 100 g or 100 ml."},
    {"NC10", "With no added sugars",
     "Product does not contain any added mono- or disaccharides or any other food used for its sweetening properties. If sugars are naturally present, the label should also bear: 'contains naturally occurring sugars'."},
    {"NC11", "Low sodium / Low salt",
     "Product contains no more than 0.12 g of sodium, or the equivalent value for salt, per 100 g or 100 ml. For waters other than natural mineral waters, this value should not exceed 2 mg sodium/100 ml."},
    {"NC12", "Very low sodium / Very low salt",
     "Product contains no more than 0.04 g of sodium, or the equivalent value for salt, per 100 g or 100 ml. Not applicable to natural mineral waters."},
    {"NC13", "Sodium-free / Salt-free",
     "Product contains no more than 0.005 g of sodium, or the equivalent value for salt, per 100 g."},
    {"NC14", "No added sodium / No added salt",
     "Product does not contain any added sodium / salt or any other ingredient containing added sodium / salt, and the product contains no more than 0.12 g sodium (or the equivalent for salt) per 100 g or 100 ml."},
    {"NC15", "Source of fibre",
     "Product contains at least 3 g of fibre per 100 g or at least 1.5 g per 100 kcal."},
    {"NC16", "High fibre",
     "Product contains at least 6 g of fibre per 100 g or at least 3 g per 100 kcal."},
    {"NC17", "Source of protein",
     "At least 12 % of the energy value of the food is provided by protein."},
    {"NC18", "High protein",
     "At least 20 % of the energy value of the food is provided by protein."},
    {"NC19", "Source of [vitamin/mineral]",
     "Product contains at least a significant amount as defined in the Annex of Directive 90/496/EEC, or as established by Article 6 of Regulation (EU) 1169/2011 (typically ≥ 15 % of the NRV per 100 g/ml)."},
    {"NC20", "High [vitamin/mineral]",
     "Product contains at least twice the value of 'source of [name of vitamin/s] and/or [name of mineral/s]'."},
    {"NC21", "Contains [nutrient/substance]",
     "Product complies with all the applicable provisions of this Regulation and, in particular, Article 5."},
    {"NC22", "Increased [nutrient]",
     "Product meets the conditions for the claim 'source of' and the increase in content is at least 30 % compared with a similar product."},
    {"NC23", "Reduced [nutrient]",
     "Reduction in content is at least 30 % compared with a similar product, except for micronutrients (10 % NRV difference) and sodium/salt (25 %)."},
    {"NC24", "Light / Lite",
     "Same conditions as 'reduced'; the claim shall also be accompanied by an indication of the characteristic(s) which make(s) the food 'light'."},
    {"NC25", "Naturally / Natural",
     "Where a food naturally meets the condition(s) laid down in this Annex for the use of a nutritional claim, the term 'naturally / natural' may be used."},
    {"NC26", "Source of omega-3 fatty acids",
     "Product contains at least 0.3 g alpha-linolenic acid per 100 g + 100 kcal, or at least 40 mg of the sum of EPA + DHA per 100 g + 100 kcal."},
    {"NC27", "High omega-3 fatty acids",
     "Product contains at least 0.6 g alpha-linolenic acid per 100 g + 100 kcal, or at least 80 mg of the sum of EPA + DHA per 100 g + 100 kcal."},
    {"NC28", "High monounsaturated fat",
     "At least 45 % of the fatty acids present in the product derive from monounsaturated fat under the condition that monounsaturated fat provides more than 20 % of energy of the product."},
    {"NC29", "High polyunsaturated fat",
     "At least 45 % of the fatty acids present in the product derive from polyunsaturated fat under the condition that polyunsaturated fat provides more than 20 % of energy of the product."},
    {"NC30", "High unsaturated fat",
     "At least 70 % of the fatty acids present in the product derive from unsaturated fat under the condition that unsaturated fat provides more than 20 % of energy of the product."}
  ]

  # ──────────────────────────────────────────────────────────────────
  # Article 13(1) general-function health claims — authorised per
  # Reg (EU) 432/2012 and amendments.
  # `{claim_code, nutrient/substance, claim_text}` — the conditions of
  # use are the standard "the claim may be used only for food which
  # is at least a source of <substance>" unless we override.
  # ──────────────────────────────────────────────────────────────────
  @generic_conditions "The claim may be used only for food which is at least a source of the named nutrient as referred to in the Annex of Regulation (EC) No 1924/2006."

  @health_claims [
    # ----- Vitamin A -----
    {"HC_VITA_01", "Vitamin A", "Vitamin A contributes to normal iron metabolism."},
    {"HC_VITA_02", "Vitamin A", "Vitamin A contributes to the maintenance of normal mucous membranes."},
    {"HC_VITA_03", "Vitamin A", "Vitamin A contributes to the maintenance of normal skin."},
    {"HC_VITA_04", "Vitamin A", "Vitamin A contributes to the maintenance of normal vision."},
    {"HC_VITA_05", "Vitamin A", "Vitamin A contributes to the normal function of the immune system."},
    {"HC_VITA_06", "Vitamin A", "Vitamin A has a role in the process of cell specialisation."},

    # ----- Vitamin D -----
    {"HC_VITD_01", "Vitamin D", "Vitamin D contributes to normal absorption / utilisation of calcium and phosphorus."},
    {"HC_VITD_02", "Vitamin D", "Vitamin D contributes to normal blood calcium levels."},
    {"HC_VITD_03", "Vitamin D", "Vitamin D contributes to the maintenance of normal bones."},
    {"HC_VITD_04", "Vitamin D", "Vitamin D contributes to the maintenance of normal muscle function."},
    {"HC_VITD_05", "Vitamin D", "Vitamin D contributes to the maintenance of normal teeth."},
    {"HC_VITD_06", "Vitamin D", "Vitamin D contributes to the normal function of the immune system."},
    {"HC_VITD_07", "Vitamin D", "Vitamin D has a role in the process of cell division."},

    # ----- Vitamin E -----
    {"HC_VITE_01", "Vitamin E", "Vitamin E contributes to the protection of cells from oxidative stress."},

    # ----- Vitamin K -----
    {"HC_VITK_01", "Vitamin K", "Vitamin K contributes to normal blood clotting."},
    {"HC_VITK_02", "Vitamin K", "Vitamin K contributes to the maintenance of normal bones."},

    # ----- Vitamin C -----
    {"HC_VITC_01", "Vitamin C", "Vitamin C contributes to maintain the normal function of the immune system during and after intense physical exercise."},
    {"HC_VITC_02", "Vitamin C", "Vitamin C contributes to normal collagen formation for the normal function of blood vessels, bones, cartilage, gums, skin and teeth."},
    {"HC_VITC_03", "Vitamin C", "Vitamin C contributes to normal energy-yielding metabolism."},
    {"HC_VITC_04", "Vitamin C", "Vitamin C contributes to normal functioning of the nervous system."},
    {"HC_VITC_05", "Vitamin C", "Vitamin C contributes to normal psychological function."},
    {"HC_VITC_06", "Vitamin C", "Vitamin C contributes to the normal function of the immune system."},
    {"HC_VITC_07", "Vitamin C", "Vitamin C contributes to the protection of cells from oxidative stress."},
    {"HC_VITC_08", "Vitamin C", "Vitamin C contributes to the reduction of tiredness and fatigue."},
    {"HC_VITC_09", "Vitamin C", "Vitamin C contributes to the regeneration of the reduced form of vitamin E."},
    {"HC_VITC_10", "Vitamin C", "Vitamin C increases iron absorption."},

    # ----- B vitamins -----
    {"HC_B1_01", "Thiamine (Vitamin B1)", "Thiamine contributes to normal energy-yielding metabolism."},
    {"HC_B1_02", "Thiamine (Vitamin B1)", "Thiamine contributes to the normal function of the heart."},
    {"HC_B1_03", "Thiamine (Vitamin B1)", "Thiamine contributes to the normal function of the nervous system."},
    {"HC_B1_04", "Thiamine (Vitamin B1)", "Thiamine contributes to normal psychological function."},
    {"HC_B2_01", "Riboflavin (Vitamin B2)", "Riboflavin contributes to normal energy-yielding metabolism."},
    {"HC_B2_02", "Riboflavin (Vitamin B2)", "Riboflavin contributes to normal functioning of the nervous system."},
    {"HC_B2_03", "Riboflavin (Vitamin B2)", "Riboflavin contributes to the maintenance of normal mucous membranes."},
    {"HC_B2_04", "Riboflavin (Vitamin B2)", "Riboflavin contributes to the maintenance of normal red blood cells."},
    {"HC_B2_05", "Riboflavin (Vitamin B2)", "Riboflavin contributes to the maintenance of normal skin and vision."},
    {"HC_B2_06", "Riboflavin (Vitamin B2)", "Riboflavin contributes to normal iron metabolism."},
    {"HC_B2_07", "Riboflavin (Vitamin B2)", "Riboflavin contributes to the protection of cells from oxidative stress."},
    {"HC_B2_08", "Riboflavin (Vitamin B2)", "Riboflavin contributes to the reduction of tiredness and fatigue."},
    {"HC_B3_01", "Niacin (Vitamin B3)", "Niacin contributes to normal energy-yielding metabolism."},
    {"HC_B3_02", "Niacin (Vitamin B3)", "Niacin contributes to normal functioning of the nervous system."},
    {"HC_B3_03", "Niacin (Vitamin B3)", "Niacin contributes to normal psychological function."},
    {"HC_B3_04", "Niacin (Vitamin B3)", "Niacin contributes to the maintenance of normal mucous membranes and skin."},
    {"HC_B3_05", "Niacin (Vitamin B3)", "Niacin contributes to the reduction of tiredness and fatigue."},
    {"HC_B5_01", "Pantothenic acid (Vitamin B5)", "Pantothenic acid contributes to normal energy-yielding metabolism."},
    {"HC_B5_02", "Pantothenic acid (Vitamin B5)", "Pantothenic acid contributes to normal mental performance."},
    {"HC_B5_03", "Pantothenic acid (Vitamin B5)", "Pantothenic acid contributes to normal synthesis and metabolism of steroid hormones, vitamin D and some neurotransmitters."},
    {"HC_B5_04", "Pantothenic acid (Vitamin B5)", "Pantothenic acid contributes to the reduction of tiredness and fatigue."},
    {"HC_B6_01", "Vitamin B6 (Pyridoxine)", "Vitamin B6 contributes to normal cysteine synthesis."},
    {"HC_B6_02", "Vitamin B6 (Pyridoxine)", "Vitamin B6 contributes to normal energy-yielding metabolism."},
    {"HC_B6_03", "Vitamin B6 (Pyridoxine)", "Vitamin B6 contributes to normal functioning of the nervous system."},
    {"HC_B6_04", "Vitamin B6 (Pyridoxine)", "Vitamin B6 contributes to normal homocysteine metabolism."},
    {"HC_B6_05", "Vitamin B6 (Pyridoxine)", "Vitamin B6 contributes to normal protein and glycogen metabolism."},
    {"HC_B6_06", "Vitamin B6 (Pyridoxine)", "Vitamin B6 contributes to normal psychological function."},
    {"HC_B6_07", "Vitamin B6 (Pyridoxine)", "Vitamin B6 contributes to the formation of red blood cells."},
    {"HC_B6_08", "Vitamin B6 (Pyridoxine)", "Vitamin B6 contributes to the normal function of the immune system."},
    {"HC_B6_09", "Vitamin B6 (Pyridoxine)", "Vitamin B6 contributes to the reduction of tiredness and fatigue."},
    {"HC_B6_10", "Vitamin B6 (Pyridoxine)", "Vitamin B6 contributes to the regulation of hormonal activity."},
    {"HC_B7_01", "Biotin (Vitamin B7)", "Biotin contributes to normal energy-yielding metabolism."},
    {"HC_B7_02", "Biotin (Vitamin B7)", "Biotin contributes to normal functioning of the nervous system."},
    {"HC_B7_03", "Biotin (Vitamin B7)", "Biotin contributes to the maintenance of normal hair, skin and mucous membranes."},
    {"HC_B7_04", "Biotin (Vitamin B7)", "Biotin contributes to normal macronutrient metabolism."},
    {"HC_B7_05", "Biotin (Vitamin B7)", "Biotin contributes to normal psychological function."},
    {"HC_B9_01", "Folate (Folic acid, Vitamin B9)", "Folate contributes to maternal tissue growth during pregnancy."},
    {"HC_B9_02", "Folate (Folic acid, Vitamin B9)", "Folate contributes to normal amino acid synthesis."},
    {"HC_B9_03", "Folate (Folic acid, Vitamin B9)", "Folate contributes to normal blood formation."},
    {"HC_B9_04", "Folate (Folic acid, Vitamin B9)", "Folate contributes to normal homocysteine metabolism."},
    {"HC_B9_05", "Folate (Folic acid, Vitamin B9)", "Folate contributes to normal psychological function."},
    {"HC_B9_06", "Folate (Folic acid, Vitamin B9)", "Folate contributes to the normal function of the immune system."},
    {"HC_B9_07", "Folate (Folic acid, Vitamin B9)", "Folate contributes to the reduction of tiredness and fatigue."},
    {"HC_B9_08", "Folate (Folic acid, Vitamin B9)", "Folate has a role in the process of cell division."},
    {"HC_B12_01", "Vitamin B12 (Cobalamin)", "Vitamin B12 contributes to normal energy-yielding metabolism."},
    {"HC_B12_02", "Vitamin B12 (Cobalamin)", "Vitamin B12 contributes to normal functioning of the nervous system."},
    {"HC_B12_03", "Vitamin B12 (Cobalamin)", "Vitamin B12 contributes to normal homocysteine metabolism."},
    {"HC_B12_04", "Vitamin B12 (Cobalamin)", "Vitamin B12 contributes to normal psychological function."},
    {"HC_B12_05", "Vitamin B12 (Cobalamin)", "Vitamin B12 contributes to normal red blood cell formation."},
    {"HC_B12_06", "Vitamin B12 (Cobalamin)", "Vitamin B12 contributes to the normal function of the immune system."},
    {"HC_B12_07", "Vitamin B12 (Cobalamin)", "Vitamin B12 contributes to the reduction of tiredness and fatigue."},
    {"HC_B12_08", "Vitamin B12 (Cobalamin)", "Vitamin B12 has a role in the process of cell division."},

    # ----- Minerals -----
    {"HC_CA_01", "Calcium", "Calcium contributes to normal blood clotting."},
    {"HC_CA_02", "Calcium", "Calcium contributes to normal energy-yielding metabolism."},
    {"HC_CA_03", "Calcium", "Calcium contributes to normal muscle function."},
    {"HC_CA_04", "Calcium", "Calcium contributes to normal neurotransmission."},
    {"HC_CA_05", "Calcium", "Calcium contributes to the normal function of digestive enzymes."},
    {"HC_CA_06", "Calcium", "Calcium has a role in the process of cell division and specialisation."},
    {"HC_CA_07", "Calcium", "Calcium is needed for the maintenance of normal bones."},
    {"HC_CA_08", "Calcium", "Calcium is needed for the maintenance of normal teeth."},
    {"HC_FE_01", "Iron", "Iron contributes to normal cognitive function."},
    {"HC_FE_02", "Iron", "Iron contributes to normal energy-yielding metabolism."},
    {"HC_FE_03", "Iron", "Iron contributes to normal formation of red blood cells and haemoglobin."},
    {"HC_FE_04", "Iron", "Iron contributes to normal oxygen transport in the body."},
    {"HC_FE_05", "Iron", "Iron contributes to the normal function of the immune system."},
    {"HC_FE_06", "Iron", "Iron contributes to the reduction of tiredness and fatigue."},
    {"HC_FE_07", "Iron", "Iron has a role in the process of cell division."},
    {"HC_MG_01", "Magnesium", "Magnesium contributes to a reduction of tiredness and fatigue."},
    {"HC_MG_02", "Magnesium", "Magnesium contributes to electrolyte balance."},
    {"HC_MG_03", "Magnesium", "Magnesium contributes to normal energy-yielding metabolism."},
    {"HC_MG_04", "Magnesium", "Magnesium contributes to normal functioning of the nervous system."},
    {"HC_MG_05", "Magnesium", "Magnesium contributes to normal muscle function."},
    {"HC_MG_06", "Magnesium", "Magnesium contributes to normal protein synthesis."},
    {"HC_MG_07", "Magnesium", "Magnesium contributes to normal psychological function."},
    {"HC_MG_08", "Magnesium", "Magnesium contributes to the maintenance of normal bones and teeth."},
    {"HC_MG_09", "Magnesium", "Magnesium has a role in the process of cell division."},
    {"HC_ZN_01", "Zinc", "Zinc contributes to normal acid-base metabolism."},
    {"HC_ZN_02", "Zinc", "Zinc contributes to normal carbohydrate metabolism."},
    {"HC_ZN_03", "Zinc", "Zinc contributes to normal cognitive function."},
    {"HC_ZN_04", "Zinc", "Zinc contributes to normal DNA synthesis."},
    {"HC_ZN_05", "Zinc", "Zinc contributes to normal fertility and reproduction."},
    {"HC_ZN_06", "Zinc", "Zinc contributes to normal macronutrient metabolism."},
    {"HC_ZN_07", "Zinc", "Zinc contributes to normal metabolism of fatty acids."},
    {"HC_ZN_08", "Zinc", "Zinc contributes to normal metabolism of vitamin A."},
    {"HC_ZN_09", "Zinc", "Zinc contributes to normal protein synthesis."},
    {"HC_ZN_10", "Zinc", "Zinc contributes to the maintenance of normal bones, hair, nails, skin, and vision."},
    {"HC_ZN_11", "Zinc", "Zinc contributes to normal testosterone levels in the blood."},
    {"HC_ZN_12", "Zinc", "Zinc contributes to the normal function of the immune system."},
    {"HC_ZN_13", "Zinc", "Zinc contributes to the protection of cells from oxidative stress."},
    {"HC_ZN_14", "Zinc", "Zinc has a role in the process of cell division."},
    {"HC_I_01", "Iodine", "Iodine contributes to normal cognitive function."},
    {"HC_I_02", "Iodine", "Iodine contributes to normal energy-yielding metabolism."},
    {"HC_I_03", "Iodine", "Iodine contributes to normal functioning of the nervous system."},
    {"HC_I_04", "Iodine", "Iodine contributes to the maintenance of normal skin."},
    {"HC_I_05", "Iodine", "Iodine contributes to the normal production of thyroid hormones and normal thyroid function."},
    {"HC_SE_01", "Selenium", "Selenium contributes to normal spermatogenesis."},
    {"HC_SE_02", "Selenium", "Selenium contributes to the maintenance of normal hair and nails."},
    {"HC_SE_03", "Selenium", "Selenium contributes to the normal function of the immune system."},
    {"HC_SE_04", "Selenium", "Selenium contributes to the normal thyroid function."},
    {"HC_SE_05", "Selenium", "Selenium contributes to the protection of cells from oxidative stress."},
    {"HC_CU_01", "Copper", "Copper contributes to maintenance of normal connective tissues."},
    {"HC_CU_02", "Copper", "Copper contributes to normal energy-yielding metabolism."},
    {"HC_CU_03", "Copper", "Copper contributes to normal functioning of the nervous system."},
    {"HC_CU_04", "Copper", "Copper contributes to normal hair pigmentation."},
    {"HC_CU_05", "Copper", "Copper contributes to normal iron transport in the body."},
    {"HC_CU_06", "Copper", "Copper contributes to normal skin pigmentation."},
    {"HC_CU_07", "Copper", "Copper contributes to the normal function of the immune system."},
    {"HC_CU_08", "Copper", "Copper contributes to the protection of cells from oxidative stress."},
    {"HC_MN_01", "Manganese", "Manganese contributes to normal energy-yielding metabolism."},
    {"HC_MN_02", "Manganese", "Manganese contributes to the maintenance of normal bones."},
    {"HC_MN_03", "Manganese", "Manganese contributes to the normal formation of connective tissue."},
    {"HC_MN_04", "Manganese", "Manganese contributes to the protection of cells from oxidative stress."},
    {"HC_CR_01", "Chromium", "Chromium contributes to normal macronutrient metabolism."},
    {"HC_CR_02", "Chromium", "Chromium contributes to the maintenance of normal blood glucose levels."},
    {"HC_MO_01", "Molybdenum", "Molybdenum contributes to normal sulphur amino acid metabolism."},
    {"HC_K_01", "Potassium", "Potassium contributes to normal functioning of the nervous system."},
    {"HC_K_02", "Potassium", "Potassium contributes to normal muscle function."},
    {"HC_K_03", "Potassium", "Potassium contributes to the maintenance of normal blood pressure."},
    {"HC_P_01", "Phosphorus", "Phosphorus contributes to normal energy-yielding metabolism."},
    {"HC_P_02", "Phosphorus", "Phosphorus contributes to normal function of cell membranes."},
    {"HC_P_03", "Phosphorus", "Phosphorus contributes to the maintenance of normal bones and teeth."},
    {"HC_F_01", "Fluoride", "Fluoride contributes to the maintenance of tooth mineralisation."},

    # ----- Other substances -----
    {"HC_DHA_01", "DHA (Docosahexaenoic acid)",
     "DHA contributes to the maintenance of normal brain function (at a daily intake of 250 mg of DHA)."},
    {"HC_DHA_02", "DHA (Docosahexaenoic acid)",
     "DHA contributes to the maintenance of normal vision (at a daily intake of 250 mg of DHA)."},
    {"HC_EPA_01", "EPA + DHA",
     "EPA and DHA contribute to the normal function of the heart (at a daily intake of 250 mg of EPA and DHA combined)."},
    {"HC_BG_01", "Beta-glucans (oat / barley)",
     "Beta-glucans contribute to the maintenance of normal blood cholesterol levels (3 g of oat or barley beta-glucans per day)."},
    {"HC_PS_01", "Plant sterols / Plant stanols",
     "Plant sterols / plant stanols contribute to the maintenance of normal blood cholesterol levels (1.5–2.4 g per day)."},
    {"HC_LAC_01", "Live yoghurt cultures",
     "Live cultures in yoghurt or fermented milk improve lactose digestion of the product in individuals with difficulty digesting lactose."}
  ]

  @nutrition_source "eu_1924_2006_annex"
  @health_source "eu_1924_2006_art_13"
  @jurisdictions ["EU", "GB"]

  def up do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    nutrition_rows =
      Enum.map(@nutrition_claims, fn {code, text, conditions} ->
        %{
          uuid: Ecto.UUID.bingenerate(),
          claim_code: code,
          claim_text: text,
          category: "nutrition",
          nutrient_substance: nil,
          conditions_of_use: conditions,
          jurisdictions: @jurisdictions,
          source: @nutrition_source,
          status: "authorised",
          inserted_at: now,
          updated_at: now
        }
      end)

    health_rows =
      Enum.map(@health_claims, fn {code, substance, text} ->
        %{
          uuid: Ecto.UUID.bingenerate(),
          claim_code: code,
          claim_text: text,
          category: "general_function",
          nutrient_substance: substance,
          conditions_of_use: @generic_conditions,
          jurisdictions: @jurisdictions,
          source: @health_source,
          status: "authorised",
          inserted_at: now,
          updated_at: now
        }
      end)

    repo().insert_all("claim_register", nutrition_rows ++ health_rows,
      on_conflict: {:replace, [:claim_text, :category, :nutrient_substance, :conditions_of_use, :jurisdictions, :status, :updated_at]},
      conflict_target: [:source, :claim_code]
    )
  end

  def down do
    sources = [@nutrition_source, @health_source]
    repo().delete_all(from c in "claim_register", where: c.source in ^sources)
  end
end
