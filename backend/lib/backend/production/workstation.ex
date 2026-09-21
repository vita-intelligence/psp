defmodule Backend.Production.Workstation do
  @moduledoc """
  One physical workstation — a single machine, packaging line slot,
  or capsulator cell — inside a workstation group on a production site.

  Schedule + future manufacturing orders consume time against this
  row. Performance reporting (capacity, OEE, on-time close) feeds
  back from vita-performance via the `external_id` join key.

  Inheritance: when `hourly_rate_enabled` is false, scheduling
  reads the parent workstation_group's hourly_rate. The toggle exists
  so a single station inside an otherwise-uniform group can override
  for e.g. a senior operator's premium rate.

  Validation rules:
    * `productivity` strictly positive
    * `idle_from <= idle_to` when either is set
    * `name` unique per company
    * `hourly_rate` required + non-negative iff `hourly_rate_enabled`
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Production.{WorkstationDefaultWorker, WorkstationGroup}
  alias Backend.Warehouses.Warehouse

  # Cleaning + maintenance cadence share the same periodicity enum,
  # which also matches the maintenance-task periodicity list so all
  # three features can share `compute_next_due` math.
  @cleaning_periodicities ~w(daily weekly monthly quarterly half_yearly yearly two_yearly three_yearly)
  @maintenance_periodicities @cleaning_periodicities

  def cleaning_periodicities, do: @cleaning_periodicities
  def maintenance_periodicities, do: @maintenance_periodicities

  schema "workstations" do
    field :uuid, Ecto.UUID, autogenerate: true
    # Sync hook with vita-performance — populated by the cross-system
    # sync job (not yet implemented). Manual edits are blocked at the
    # context layer.
    field :external_id, Ecto.UUID
    field :name, :string
    field :notes, :string

    field :hourly_rate_enabled, :boolean, default: false
    field :hourly_rate, :decimal

    field :productivity, :decimal, default: Decimal.new("1.0")

    field :idle_from, :date
    field :idle_to, :date

    field :is_active, :boolean, default: true

    # Default `true` — every new workstation is visible to the
    # vita-performance kiosk by default. Operators can still opt a
    # station out via the "Local only" toggle on the workstation form
    # for the rare case where a genuinely-local station shouldn't
    # accept sessions (setup shells, dev fixtures, ...).
    #
    # Was `default: false` originally (phase-6 defensive default —
    # avoided showing half-configured stations on the kiosk before an
    # operator had wired workstation groups + costs). In practice
    # nobody remembered to flip it and freshly-created stations
    # stayed invisible forever; cost of the confusion exceeded the
    # defensive value, hence the flip. See migration
    # ``20260917110000_default_psp_source_of_truth_true``.
    field :psp_source_of_truth, :boolean, default: true

    # Station-specific override for the workstation_group's
    # default operation notes. When non-nil, takes precedence on the
    # routing-step prefill once a station is picked. When nil, the
    # parent group's value applies.
    field :default_operation_notes, :string

    # Cleaning schedule cadence — see migration doc. `last_cleaning_at`
    # + `next_cleaning_due_at` are cached scalars refreshed on every
    # cleaning-complete callback from vita-perf.
    field :cleaning_periodicity, :string
    field :cleaning_periodicity_interval, :integer
    field :last_cleaning_at, :utc_datetime
    field :next_cleaning_due_at, :date

    # Maintenance schedule cadence — same shape as cleaning. Auditors
    # ask about the two independently ("how often do you clean this
    # cell" vs "how often do you maintain this cell") so the fields
    # are parallel, not a shared cadence.
    field :maintenance_periodicity, :string
    field :maintenance_periodicity_interval, :integer
    field :last_maintenance_at, :utc_datetime
    field :next_maintenance_due_at, :date

    belongs_to :company, Company
    belongs_to :workstation_group, WorkstationGroup
    belongs_to :warehouse, Warehouse
    belongs_to :created_by, User
    belongs_to :updated_by, User

    # Assigned form templates via the join table — one workstation
    # can carry many forms per slot. Kiosk walks them in `sort_order`
    # per slot; audience filter runs per-form.
    has_many :form_assignments, Backend.Production.WorkstationFormAssignment,
      foreign_key: :workstation_id,
      preload_order: [asc: :slot, asc: :sort_order, asc: :id]

    has_many :default_worker_assignments, WorkstationDefaultWorker,
      foreign_key: :workstation_id,
      preload_order: [asc: :id]

    has_many :default_workers,
      through: [:default_worker_assignments, :user]

    # Physical equipment attached to this workstation. Replaces the
    # legacy `has_many :machines` — equipment now carries the hourly
    # running cost stack (see Backend.Equipment.RunningCosts).
    has_many :equipment, Backend.Equipment.Equipment,
      foreign_key: :workstation_id,
      preload_order: [asc: :serial_number]

    timestamps(type: :utc_datetime)
  end

  @cast_fields ~w(
    company_id name notes
    workstation_group_id warehouse_id
    hourly_rate_enabled hourly_rate
    productivity
    idle_from idle_to
    is_active
    default_operation_notes
    psp_source_of_truth
    cleaning_periodicity
    cleaning_periodicity_interval
    last_cleaning_at
    next_cleaning_due_at
    maintenance_periodicity
    maintenance_periodicity_interval
    last_maintenance_at
    next_maintenance_due_at
    created_by_id updated_by_id
  )a

  def changeset(workstation, attrs) do
    workstation
    |> cast(attrs, @cast_fields)
    |> validate_required([:company_id, :name, :workstation_group_id, :warehouse_id])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:notes, max: 4000)
    |> validate_length(:default_operation_notes, max: 10_000)
    |> validate_number(:productivity, greater_than: 0)
    |> validate_hourly_rate()
    |> validate_idle_window()
    |> validate_inclusion(:cleaning_periodicity, [nil | @cleaning_periodicities])
    |> validate_number(:cleaning_periodicity_interval, greater_than: 0)
    |> validate_inclusion(:maintenance_periodicity, [nil | @maintenance_periodicities])
    |> validate_number(:maintenance_periodicity_interval, greater_than: 0)
    |> trim_name()
    |> assoc_constraint(:company)
    |> assoc_constraint(:workstation_group)
    |> assoc_constraint(:warehouse)
    |> unique_constraint([:company_id, :name],
      name: :workstations_company_name_index,
      message: "another workstation already uses this name"
    )
    |> check_constraint(:productivity,
      name: :workstations_productivity_positive,
      message: "must be greater than zero"
    )
    |> check_constraint(:idle_to,
      name: :workstations_idle_window_valid,
      message: "idle window end must be on or after the start"
    )
  end

  # When the toggle is on, hourly_rate is required AND non-negative.
  # When off, wipe any stale value so the persisted row reflects
  # intent — same idiom we use on workstation_groups.
  defp validate_hourly_rate(cs) do
    case get_field(cs, :hourly_rate_enabled) do
      true ->
        cs
        |> validate_required([:hourly_rate],
          message: "set the hourly rate or untick the box"
        )
        |> validate_number(:hourly_rate, greater_than_or_equal_to: 0)

      false ->
        put_change(cs, :hourly_rate, nil)

      _ ->
        cs
    end
  end

  # Either both dates are set (with end ≥ start) or neither.
  # Mirrors the DB-level check constraint so changeset errors are
  # friendly.
  defp validate_idle_window(cs) do
    from_d = get_field(cs, :idle_from)
    to_d = get_field(cs, :idle_to)

    cond do
      is_nil(from_d) and is_nil(to_d) ->
        cs

      not is_nil(from_d) and is_nil(to_d) ->
        add_error(cs, :idle_to, "set the idle window end")

      is_nil(from_d) and not is_nil(to_d) ->
        add_error(cs, :idle_from, "set the idle window start")

      Date.compare(to_d, from_d) == :lt ->
        add_error(cs, :idle_to, "must be on or after the start")

      true ->
        cs
    end
  end

  defp trim_name(cs) do
    case get_change(cs, :name) do
      raw when is_binary(raw) -> put_change(cs, :name, String.trim(raw))
      _ -> cs
    end
  end
end
