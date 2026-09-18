defmodule Backend.Repo.Migrations.RmaOptionalCustomer do
  @moduledoc """
  Drops NOT NULL on `customer_returns.customer_id` +
  `customer_returns.customer_invoice_id`. RMA now supports:

    * **Customer returns** — customer + invoice populated (existing
      shape, credit-note flow auto-fires on accept).
    * **Internal returns** — both nullable. Used for trial batches,
      R&D samples, quarantine re-inspection of our own product
      where no customer or invoice ever existed.

  Same paperwork surface, same GII pipe, same lifecycle for both
  shapes. The `accept` flow's ``maybe_issue_credit_note`` already
  no-ops when there's no invoice to credit against, so nothing on
  the finance side breaks — an internal-return acceptance just
  closes the RMA without a monetary side effect.
  """

  use Ecto.Migration

  def up do
    # Raw ALTER — Ecto's `modify` on a FK column would try to
    # recreate the FK constraint, which fails on the existing one.
    execute "ALTER TABLE customer_returns ALTER COLUMN customer_id DROP NOT NULL"
    execute "ALTER TABLE customer_returns ALTER COLUMN customer_invoice_id DROP NOT NULL"
  end

  def down do
    execute "ALTER TABLE customer_returns ALTER COLUMN customer_id SET NOT NULL"
    execute "ALTER TABLE customer_returns ALTER COLUMN customer_invoice_id SET NOT NULL"
  end
end
