defmodule Backend.Repo.Migrations.CreateStockMovements do
  use Ecto.Migration

  @moduledoc """
  Immutable audit row for every qty change on a lot. Placements are
  the mutable current-state view; movements are the append-only log
  that lets us reconstruct any historical balance.

  `delta_qty` is signed — receive / move-in / adjust-up are positive,
  consume / move-out / adjust-down / dispose are negative. `from_cell_id`
  and `to_cell_id` describe a move: receive sets only `to`, dispose
  sets only `from`.
  """

  def change do
    create table(:stock_movements) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies), null: false
      add :stock_lot_id, references(:stock_lots, on_delete: :delete_all),
        null: false

      # null for receive (incoming) / dispose (outgoing) movements
      # depending on direction.
      add :from_cell_id, references(:storage_cells, on_delete: :nilify_all)
      add :to_cell_id, references(:storage_cells, on_delete: :nilify_all)

      add :delta_qty, :decimal, precision: 14, scale: 4, null: false

      # Short enum: receive / move / consume / adjust_up / adjust_down
      # / dispose / return. The kind drives which from/to cells are
      # required; the context validates the shape.
      add :kind, :string, null: false, size: 24

      add :reason, :text

      # External document that drove this movement (PO, MO, SO,
      # transfer order). Same polymorphic pattern as stock_lots.source_*.
      add :reference_kind, :string, size: 24
      add :reference_ref, :string, size: 80

      add :actor_id, references(:users, on_delete: :nilify_all)
      add :occurred_at, :utc_datetime, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:stock_movements, [:uuid])
    # Common read pattern: lot detail page renders its movements
    # newest-first. `occurred_at` (operator-stated time) is the
    # canonical sort, falling back to id for deterministic ordering
    # of same-second writes.
    create index(:stock_movements, [:stock_lot_id, :occurred_at, :id])
    create index(:stock_movements, [:company_id, :occurred_at])
    create index(:stock_movements, [:from_cell_id])
    create index(:stock_movements, [:to_cell_id])
  end
end
