defmodule Backend.Repo.Migrations.AddCustomerInvoiceLineTaxRate do
  use Ecto.Migration

  def change do
    # Per-line VAT rate override. Nullable — when null the line
    # inherits the invoice's aggregate `tax_rate`, which is the
    # single-rate flow every existing invoice used. Populated when
    # the invoice mixes zero-rated / reduced-rate items with the
    # standard rate on the same document (BRCGS-friendly + HMRC
    # standard for a mixed-supply invoice).
    alter table(:customer_invoice_lines) do
      add :tax_rate, :decimal
    end
  end
end
