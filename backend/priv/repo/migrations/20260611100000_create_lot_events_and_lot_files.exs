defmodule Backend.Repo.Migrations.CreateLotEventsAndLotFiles do
  use Ecto.Migration

  @moduledoc """
  Lot lifecycle event log + evidence file table.

  Workers trigger actions, not states. `stock_lot.status` becomes a
  computed projection of recorded events — receive, route-to-quarantine,
  QC pass/fail, hold/release, dispose, consume-to-zero, cancel. The
  status column stays on the lot row (cheap read for list / queue
  endpoints + a backwards-compat surface for the existing payload), but
  every change is driven by an `lot_events` row written by
  `Backend.Stock.Lifecycle.record_event/4`.

  `lot_files` mirrors `vendor_files`: bytes live in `Backend.Storage`,
  this row carries metadata + the blob path. QC verdicts / disposal
  paperwork / hold justification photos attach here, then the event row
  references the file via `evidence_file_id`. Reusing `vendor_files`
  was tempting but cross-resource ownership makes RBAC + delete cascade
  awkward; a parallel table for lots keeps the boundaries clean.
  """

  def change do
    create table(:lot_files) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :delete_all), null: false
      add :stock_lot_id, references(:stock_lots, on_delete: :delete_all), null: false

      # Tag identifying which artifact this file backs (qc_report,
      # disposal_certificate, hold_notice, …). Free-form — controller
      # validates against a known list.
      add :kind, :string, size: 40, null: false

      add :filename, :string, size: 255, null: false
      add :mime, :string, size: 120, null: false
      add :byte_size, :bigint, null: false
      add :blob_path, :string, size: 500, null: false

      add :uploaded_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:lot_files, [:uuid])
    create index(:lot_files, [:stock_lot_id])
    create index(:lot_files, [:stock_lot_id, :kind])

    create table(:lot_events) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :delete_all), null: false
      add :stock_lot_id, references(:stock_lots, on_delete: :delete_all), null: false

      # The action the actor performed. Validated by the schema; new
      # kinds added here AND in `@event_kinds` on `Backend.Stock.LotEvent`.
      # Stays a string column (not pg_enum) so future additions don't
      # require a schema migration in production.
      add :kind, :string, size: 32, null: false

      # Who did it. `actor_kind` distinguishes operator-initiated events
      # from background cron / system-bootstrap inserts so the timeline
      # can show "system" alongside "Jane Doe" without lying about a
      # user FK.
      add :actor_id, references(:users, on_delete: :nilify_all)
      add :actor_kind, :string, size: 16, null: false, default: "user"

      # The "why" text. For QC fail / dispose / hold this is required at
      # the controller layer; for receive / system-bootstrap it stays
      # nullable so the synthesised backfill rows don't fight a NOT NULL
      # constraint.
      add :reason, :text

      # Evidence the operator uploaded (QC certificate PDF, dispose
      # paperwork, hold notice). nullable — most events don't attach a
      # file, but the column lives at the event row so the auditor sees
      # "this verdict was backed by this file" as one record.
      add :evidence_file_id, references(:lot_files, on_delete: :nilify_all)

      # Append-only JSON bag for kind-specific context. PO receive
      # carries po_line_id + qty; QC pass/fail carries verdict + tester
      # ref; hold/release carries the operator-supplied hold tag. New
      # event kinds can land new keys here without a schema change.
      add :metadata, :map, null: false, default: %{}

      # Logical event time. `inserted_at` from `timestamps/0` is the
      # row's write time; `occurred_at` is when the action happened
      # (matters when a worker records something from a paper log
      # hours later).
      add :occurred_at, :utc_datetime_usec, null: false, default: fragment("now()")

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:lot_events, [:uuid])
    create index(:lot_events, [:stock_lot_id, :occurred_at])
    create index(:lot_events, [:company_id, :kind])

    # Backfill source_kind so the NOT NULL constraint below doesn't
    # break on legacy rows. Manual is the safest default — the only
    # other production path that writes lots today is the manual
    # receive form, which already sets it explicitly.
    execute(
      "UPDATE stock_lots SET source_kind = 'manual' WHERE source_kind IS NULL",
      "UPDATE stock_lots SET source_kind = NULL WHERE source_kind = 'manual'"
    )

    alter table(:stock_lots) do
      modify :source_kind, :string, size: 24, null: false, from: {:string, size: 24}
    end
  end
end
