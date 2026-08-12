defmodule Backend.Repo.Migrations.AddNpdPaymentToCustomerOrders do
  use Ecto.Migration

  # NPD payment metadata mirrored onto the CO — populated by the
  # sample-fulfilment sync so the PSP invoice section can show the
  # payment record (amount, invoice number, paid date, attached files)
  # instead of the default "No invoice attached. Generate invoice?"
  # prompt. For sample-kind COs the payment IS the invoice — the
  # customer paid on NPD, finance approved on NPD, no PSP-side invoice
  # is needed.
  #
  # All fields nullable so historic sample COs pre-dating this feature
  # keep working (the panel just shows the old empty state).
  #
  # ``npd_payment_files`` is a JSONB list of ``{uuid, filename, mime,
  # byte_size, uploaded_at}`` — the file bytes stay on NPD; PSP
  # renders filenames + metadata only. A future migration can add a
  # PSP-side proxy download; today the panel is metadata-first.
  def change do
    alter table(:customer_orders) do
      add :npd_payment_id, :uuid, null: true
      add :npd_payment_amount, :decimal, precision: 14, scale: 2, null: true
      add :npd_payment_currency, :string, size: 3, null: true
      add :npd_payment_invoice_number, :string, size: 64, null: true
      add :npd_payment_paid_at, :utc_datetime, null: true
      add :npd_payment_status, :string, size: 16, null: true
      add :npd_payment_files, {:array, :map}, null: false, default: []
    end

    # Partial index for the "list COs with an NPD payment" case a
    # future finance dashboard might want. Cheap to maintain since
    # sample COs are the minority.
    create index(:customer_orders, [:npd_payment_id],
             where: "npd_payment_id IS NOT NULL",
             name: :customer_orders_npd_payment_id_idx
           )
  end
end
