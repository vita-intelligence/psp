defmodule Backend.Repo.Migrations.AddNpdFormulationUuidToMos do
  use Ecto.Migration

  # Adds the NPD-side formulation UUID as an opaque back-reference on
  # the PSP MO. Optional (nullable) — old MOs, non-R&D MOs, and R&D MOs
  # created before NPD started sending this field remain valid. The
  # Output QC page uses this to deep-link into NPD's `/formulations/
  # {uuid}/qc/` page so QA can spin up a product validation without
  # bouncing through the trial-batch redirect.
  #
  # Sibling of ``npd_trial_batch_uuid`` (already unique + idempotent).
  # This one is NOT unique — a single NPD formulation can spawn many
  # trial-batch MOs over its lifetime, and each one should point back
  # to the same formulation.
  def change do
    alter table(:manufacturing_orders) do
      add :npd_formulation_uuid, :uuid, null: true
    end

    create index(:manufacturing_orders, [:npd_formulation_uuid],
             where: "npd_formulation_uuid IS NOT NULL",
             name: :manufacturing_orders_npd_formulation_uuid_idx
           )
  end
end
