defmodule Backend.Repo.Migrations.StockLotReturnLineage do
  @moduledoc """
  Adds the two FKs that let a returned batch trace back to its
  origin: `parent_lot_id` (the lot the customer originally bought)
  and `customer_return_id` (the RMA event that brought it back).

  A return lot is a NEW stock_lot (per BRCGS §3.11 and every
  pharma-ERP convention — returned goods enter quarantine, need
  re-QC, and can't reuse the original lot's identity because their
  storage conditions in transit + at the customer are unknown to
  us). These two FKs are how the recall report answers
  "where did every unit of L00002 end up, including returns?" as a
  single query instead of a text hunt.

  Both nullable — most lots aren't return lots. Indexed for the
  recall / return-history queries the FE will run.
  """

  use Ecto.Migration

  def change do
    alter table(:stock_lots) do
      add :parent_lot_id, references(:stock_lots, on_delete: :restrict)
      add :customer_return_id,
          references(:customer_returns, on_delete: :restrict)
    end

    create index(:stock_lots, [:parent_lot_id],
             where: "parent_lot_id IS NOT NULL",
             name: :stock_lots_parent_lot_id_idx
           )

    create index(:stock_lots, [:customer_return_id],
             where: "customer_return_id IS NOT NULL",
             name: :stock_lots_customer_return_id_idx
           )
  end
end
