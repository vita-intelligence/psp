defmodule Backend.Production.WorkstationEvent do
  @moduledoc """
  Append-only audit event on one workstation. The workstation-level
  peer of `Backend.Equipment.Event` — different scope, identical
  event-sourcing pattern.

  Written from vita-perf via the ``/api/integration/workstations/
  :uuid/session-complete/`` callback when an operator closes a
  cleaning or maintenance session. Also writable directly on PSP
  for manual audit notes.

  Rows are immutable at the context boundary. Corrections are new
  events, not edits.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Production.Workstation

  # Same extensibility approach as Equipment.Event — enforced by
  # the changeset, not DB CHECK, so a follow-up PR can grow the
  # vocabulary without a migration.
  @kinds ~w(cleaning_completed maintenance_completed cleaning_started
            maintenance_started note)

  @actor_kinds ~w(user system)

  def kinds, do: @kinds
  def actor_kinds, do: @actor_kinds

  schema "workstation_events" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :kind, :string
    field :actor_kind, :string, default: "user"

    # vita-perf identifiers so the audit row links back to the
    # session + shift that produced it. Nullable — manual notes
    # authored on PSP won't carry these.
    field :vp_session_id, :integer
    field :vp_shift_id, :integer

    # Worker snapshot. `external_id` is the cross-service uuid; the
    # display name is denormalised so the row still renders if the
    # employee is later archived on PSP.
    field :worker_external_id, :string
    field :worker_name, :string

    # Optional link to the DynamicForm response the operator filled.
    field :form_response_uuid, Ecto.UUID

    # Session envelope — self-contained so the FE never has to
    # arithmetic on a row render.
    field :started_at, :utc_datetime
    field :ended_at, :utc_datetime
    field :duration_seconds, :integer

    # Audit line + structured payload. Matches equipment_events
    # shape so a shared "audit row" FE component can render both.
    field :reason, :string
    field :metadata, :map, default: %{}

    belongs_to :company, Company
    belongs_to :workstation, Workstation
    belongs_to :actor, User, foreign_key: :actor_id

    timestamps(type: :utc_datetime)
  end

  @cast_fields ~w(
    uuid company_id workstation_id kind
    actor_kind actor_id
    vp_session_id vp_shift_id
    worker_external_id worker_name
    form_response_uuid
    started_at ended_at duration_seconds
    reason metadata
  )a

  def changeset(event, attrs) do
    event
    |> cast(attrs, @cast_fields)
    |> validate_required([:company_id, :workstation_id, :kind, :actor_kind, :started_at])
    |> validate_inclusion(:kind, @kinds)
    |> validate_inclusion(:actor_kind, @actor_kinds)
    |> validate_length(:reason, max: 2000)
    |> validate_number(:duration_seconds, greater_than_or_equal_to: 0)
    |> ensure_actor_when_user()
    |> assoc_constraint(:company)
    |> assoc_constraint(:workstation)
  end

  # `user` events must carry an actor id — matches equipment_events
  # so the audit trail is never anonymous when it claims to be
  # operator-driven.
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
