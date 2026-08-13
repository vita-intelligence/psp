defmodule Backend.Repo.Migrations.AddQtyNonNegativeCheckToPlacements do
  use Ecto.Migration

  # Hard database CHECK so raw SQL, migration typos, or a bad
  # context function can't push ``stock_lot_placements.qty`` negative.
  #
  # The changeset already validates ``greater_than_or_equal_to: 0``,
  # but changeset validation only runs when writes go through
  # ``Placement.changeset/2``. A stray ``UPDATE stock_lot_placements
  # SET qty = qty - X`` (support script, DBA fix, future context
  # function) can create negative rows — and every read filters
  # ``WHERE qty > 0``, so negative rows become invisible to on-hand
  # queries. The lot's placement sum then quietly diverges from its
  # ``qty_received``, breaking BRCGS traceability.
  #
  # DDL-safe: no data change; if any row is already negative the
  # migration will fail loud so we discover the drift before locking
  # it in. Add ``concurrently`` isn't available for CHECK constraints
  # in Postgres, so we take a brief AccessExclusiveLock on the table
  # — acceptable since the table is small on any live deployment
  # relative to shipments / audit_records.
  def change do
    create constraint(:stock_lot_placements, :qty_non_negative,
             check: "qty >= 0"
           )
  end
end
