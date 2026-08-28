defmodule Backend.Repo.Migrations.AllowMultipleCosPerRtgFormulation do
  @moduledoc """
  Every customer order the storefront produces is an independent
  business object — RTG catalog products can be ordered N times, and
  the Custom re-order roadmap will follow. The old unique index
  ``(company_id, npd_formulation_uuid) WHERE sample_kind = false``
  enforced "1 formulation = 1 CO forever", which made the second
  storefront checkout for the same product silently overwrite the
  first order's CO in ``proposal_merge.fresh_merge``.

  This migration:

  * Adds ``npd_project_type`` (``"custom"`` | ``"ready_to_go"``) —
    populated by NPD on every proposal-merge payload. Lets
    ``fresh_merge`` decide whether to reuse (Custom, 1:1 with the
    formulation today) or create a fresh CO (RTG, always new).
  * Widens the formulation-unique index to skip RTG rows: only
    Custom non-sample COs stay 1:1 with formulation. RTG can have
    N rows per formulation.

  ``(company_id, npd_proposal_uuid)`` was already uniquely indexed
  and remains the true identity of a merged proposal — the FE + the
  merge lookup key off that.
  """

  use Ecto.Migration

  def up do
    alter table(:customer_orders) do
      # Nullable so legacy rows created before this column existed
      # keep validating. New writes always populate; the merge path
      # treats nil as "custom" for safety.
      add :npd_project_type, :string, size: 16
    end

    drop_if_exists index(:customer_orders, [:company_id, :npd_formulation_uuid],
                     name: :customer_orders_npd_formulation_uuid_index
                   )

    # Custom-only: keep the "1 formulation = 1 CO" invariant so a
    # duplicate merge on the same custom project still finds and
    # updates the existing CO. RTG rows fall through the WHERE and
    # never collide.
    create unique_index(:customer_orders, [:company_id, :npd_formulation_uuid],
             where:
               "npd_formulation_uuid IS NOT NULL AND sample_kind = false " <>
                 "AND (npd_project_type IS NULL OR npd_project_type <> 'ready_to_go')",
             name: :customer_orders_npd_formulation_uuid_index
           )
  end

  def down do
    drop_if_exists index(:customer_orders, [:company_id, :npd_formulation_uuid],
                     name: :customer_orders_npd_formulation_uuid_index
                   )

    create unique_index(:customer_orders, [:company_id, :npd_formulation_uuid],
             where: "npd_formulation_uuid IS NOT NULL AND sample_kind = false",
             name: :customer_orders_npd_formulation_uuid_index
           )

    alter table(:customer_orders) do
      remove :npd_project_type
    end
  end
end
