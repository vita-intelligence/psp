defmodule Backend.Equipment.Event do
  @moduledoc """
  Append-only lifecycle event for an equipment unit. Same shape as
  `Backend.Stock.LotEvent` — event kinds drive the state projection
  (see `Backend.Equipment.Lifecycle`), and each row carries the
  actor + reason + optional structured metadata.

  Events are immutable at the DB level (no update path in the
  context module). Corrections are recorded as new events, not
  edits.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Equipment.Equipment
  alias Backend.Warehouses.StorageCell

  # Event vocabulary. `note` is the free-form entry; all others
  # correspond to specific lifecycle transitions handled by the
  # Lifecycle module in a follow-up PR.
  @kinds ~w(received in_service maintenance_started maintenance_completed
            calibrated moved assigned unassigned retired disposed note)

  @actor_kinds ~w(user system)

  def kinds, do: @kinds
  def actor_kinds, do: @actor_kinds

  schema "equipment_events" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :kind, :string
    field :actor_kind, :string, default: "user"
    field :reason, :string
    field :metadata, :map, default: %{}
    field :occurred_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :equipment, Equipment
    belongs_to :actor, User, foreign_key: :actor_id
    belongs_to :from_cell, StorageCell, foreign_key: :from_cell_id
    belongs_to :to_cell, StorageCell, foreign_key: :to_cell_id
    belongs_to :assigned_to_user, User, foreign_key: :assigned_to_user_id

    timestamps(type: :utc_datetime)
  end

  def changeset(event, attrs) do
    event
    |> cast(attrs, [
      :uuid,
      :company_id,
      :equipment_id,
      :kind,
      :actor_kind,
      :actor_id,
      :reason,
      :metadata,
      :from_cell_id,
      :to_cell_id,
      :assigned_to_user_id,
      :occurred_at
    ])
    |> validate_required([:company_id, :equipment_id, :kind, :actor_kind, :occurred_at])
    |> validate_inclusion(:kind, @kinds)
    |> validate_inclusion(:actor_kind, @actor_kinds)
    |> validate_length(:reason, max: 2000)
    |> ensure_actor_when_user()
  end

  # When actor_kind == "user" we require an actor_id — system
  # events are the only path allowed to leave the actor blank.
  defp ensure_actor_when_user(changeset) do
    kind = get_field(changeset, :actor_kind)
    actor = get_field(changeset, :actor_id)

    if kind == "user" and is_nil(actor) do
      add_error(changeset, :actor_id, "required for user-initiated events")
    else
      changeset
    end
  end
end
