defmodule Backend.Repo.Migrations.CreatePricelists do
  use Ecto.Migration

  @moduledoc """
  Pricelist registry — the sell-side counterpart of vendor item prices.

  Two-table shape:

    * `pricelists` — header. Name, currency, validity window, default
      flag. A customer can point at exactly one pricelist via
      `customers.pricelist_id`; when nil the company's default
      pricelist is used as fallback.
    * `pricelist_items` — line items. Multiple rows per (pricelist ×
      item) ARE allowed so tiered pricing works: row(item, min_qty=1,
      price=£10), row(item, min_qty=100, price=£9), row(item,
      min_qty=1000, price=£8). The lookup picks the highest min_qty
      whose threshold ≤ requested qty.

  Validity window matters because a renegotiated price shouldn't
  retroactively change orders that were placed under the old rate —
  the future Customer Order line write snapshots `unit_price` onto
  the order line at creation time, but the pricelist lookup itself
  respects `valid_from / valid_until` so an expired pricelist
  doesn't silently quote the wrong number.
  """

  def change do
    create table(:pricelists) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :name, :string, null: false, size: 160
      add :currency_code, :string, size: 3, default: "GBP", null: false

      # Default-pricelist fallback. Only one row per company can have
      # this true at a time; enforced via a partial unique index below.
      add :is_default, :boolean, default: false, null: false

      add :is_active, :boolean, default: true, null: false

      # Validity window — both nullable; nil means "open-ended".
      add :valid_from, :date
      add :valid_until, :date

      add :notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:pricelists, [:uuid])
    create unique_index(:pricelists, [:company_id, :name])

    # Partial unique index: at most one default per company.
    create unique_index(:pricelists, [:company_id],
             where: "is_default = TRUE",
             name: :pricelists_one_default_per_company
           )

    create index(:pricelists, [:company_id, :is_active])
    create index(:pricelists, [:valid_until])

    create table(:pricelist_items) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :pricelist_id, references(:pricelists, on_delete: :delete_all),
        null: false

      add :item_id, references(:items, on_delete: :restrict), null: false

      # Per-line selling price. Stored with high precision so 4-decimal
      # commodity pricing (£/g, $/mL) doesn't lose accuracy when the
      # CO line multiplies by quantity. Display formatting is done at
      # the FE via formatCompanyMoney.
      add :selling_price, :decimal, precision: 18, scale: 4, null: false

      # Lower bound qty threshold for this tier. The lookup picks the
      # highest min_quantity row whose threshold ≤ requested qty.
      # Default 1 ⇒ "any qty".
      add :min_quantity, :decimal, precision: 18, scale: 4, default: 1, null: false

      add :notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:pricelist_items, [:uuid])

    # Unique on (pricelist, item, min_quantity) so we can have multiple
    # tiers but never two duplicate-threshold rows.
    create unique_index(:pricelist_items, [:pricelist_id, :item_id, :min_quantity],
             name: :pricelist_items_tier_unique
           )

    create index(:pricelist_items, [:pricelist_id])
    create index(:pricelist_items, [:item_id])

    # Now that pricelists exist, wire the customers.pricelist_id FK
    # constraint (the column was reserved as a bare bigint in the
    # initial customers migration to avoid a circular dependency on
    # pricelists not existing yet).
    execute(
      """
      ALTER TABLE customers
        ADD CONSTRAINT customers_pricelist_id_fkey
        FOREIGN KEY (pricelist_id)
        REFERENCES pricelists(id)
        ON DELETE SET NULL
      """,
      "ALTER TABLE customers DROP CONSTRAINT customers_pricelist_id_fkey"
    )

    create index(:customers, [:pricelist_id])
  end
end
