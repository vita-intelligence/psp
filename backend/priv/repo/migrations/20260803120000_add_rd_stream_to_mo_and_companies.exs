defmodule Backend.Repo.Migrations.AddRdStreamToMoAndCompanies do
  use Ecto.Migration

  @moduledoc """
  Foundations for the NPD trial-batch → PSP manufacturing-order flow.

  Two schema additions, one data seed:

  1. `manufacturing_orders.project_type` — enum-ish string that tags
     an MO as production / trial / sample. Everything today is
     "production" (default); trial batches created from NPD flip it
     to "trial" so downstream services (auto-routing, procurement
     UX, reporting) can distinguish R&D consumption from real
     production consumption.

  2. `companies.rd_consumption_cell_id` — nullable FK pointing at the
     cell where R&D pickups land by default. Scientists don't care
     about a global "consume off books" cell; they want the pick to
     arrive at the bench where their trial run happens. Nullable so
     seed companies without R&D lifecycle stay valid, and so the
     picker survives if the linked cell is deleted (SET NULL).

  3. Data migration seeds `"rnd"` into every company's
     `storage_tags` registry (kind: "both", so it applies to both
     Item.storage_tags and StorageCell.tags). We reuse PSP's existing
     tag-matching machinery to isolate R&D stock — the stock
     allocation query already refuses to cross-pollinate items whose
     `storage_tags` don't match a cell's tag union, so once `rnd` is
     declared and applied to R&D-only items + cells, isolation is
     automatic. No new boolean columns needed.
  """

  def up do
    alter table(:manufacturing_orders) do
      add :project_type, :string, default: "production", null: false
    end

    # Backfill: every existing row is production. Explicit UPDATE so
    # the NOT NULL default kicks in even if a row had NULL from a
    # prior partial migration (belt-and-braces).
    execute("UPDATE manufacturing_orders SET project_type = 'production' WHERE project_type IS NULL")

    create index(:manufacturing_orders, [:project_type])

    alter table(:companies) do
      # SET NULL so a cell delete doesn't cascade-nuke the company
      # row; the settings screen will re-render "no default set".
      add :rd_consumption_cell_id,
          references(:storage_cells, on_delete: :nilify_all),
          null: true
    end

    create index(:companies, [:rd_consumption_cell_id])

    # Seed the reserved "rnd" tag into every company's registry.
    # ON CONFLICT DO NOTHING so re-running the migration (or seeding
    # a company that already has the tag from an earlier hand-add)
    # doesn't 500. The `key` column has a unique index on
    # (company_id, key) so this composite conflict is the right
    # target.
    execute("""
    INSERT INTO storage_tags (uuid, company_id, key, label, description, kind, inserted_at, updated_at)
    SELECT
      gen_random_uuid(),
      c.id,
      'rnd',
      'R&D',
      'Reserved for R&D / trial-batch inventory. Items tagged rnd only allocate against cells tagged rnd, keeping production and research stock streams separate.',
      'both',
      NOW(),
      NOW()
    FROM companies c
    ON CONFLICT (company_id, key) DO NOTHING
    """)
  end

  def down do
    alter table(:companies) do
      remove :rd_consumption_cell_id
    end

    alter table(:manufacturing_orders) do
      remove :project_type
    end

    # Leave the seeded 'rnd' tag in place on the way down — data
    # migrations aren't cheap to reverse and the tag is harmless
    # even without the columns that reference it.
  end
end
