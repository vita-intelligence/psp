defmodule Backend.Repo.Migrations.CreateStockWriteOffs do
  @moduledoc """
  Formal write-off workflow with three-signature approval.

  Rationale
  ---------

  Adjust-to-zero on a lot is now blocked in `Backend.Stock` — the
  operator has to file a Write-Off instead. The write-off carries
  the regulatory paperwork BRCGS §5.9 (waste) + GMP Ch 5 + §3.11
  (non-conforming product) expect: reason category, disposal
  method, narrative, evidence attachments, unit cost snapshot for
  accounting, and three sequential signatures (creator, approver,
  authoriser) each with a re-authentication timestamp before the
  actual `adjust_down` movement fires.

  Reverting a write-off writes the inverse movement + preserves the
  original row with `status = "reverted"` so the audit chain is
  never broken (BRCGS §4.14).
  """

  use Ecto.Migration

  def change do
    create table(:stock_write_offs) do
      add :uuid, :uuid, null: false
      # Auto-numbered code (WO00042) via Backend.Numbering. Populated
      # on insert so the operator can reference the write-off in
      # conversation before the movement fires.
      # Nullable at DB level so the numbering render can happen after
      # insert; app enforces its presence on the returned struct.

      add :stock_lot_id,
          references(:stock_lots, on_delete: :restrict),
          null: false

      # Nullable — a lot may be split across cells. When set, this is
      # the specific placement the write-off draws from. Nil = the
      # whole lot's on-hand across every placement (the caller
      # resolves at ``active`` time).
      add :placement_id,
          references(:stock_lot_placements, on_delete: :restrict)

      add :qty, :decimal, precision: 20, scale: 5, null: false
      # Cost snapshot taken at draft-creation. Persists even if the
      # underlying lot's unit_cost gets retroactively adjusted so the
      # accounting export shows the value at the moment of decision.
      add :unit_cost_snapshot, :decimal, precision: 12, scale: 4
      add :currency_snapshot, :string, size: 8

      # Same closed enum used on Movement.reason_category. Free-text
      # ``reason_narrative`` below carries the specifics.
      add :reason_category, :string, size: 32, null: false
      add :reason_narrative, :text, null: false

      # BRCGS §5.9.2 — where the physical goods went.
      add :disposal_method, :string, size: 32, null: false
      # Optional: cell the write-off is currently sitting in
      # (typically a `rejected` purpose cell) until physical
      # destruction. Kept for warehouse readers who want to see
      # "this qty is waiting to leave the site".
      add :destination_cell_id,
          references(:storage_cells, on_delete: :restrict)

      # State machine — see `Backend.Stock.WriteOff.@statuses`.
      add :status, :string, size: 32, null: false, default: "draft"

      add :company_id,
          references(:companies, on_delete: :restrict),
          null: false

      # Three-signature audit — each row is one atomic identity +
      # timestamp. The `*_note` fields capture the reviewer's
      # rationale + tie into the chat trail for cross-reference.
      add :created_by_id,
          references(:users, on_delete: :restrict),
          null: false

      add :approved_by_id, references(:users, on_delete: :restrict)
      add :approved_at, :utc_datetime
      add :approved_note, :text

      add :authorised_by_id, references(:users, on_delete: :restrict)
      add :authorised_at, :utc_datetime
      add :authorised_note, :text

      add :submitted_at, :utc_datetime
      add :activated_at, :utc_datetime

      # Revert path — set when an active write-off is undone. The row
      # stays for the audit chain; status flips to `reverted`.
      add :reverted_by_id, references(:users, on_delete: :restrict)
      add :reverted_at, :utc_datetime
      add :revert_reason, :text

      # Links to the stock_movement pair once active:
      #   * `linked_movement_id` — the `adjust_down` written when
      #     activated. Filled at status → active.
      #   * `revert_movement_id` — the `adjust_up` written on revert.
      add :linked_movement_id, references(:stock_movements, on_delete: :nilify_all)
      add :revert_movement_id, references(:stock_movements, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:stock_write_offs, [:uuid])
    create index(:stock_write_offs, [:company_id, :status, :inserted_at])
    create index(:stock_write_offs, [:stock_lot_id])
    create index(:stock_write_offs, [:reason_category])
    create index(:stock_write_offs, [:created_by_id])
  end
end
