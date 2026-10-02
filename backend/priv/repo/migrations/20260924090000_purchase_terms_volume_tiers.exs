defmodule Backend.Repo.Migrations.PurchaseTermsVolumeTiers do
  @moduledoc """
  Allow `vendor_item_purchase_terms` to carry multiple rows per
  (company, vendor, item) differing by `min_quantity` — i.e. volume
  tiers. The schema author left a comment on the original migration
  flagging this exact extension:

      # One term row per (company, vendor, item). Volume tiers would
      # extend this with :min_quantity.

  Changes:

    * `min_quantity` becomes NOT NULL with default 1 so every row has
      a well-defined tier floor. The historic rows get backfilled to
      `1.0` so they continue to behave as the "base tier" (any qty
      from 1 upward uses that price).
    * The unique index switches from `(company, vendor, item)` to
      `(company, vendor, item, min_quantity)` so each tier is its own
      row keyed by its floor.

  Cost-suggest logic (``effective_term_for/4``) picks the highest
  ``min_quantity ≤ qty_ordered`` row for a given purchase.
  """

  use Ecto.Migration

  def change do
    # Backfill nulls so the NOT NULL constraint can stick.
    execute(
      "UPDATE vendor_item_purchase_terms SET min_quantity = 1 WHERE min_quantity IS NULL",
      ""
    )

    execute(
      """
      ALTER TABLE vendor_item_purchase_terms
      ALTER COLUMN min_quantity SET DEFAULT 1,
      ALTER COLUMN min_quantity SET NOT NULL
      """,
      """
      ALTER TABLE vendor_item_purchase_terms
      ALTER COLUMN min_quantity DROP NOT NULL,
      ALTER COLUMN min_quantity DROP DEFAULT
      """
    )

    drop_if_exists index(:vendor_item_purchase_terms,
                     [:company_id, :vendor_id, :item_id],
                     name: :vendor_item_purchase_terms_unique_index
                   )

    create unique_index(
             :vendor_item_purchase_terms,
             [:company_id, :vendor_id, :item_id, :min_quantity],
             name: :vendor_item_purchase_terms_tier_unique_index
           )

    create index(
             :vendor_item_purchase_terms,
             [:company_id, :vendor_id, :item_id, :min_quantity],
             name: :vendor_item_purchase_terms_tier_lookup_index
           )
  end
end
