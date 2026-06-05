defmodule Backend.Repo.Migrations.CreateItemRawMaterialRiskAssessment do
  use Ecto.Migration

  @moduledoc """
  TACCP / VACCP / HACCP scorecard for raw-material items. 1:1 with
  `items` (item_type=raw_material).

  Seven component scores (0..5) feed the `computed_overall_level` via
  the context's pure-function calculator. A senior QA can override
  the computed level with a justification — stored alongside so the
  audit trail shows when humans diverged from the formula.

  Reviews live in their own table (not folded into compliance) because
  they happen on a different cadence and need their own RBAC
  (`risk_assessments.approve` gates the override).
  """

  def change do
    create table(:item_raw_material_risk_assessment, primary_key: false) do
      add :item_id, references(:items, on_delete: :delete_all),
        primary_key: true,
        null: false

      # Component scores: 0 = none, 5 = critical. Smallint keeps
      # storage tight; the context validates the 0..5 range.
      add :physical_risk_score, :smallint
      add :chemical_risk_score, :smallint
      add :biological_risk_score, :smallint
      add :allergen_risk_score, :smallint
      add :radiological_risk_score, :smallint
      add :fraud_vulnerability_score, :smallint
      add :malicious_risk_score, :smallint

      # Computed from the 7 scores (max-based for v1; configurable
      # later if QA wants weighting).
      add :computed_overall_level, :string, size: 12

      # Optional human override. When set, takes precedence on display
      # and reports but the computed value stays for audit. The
      # override gate is `risk_assessments.approve`.
      add :overridden_overall_level, :string, size: 12
      add :override_justification, :text

      # General narrative (why these scores, what mitigations are
      # already in place).
      add :justification, :text
      add :required_controls, :text

      add :assessed_at, :utc_datetime
      add :assessed_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    # Surface high/critical risks fast for dashboards.
    create index(:item_raw_material_risk_assessment, [:computed_overall_level])
    create index(:item_raw_material_risk_assessment, [:overridden_overall_level])
  end
end
