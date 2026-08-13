defmodule Backend.Repo.Migrations.AddCustomerInvoicesDateIndex do
  use Ecto.Migration

  # Statistics endpoints (``Backend.Statistics``) filter customer
  # invoices by ``(company_id, invoice_date BETWEEN ...)`` and
  # aggregate revenue per month / top customers / lifecycle funnel.
  # The create migration ships ``(company_id, status)`` +
  # ``(due_date)`` indexes, but nothing on
  # ``(company_id, invoice_date)`` — so every stats page for a tenant
  # with 100k+ invoices bitmap-scans the status index then heap-reads
  # each row to filter by date. At 500k invoices per company the
  # revenue endpoint stalls the request path 500ms+, holding a pool
  # slot the whole time.
  #
  # A partial composite index on ``(company_id, invoice_date)``
  # WHERE status IN ('sent', 'partially_paid', 'paid') answers the
  # exact query shape with an index-only range scan. Partial keeps
  # the index small (draft/void/cancelled excluded — those don't
  # count toward revenue anyway) so the write-path insert cost is
  # tiny.
  #
  # ``concurrently: true`` + ``@disable_ddl_transaction`` avoids
  # blocking writes on the invoices table during the migration —
  # tenants with active invoicing keep going.
  @disable_ddl_transaction true
  @disable_migration_lock true

  def change do
    create_if_not_exists index(
                           :customer_invoices,
                           [:company_id, :invoice_date],
                           where: "status IN ('sent', 'partially_paid', 'paid')",
                           name: :customer_invoices_revenue_idx,
                           concurrently: true
                         )
  end
end
