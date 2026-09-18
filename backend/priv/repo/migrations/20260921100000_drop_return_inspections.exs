defmodule Backend.Repo.Migrations.DropReturnInspections do
  @moduledoc """
  Drop the short-lived `return_inspections` + `return_inspection_packages`
  tables. RMA inspections now live in `goods_in_inspections` alongside
  supplier deliveries (see the earlier
  `goods_in_inspections_support_rma` migration).

  Down-migration re-creates empty tables in the original shape so the
  rollback replay stays reversible; historical data is not restored
  (there wasn't any to preserve — this was a green-field feature that
  never went to prod).
  """

  use Ecto.Migration

  def up do
    drop_if_exists table(:return_inspection_packages)
    drop_if_exists table(:return_inspections)
  end

  def down do
    create table(:return_inspections) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :status, :string, size: 30, null: false, default: "draft"

      add :customer_return_id,
          references(:customer_returns, on_delete: :restrict),
          null: false

      add :delivery_date, :date
      add :delivery_time, :time
      add :courier, :string, size: 160
      add :tracking_number, :string, size: 80
      add :seal_number, :string, size: 80
      add :physical_inspection, :jsonb, default: fragment("'{}'")
      add :food_safety_checks, :jsonb, default: fragment("'{}'")
      add :storage_verification, :jsonb, default: fragment("'{}'")
      add :quality_decision, :string, size: 20
      add :quality_decision_reason, :text

      add :goods_in_operator_id, references(:users, on_delete: :restrict)
      add :goods_in_operator_signature_image, :text
      add :goods_in_operator_signed_at, :utc_datetime

      add :quality_approver_id, references(:users, on_delete: :restrict)
      add :quality_approver_signature_image, :text
      add :quality_approver_signed_at, :utc_datetime

      add :company_id,
          references(:companies, on_delete: :restrict),
          null: false

      add :created_by_id, references(:users, on_delete: :restrict), null: false
      add :updated_by_id, references(:users, on_delete: :restrict), null: false

      timestamps(type: :utc_datetime)
    end

    create table(:return_inspection_packages) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")

      add :return_inspection_id,
          references(:return_inspections, on_delete: :delete_all),
          null: false

      add :customer_return_line_id,
          references(:customer_return_lines, on_delete: :restrict),
          null: false

      add :qty, :decimal, precision: 20, scale: 5, null: false
      add :package_length_mm, :integer
      add :package_width_mm, :integer
      add :package_height_mm, :integer
      add :package_weight_kg, :decimal, precision: 10, scale: 3
      add :condition_notes, :text

      add :destination_cell_id,
          references(:storage_cells, on_delete: :restrict)

      add :stock_lot_id, references(:stock_lots, on_delete: :nilify_all)

      add :company_id,
          references(:companies, on_delete: :restrict),
          null: false

      timestamps(type: :utc_datetime)
    end
  end
end
