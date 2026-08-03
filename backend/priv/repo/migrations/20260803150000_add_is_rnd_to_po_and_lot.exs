defmodule Backend.Repo.Migrations.AddIsRndToPoAndLot do
  use Ecto.Migration

  @moduledoc """
  Lot-level R&D stream flag — the simple version.

  Same item catalog for production and R&D, but the physical
  inventory is separate. A lot is R&D stock iff it was received on a
  PO marked "For R&D"; the flag is set once at receive-time and never
  flips. MO booking filters lots by matching stream (trial/sample
  MOs book only ``is_rnd = true``, production MOs book only
  ``is_rnd = false``).

  Schema:

    * ``purchase_orders.is_rnd`` — operator toggle at PO create;
      default false so every existing / imported PO stays production
      without a data migration.
    * ``stock_lots.is_rnd`` — copied from the parent PO at
      ``Purchasing.build_lot_attrs``. Also default false so lots born
      outside the PO-receive flow (manual receive, MO output, opening
      balance) default to production. When a trial MO produces output,
      the produced-lot writer should stamp true.

  The ``rnd`` cell tag stays the way it was — cells tagged ``rnd``
  are the R&D shelves the receive form auto-suggests when the PO is
  R&D. Cell tags remain the UX cue; the ``is_rnd`` boolean is the
  source of truth for booking allocation.

  Also flips the seeded ``rnd`` tag registry entry from ``kind=both``
  to ``kind=cell`` — item-side tagging is no longer meaningful (items
  are shared across streams). Existing item rows keep any ``rnd`` in
  their ``storage_tags`` array; the tag just becomes UX/informational
  on the item side instead of a booking-time guard.
  """

  def change do
    alter table(:purchase_orders) do
      add :is_rnd, :boolean, default: false, null: false
    end

    alter table(:stock_lots) do
      add :is_rnd, :boolean, default: false, null: false
    end

    # Partial indices so the "show me all R&D X" listing pages stay
    # cheap — >99% of rows will be production and we don't want to
    # index those in the R&D filter.
    create index(:purchase_orders, [:company_id, :is_rnd],
             where: "is_rnd = true",
             name: :purchase_orders_rnd_partial_idx
           )

    create index(:stock_lots, [:company_id, :is_rnd],
             where: "is_rnd = true",
             name: :stock_lots_rnd_partial_idx
           )

    # Retag the reserved ``rnd`` registry entry as cell-only. Items
    # still might carry ``rnd`` in their storage_tags array (legacy),
    # but the tag has no allocation-time meaning on the item side
    # anymore — separation lives on the lot / cell axis.
    execute(
      "UPDATE storage_tags SET kind = 'cell' WHERE key = 'rnd'",
      "UPDATE storage_tags SET kind = 'both' WHERE key = 'rnd'"
    )
  end
end
