defmodule Backend.Stock.WriteOff do
  @moduledoc """
  Formal write-off row. Three-signature audit trail wrapping an
  eventual `adjust_down` movement on the target placement.

  ## Lifecycle

      draft
        │
        │ submit_for_review/2  (creator locks + queues for approval)
        ▼
      pending_approval
        │
        │ approve/3            (approver PIN + note)
        ▼
      pending_authorisation
        │
        │ authorise/3          (authoriser PIN + note; fires the
        │                       actual adjust_down movement)
        ▼
      active
        │
        │ revert/3             (write-off can be undone; writes an
        │                       inverse adjust_up movement, flips
        │                       status → reverted, keeps the row)
        ▼
      reverted

  Any approver/authoriser can send the write-off back to `draft`
  with a rejection note. A `draft` write-off can be deleted outright
  (nothing to reverse — no movement exists yet). `active` and
  `reverted` rows are immutable; only fresh drafts are editable.

  ## Signatures

  Each of `created_by`, `approved_by`, `authorised_by` MUST be
  different users. Enforced in ``Backend.Stock.WriteOffs`` so a
  single seniority can't push a write-off through single-handedly
  (BRCGS §3.11 two-key control extended to three keys for stock
  destruction — matches full GMP practice).

  Each sign-off requires the acting user to re-authenticate with
  their account password. The ``*_at`` timestamp is the record of
  the electronic signature; the auth check happens in the context.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Stock.{Lot, Movement, Placement}
  alias Backend.Warehouses.StorageCell

  @statuses ~w(draft pending_approval pending_authorisation active reverted)

  # Mirror of Movement.reason_categories minus `physical_move` (a
  # move doesn't destroy stock so it can't be a write-off reason).
  @reason_categories ~w(damage expiry qc_fail stock_take_variance
                        theft_loss sample_pull customer_return
                        admin_correction other)

  @disposal_methods ~w(incinerated landfill recycled returned_to_supplier
                       destroyed_on_site other)

  @min_narrative_length 30

  def statuses, do: @statuses
  def reason_categories, do: @reason_categories
  def disposal_methods, do: @disposal_methods
  def min_narrative_length, do: @min_narrative_length

  schema "stock_write_offs" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :qty, :decimal
    field :unit_cost_snapshot, :decimal
    field :currency_snapshot, :string

    field :reason_category, :string
    field :reason_narrative, :string
    field :disposal_method, :string

    field :status, :string, default: "draft"

    field :approved_at, :utc_datetime
    field :approved_note, :string

    field :authorised_at, :utc_datetime
    field :authorised_note, :string

    field :submitted_at, :utc_datetime
    field :activated_at, :utc_datetime

    field :reverted_at, :utc_datetime
    field :revert_reason, :string

    belongs_to :company, Company
    belongs_to :stock_lot, Lot
    belongs_to :placement, Placement
    belongs_to :destination_cell, StorageCell, foreign_key: :destination_cell_id

    belongs_to :created_by, User, foreign_key: :created_by_id
    belongs_to :approved_by, User, foreign_key: :approved_by_id
    belongs_to :authorised_by, User, foreign_key: :authorised_by_id
    belongs_to :reverted_by, User, foreign_key: :reverted_by_id

    belongs_to :linked_movement, Movement, foreign_key: :linked_movement_id
    belongs_to :revert_movement, Movement, foreign_key: :revert_movement_id

    timestamps(type: :utc_datetime)
  end

  @doc """
  Changeset for creating / editing a `draft` write-off. Everything
  is required upfront — the creator can't stash a half-filled draft
  waiting on someone else. Cleaner state machine, cleaner audit.
  """
  def draft_changeset(write_off, attrs) do
    write_off
    |> cast(attrs, [
      :company_id,
      :stock_lot_id,
      :placement_id,
      :qty,
      :unit_cost_snapshot,
      :currency_snapshot,
      :reason_category,
      :reason_narrative,
      :disposal_method,
      :destination_cell_id,
      :created_by_id
    ])
    |> validate_required([
      :company_id,
      :stock_lot_id,
      :qty,
      :reason_category,
      :reason_narrative,
      :disposal_method,
      :created_by_id
    ])
    |> validate_inclusion(:reason_category, @reason_categories)
    |> validate_inclusion(:disposal_method, @disposal_methods)
    |> validate_length(:reason_narrative,
      min: @min_narrative_length,
      message:
        "give at least a sentence or two — auditors need the specifics"
    )
    |> validate_number(:qty, greater_than: 0)
    |> put_change(:status, "draft")
    |> assoc_constraint(:stock_lot)
    |> assoc_constraint(:company)
    |> assoc_constraint(:created_by)
  end

  @doc """
  Status-transition changeset. Used by every state-machine call —
  the caller sets `status` + the sig fields; validation only checks
  that the new status is one of the allowed values.
  """
  def transition_changeset(write_off, attrs) do
    write_off
    |> cast(attrs, [
      :status,
      :submitted_at,
      :approved_by_id,
      :approved_at,
      :approved_note,
      :authorised_by_id,
      :authorised_at,
      :authorised_note,
      :activated_at,
      :reverted_by_id,
      :reverted_at,
      :revert_reason,
      :linked_movement_id,
      :revert_movement_id
    ])
    |> validate_required([:status])
    |> validate_inclusion(:status, @statuses)
  end
end
