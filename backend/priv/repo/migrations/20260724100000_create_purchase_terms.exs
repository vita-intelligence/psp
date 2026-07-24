defmodule Backend.Repo.Migrations.CreatePurchaseTerms do
  use Ecto.Migration

  @moduledoc """
  Per (vendor, item) commercial baseline the buyer negotiates with a
  supplier. Distinct from `vendor_item_prices`, which is a rolling
  cache of what we've actually paid on POs. `purchase_terms` is what
  the vendor *quoted* — the fallback the "suggest unit price" endpoint
  reaches for when there's no PO history yet.

  Multiple vendors can hold terms for the same item; `priority` ranks
  them so the primary vendor's price becomes the item's default cost
  (BOM roll-up, spec sheets). Unique on (company, vendor, item) —
  volume-tier pricing would extend by adding min_quantity to the
  unique index, but for now one row per pair.

  Approval coupling: the create/update path validates a matching
  row in `vendor_approved_items` exists — nothing commercial is
  quotable until qualification is signed (CLAUDE.md rule).
  """

  def change do
    create table(:vendor_item_purchase_terms) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :vendor_id, references(:vendors, on_delete: :delete_all), null: false
      add :item_id, references(:items, on_delete: :delete_all), null: false

      # Vendor's SKU for our item. Threaded through PO line docs so
      # the supplier's downstream systems (WMS, portals) recognise
      # what we're asking for.
      add :vendor_part_no, :string, size: 100

      add :lead_time_days, :integer

      # Quoted price + currency. ISO 4217, normalised uppercase at
      # write time. Currency is per-row so a vendor quoting in USD for
      # one item and EUR for another survives.
      add :price, :decimal, precision: 12, scale: 4, null: false
      add :currency_code, :string, size: 3, null: false

      # Minimum order quantity + its UoM (typically kg / units / L).
      # UoM stored as a free string sourced from the item's UoM at
      # create time so historical rows keep their original unit even
      # if the item's canonical UoM changes later.
      add :min_quantity, :decimal, precision: 14, scale: 4
      add :min_quantity_uom, :string, size: 20

      # Ranking among vendors for THIS item. 1 = primary, drives the
      # item's default_cost + PO auto-vendor pick. Higher number =
      # lower priority. Not unique — two vendors can share a rank if
      # the buyer treats them as equivalent alternates.
      add :priority, :integer, default: 1, null: false

      # Optional expiry window. Terms outside their valid range still
      # display but with a "stale" affordance; the fallback chain
      # skips them so the buyer notices they need re-negotiation.
      add :valid_from, :date
      add :valid_until, :date

      add :notes, :text

      # Audit trail — who last touched this row. Nullable to survive
      # deleted user accounts; the audit_log has the immutable record.
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:vendor_item_purchase_terms, [:uuid])

    # One term row per (company, vendor, item). Volume tiers would
    # extend this with :min_quantity.
    create unique_index(
             :vendor_item_purchase_terms,
             [:company_id, :vendor_id, :item_id],
             name: :vendor_item_purchase_terms_unique_index
           )

    # Item detail page's Purchase-terms table sorts by priority asc.
    create index(
             :vendor_item_purchase_terms,
             [:company_id, :item_id, :priority],
             name: :vendor_item_purchase_terms_item_priority_index
           )

    # Vendor detail page's Purchase-terms card lists all this vendor's
    # terms; grouped by item on the FE.
    create index(
             :vendor_item_purchase_terms,
             [:company_id, :vendor_id],
             name: :vendor_item_purchase_terms_vendor_index
           )
  end
end
