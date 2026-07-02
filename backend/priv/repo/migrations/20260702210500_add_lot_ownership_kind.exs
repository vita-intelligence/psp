defmodule Backend.Repo.Migrations.AddLotOwnershipKind do
  use Ecto.Migration

  # 3PL bailee custody plumbing. A `stock_lot` we produce in-house for
  # a customer order can, once Positive Release fires, either dispatch
  # directly OR go into 3PL storage — in which case ownership
  # transfers to the customer at the routing action, and we hold the
  # goods as bailee.
  #
  # We snapshot the bailee customer at route-time (`bailee_customer_id`
  # + `bailee_routed_at`) so the audit trail stays stable even if the
  # customer_order line the lot came from is later edited. Billing
  # accrual starts at `bailee_routed_at` and stops at dispatch.
  def change do
    alter table(:stock_lots) do
      add :ownership_kind, :string, default: "own", null: false
      add :bailee_customer_id,
          references(:customers, on_delete: :restrict),
          null: true
      add :bailee_routed_at, :utc_datetime, null: true
    end

    execute(
      """
      ALTER TABLE stock_lots
        ADD CONSTRAINT stock_lots_ownership_kind_check
        CHECK (ownership_kind IN ('own','bailee'))
      """,
      """
      ALTER TABLE stock_lots
        DROP CONSTRAINT IF EXISTS stock_lots_ownership_kind_check
      """
    )

    execute(
      """
      ALTER TABLE stock_lots
        ADD CONSTRAINT stock_lots_bailee_consistency_check
        CHECK (
          (ownership_kind = 'own'
             AND bailee_customer_id IS NULL
             AND bailee_routed_at IS NULL)
          OR
          (ownership_kind = 'bailee'
             AND bailee_customer_id IS NOT NULL
             AND bailee_routed_at IS NOT NULL)
        )
      """,
      """
      ALTER TABLE stock_lots
        DROP CONSTRAINT IF EXISTS stock_lots_bailee_consistency_check
      """
    )

    create index(:stock_lots, [:bailee_customer_id],
             where: "bailee_customer_id IS NOT NULL",
             name: :stock_lots_bailee_customer_id_index
           )
  end
end
