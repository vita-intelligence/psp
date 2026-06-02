defmodule Backend.Audit.AuditEvent do
  @moduledoc """
  One row per mutation across every audited entity. See the
  CreateAuditLog migration for the shape's reasoning.
  """

  use Ecto.Schema

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  @primary_key {:id, :id, autogenerate: true}
  schema "audit_events" do
    field :entity_type, :string
    field :entity_id, :integer
    field :entity_uuid, Ecto.UUID

    # `created` / `updated` / `deleted`.
    field :event, :string

    # Snapshot of actor identity at time of event — preserved so a
    # later rename / deactivation doesn't break the history readout.
    field :actor_snapshot, :map, default: %{}

    # Per-field diff. `%{"name" => %{"old" => ..., "new" => ...}}`.
    field :changes, :map, default: %{}

    # Full audit-field snapshot at the moment after this event. Used
    # by the "Restore version" UI to repopulate a form with the values
    # from this point in time.
    field :state_after, :map, default: %{}

    field :at, :utc_datetime_usec

    belongs_to :company, Company
    belongs_to :actor, User
  end
end
