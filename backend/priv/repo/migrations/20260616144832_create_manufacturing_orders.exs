defmodule Backend.Repo.Migrations.CreateManufacturingOrders do
  use Ecto.Migration

  @moduledoc """
  Manufacturing orders — a planned run that turns a BOM's inputs
  into N units of a finished item. The form mirrors MRPEasy's
  "Create a manufacturing order".

  Status machine (this round ships transitions without the real
  stock effect — completing the MO just flips status; future work
  consumes the BOM's input lots + creates the output lot):

      draft
        ├─ approved  (mo_approve)
        │    ├─ in_progress (mo_execute)
        │    │    └─ completed (mo_execute)
        │    └─ cancelled (mo_execute)
        └─ cancelled (mo_execute)

  Identity / traceability fields:
    * `bom_id` is required — an MO without a recipe can't run.
    * `routing_id` nullable — derived from the connected BOM when
      that BOM has a routing tied to it. Stays editable per MO so
      operators can swap routings for a specific run.
    * `revision` string ("V00", "V01") so re-runs of the same
      product against the same BOM stay distinguishable on the
      schedule + audit.
  """

  def change do
    create table(:manufacturing_orders) do
      add :uuid, :uuid, null: false

      add :company_id, references(:companies, on_delete: :restrict), null: false

      # Site — must be kind=production_facility; enforced in the
      # context layer rather than DB constraint so the FK stays a
      # plain integer reference (cleaner cross-context queries).
      add :warehouse_id, references(:warehouses, on_delete: :restrict),
        null: false

      add :item_id, references(:items, on_delete: :restrict), null: false
      add :bom_id, references(:boms, on_delete: :restrict), null: false
      add :routing_id, references(:routings, on_delete: :restrict)

      add :quantity, :decimal, precision: 14, scale: 4, null: false

      add :due_date, :date
      add :start_at, :utc_datetime, null: false
      add :finish_at, :utc_datetime, null: false
      add :expiry_date, :date

      add :assigned_to_id, references(:users, on_delete: :restrict), null: false

      add :revision, :string, size: 16, default: "V00", null: false

      # Status enum + approval bookkeeping. `approved_at` doubles as
      # the "moved to approved at" timestamp; `approved_by_id` is
      # the user who flipped the checkbox.
      add :status, :string, size: 24, default: "draft", null: false
      add :approved_by_id, references(:users, on_delete: :nilify_all)
      add :approved_at, :utc_datetime

      add :notes, :text

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:manufacturing_orders, [:uuid])
    create index(:manufacturing_orders, [:company_id])
    create index(:manufacturing_orders, [:warehouse_id])
    create index(:manufacturing_orders, [:item_id])
    create index(:manufacturing_orders, [:bom_id])
    create index(:manufacturing_orders, [:status])
    create index(:manufacturing_orders, [:assigned_to_id])

    create constraint(:manufacturing_orders, :manufacturing_orders_quantity_positive,
             check: "quantity > 0"
           )

    create constraint(:manufacturing_orders, :manufacturing_orders_finish_after_start,
             check: "finish_at >= start_at"
           )

    create constraint(:manufacturing_orders, :manufacturing_orders_status_known,
             check:
               "status in ('draft', 'approved', 'in_progress', 'completed', 'cancelled')"
           )
  end
end
