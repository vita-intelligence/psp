defmodule Backend.Repo.Migrations.AddGoodsInInspectionToStockLots do
  use Ecto.Migration

  @moduledoc """
  Wire each PO-received lot back to the goods-in inspection that
  governs its QC verdict. The approver's `sign_quality_approver/3`
  queries lots by `goods_in_inspection_id` and emits the per-lot
  lifecycle event from there.

  Nullable on purpose: legacy lots (created before the goods-in flow
  existed) and manual-receive lots (no inspection) keep their
  existing quarantine-by-default → expedite-release path. The link
  is only stamped when the PO-receive endpoint is invoked with a
  `goods_in_inspection_id` in the body.
  """

  def change do
    alter table(:stock_lots) do
      add :goods_in_inspection_id,
          references(:goods_in_inspections, on_delete: :nilify_all)
    end

    # Look up "all lots produced for this PO + this inspection" — hot
    # path on the approver-sign transaction.
    create index(:stock_lots, [:goods_in_inspection_id])
  end
end
