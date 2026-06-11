defmodule Backend.Repo.Migrations.AddPurposeToStorageCells do
  @moduledoc """
  Storage-cell purpose enum — the physical layer of the compliance
  rule that says "a quarantine lot must sit in a quarantine cell".

  Values:
    * `regular`    — happy-path stock (default)
    * `quarantine` — holds incoming lots until QC verdict
    * `hold`       — operator-marked hold (post-QC pause)
    * `rejected`   — failed QC, awaiting disposal
    * `dispatch`   — staging area for outbound shipments

  Enforced via a Postgres CHECK constraint so a stray UPDATE that
  bypasses the schema changeset still can't poison the enum. NOT NULL
  with a default of `regular` so every existing cell remains a normal
  pickable shelf after the migration runs.
  """

  use Ecto.Migration

  def change do
    alter table(:storage_cells) do
      add :purpose, :string, default: "regular", null: false
    end

    create constraint(:storage_cells, :storage_cells_purpose_check,
             check:
               "purpose IN ('regular','quarantine','hold','rejected','dispatch')"
           )
  end
end
