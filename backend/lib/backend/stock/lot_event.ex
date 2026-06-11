defmodule Backend.Stock.LotEvent do
  @moduledoc """
  Append-only event row for a lot's lifecycle. Receive, route-to-
  quarantine, QC pass/fail, hold, release, dispose, consume-to-zero,
  cancel — every status change is captured by one of these.

  Workers trigger ACTIONS (event kinds); `Backend.Stock.Lifecycle.project_status/1`
  computes the lot's current `status` from the event list. The status
  column on `stock_lots` is the cached projection — kept so list /
  queue endpoints stay cheap — but the source of truth lives here.

  Events are never edited or deleted. Mistakes are corrected by
  recording a counter-event (held → released, qc_passed after a
  premature qc_failed needs a deliberate `held` first to put it back
  in flight). The audit trail is the artefact.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Stock.{Lot, LotFile}

  # Event kinds — the verbs an operator can record against a lot.
  # `expected` is system-emitted on PO line approval; `received` is
  # the physical landing. Everything else is operator-initiated.
  @kinds ~w(expected requested received routed_to_quarantine qc_passed qc_failed
            held released disposed consumed_to_zero canceled)

  # Actor source. `user` = operator pressed the button; `system` =
  # background job / migration backfill; `cron` = scheduled task
  # (future: auto-expire scheduler). Distinguishing them on the
  # timeline matters when an auditor asks "who decided this?"
  @actor_kinds ~w(user system cron)

  def kinds, do: @kinds
  def actor_kinds, do: @actor_kinds

  schema "lot_events" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string
    field :actor_kind, :string, default: "user"
    field :reason, :string
    field :metadata, :map, default: %{}
    field :occurred_at, :utc_datetime_usec

    belongs_to :company, Company
    belongs_to :stock_lot, Lot
    belongs_to :actor, User, foreign_key: :actor_id
    belongs_to :evidence_file, LotFile, foreign_key: :evidence_file_id

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(event, attrs) do
    event
    |> cast(attrs, [
      :company_id,
      :stock_lot_id,
      :kind,
      :actor_id,
      :actor_kind,
      :reason,
      :evidence_file_id,
      :metadata,
      :occurred_at
    ])
    |> validate_required([:company_id, :stock_lot_id, :kind, :actor_kind, :occurred_at])
    |> validate_inclusion(:kind, @kinds)
    |> validate_inclusion(:actor_kind, @actor_kinds)
    |> validate_length(:reason, max: 2000)
    |> validate_actor_shape()
  end

  # `user` events need an actor FK; `system` and `cron` events stand
  # alone so we don't synthesise a fake user.
  defp validate_actor_shape(changeset) do
    case get_field(changeset, :actor_kind) do
      "user" ->
        case get_field(changeset, :actor_id) do
          nil -> add_error(changeset, :actor_id, "is required for user-recorded events")
          _ -> changeset
        end

      _ ->
        changeset
    end
  end
end
