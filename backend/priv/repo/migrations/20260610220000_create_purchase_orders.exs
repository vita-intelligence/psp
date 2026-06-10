defmodule Backend.Repo.Migrations.CreatePurchaseOrders do
  use Ecto.Migration

  @moduledoc """
  Purchase orders + lines + approval signatures.

  Status flow (enforced in `Backend.Purchasing.PurchaseOrders`):

      draft
        ↓ submit (creator)
      pending_approver
        ↓ approver signs
      pending_director
        ↓ director signs
      approved
        ↓ mark as ordered (sent to vendor)
      ordered
        ↓ receive_against_po (each receipt)
      partially_received → received   (terminal)

      any non-terminal → cancelled   (with reason)

  Two-tier ESIGN: every PO needs both an `approver` signature and a
  `director` signature (different users — segregation of duties).
  Signatures are stored as their own rows so the audit trail keeps
  them after the PO transitions through further states.
  """

  def change do
    create table(:purchase_orders) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :status, :string, size: 30, default: "draft", null: false

      add :vendor_id, references(:vendors, on_delete: :restrict), null: false
      add :currency_code, :string, size: 3, default: "GBP", null: false

      # Header totals — computed in the context on every line change so
      # the FE doesn't have to sum across lines on every render.
      add :subtotal, :decimal, precision: 14, scale: 4, default: 0, null: false
      add :tax_amount, :decimal, precision: 14, scale: 4, default: 0, null: false
      add :total_amount, :decimal, precision: 14, scale: 4, default: 0, null: false

      add :expected_delivery_date, :date
      add :delivery_address, :text
      add :notes, :text

      # State-transition timestamps.
      add :submitted_at, :utc_datetime
      add :ordered_at, :utc_datetime
      add :received_at, :utc_datetime
      add :cancelled_at, :utc_datetime
      add :cancellation_reason, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false
      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)
      add :submitted_by_id, references(:users, on_delete: :nilify_all)
      add :ordered_by_id, references(:users, on_delete: :nilify_all)
      add :cancelled_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:purchase_orders, [:uuid])
    create index(:purchase_orders, [:company_id, :status])
    create index(:purchase_orders, [:vendor_id])
    create index(:purchase_orders, [:expected_delivery_date])

    create table(:purchase_order_lines) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :purchase_order_id,
          references(:purchase_orders, on_delete: :delete_all),
          null: false

      add :item_id, references(:items, on_delete: :restrict), null: false

      add :qty_ordered, :decimal, precision: 14, scale: 4, null: false
      add :qty_received, :decimal, precision: 14, scale: 4, default: 0, null: false
      add :unit_price, :decimal, precision: 14, scale: 4, default: 0, null: false

      # `qty_ordered * unit_price`. Stored for ORDER BY + footer
      # summation without a CTE — bumped on every line save.
      add :line_subtotal, :decimal, precision: 14, scale: 4, default: 0, null: false

      add :expected_delivery_date, :date
      add :notes, :text

      add :company_id, references(:companies, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:purchase_order_lines, [:uuid])
    create index(:purchase_order_lines, [:purchase_order_id])
    create index(:purchase_order_lines, [:item_id])

    create table(:purchase_order_approvals) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :purchase_order_id,
          references(:purchase_orders, on_delete: :delete_all),
          null: false

      # `approver` (line manager / procurement lead) or `director`.
      add :kind, :string, size: 20, null: false

      add :signed_at, :utc_datetime, null: false
      add :notes, :text

      # Base64-encoded PNG of the signature pad capture. Optional —
      # not every shop runs a signature pad, but the audit row still
      # records who clicked Approve.
      add :signature_image, :text

      add :signed_by_id, references(:users, on_delete: :nilify_all), null: false
      add :company_id, references(:companies, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:purchase_order_approvals, [:uuid])

    create unique_index(:purchase_order_approvals, [:purchase_order_id, :kind],
             name: :purchase_order_approvals_po_kind_index
           )

    create index(:purchase_order_approvals, [:signed_by_id])
  end
end
