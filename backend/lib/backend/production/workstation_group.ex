defmodule Backend.Production.WorkstationGroup do
  @moduledoc """
  A named cluster of identical workstations — an oven bank, a packaging
  line, a blending station. The group is the parent every individual
  workstation will eventually point at; it carries the production
  attributes the workstations inside it share (kind, instance count,
  hourly rate, optional overrides for working hours / holidays).

  `kind` is constrained to two values:
    - `active_processing` — operator-driven; the schedule consumes
      labour against this group.
    - `passive_processing` — machine runs unattended after setup
      (ovens, curing, fermentation); the schedule reserves the
      duration but no operator time.

  The `*_enabled` boolean fields gate the corresponding override
  column. The FE renders them as checkbox + value pairs so an unset
  field is visually distinct from an explicit `0`.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  @kinds ~w(active_processing passive_processing)
  def kinds, do: @kinds

  schema "workstation_groups" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :notes, :string
    field :instances, :integer, default: 1
    field :kind, :string, default: "active_processing"

    field :hourly_rate_enabled, :boolean, default: false
    field :hourly_rate, :decimal

    field :custom_working_hours, :boolean, default: false
    field :working_hours, :map, default: %{}

    field :custom_holidays, :boolean, default: false
    field :holidays, {:array, :date}, default: []

    field :color, :string
    field :is_active, :boolean, default: true

    # Pre-filled SOP / operation description for routings + MO steps
    # whose workstation_group_id matches this row. Operators see this
    # as the auto-fill on the routing-step form when the description
    # is empty.
    field :default_operation_notes, :string

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  @cast_fields ~w(
    company_id name notes instances kind
    hourly_rate_enabled hourly_rate
    custom_working_hours working_hours
    custom_holidays holidays
    color is_active
    default_operation_notes
    created_by_id updated_by_id
  )a

  def changeset(group, attrs) do
    group
    |> cast(attrs, @cast_fields)
    |> validate_required([:company_id, :name, :kind])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:notes, max: 4000)
    |> validate_length(:default_operation_notes, max: 10_000)
    |> validate_inclusion(:kind, @kinds,
      message: "must be active_processing or passive_processing"
    )
    |> validate_number(:instances, greater_than_or_equal_to: 1)
    |> validate_hourly_rate()
    |> trim_name()
    |> clean_color()
    |> assoc_constraint(:company)
    |> unique_constraint([:company_id, :name],
      name: :workstation_groups_company_name_index,
      message: "another workstation group already uses this name"
    )
    |> check_constraint(:instances,
      name: :workstation_groups_instances_positive,
      message: "must be at least 1"
    )
    |> check_constraint(:kind,
      name: :workstation_groups_kind_known,
      message: "must be active_processing or passive_processing"
    )
  end

  # When the operator ticks "Hourly rate" the value must be present
  # and non-negative. When the toggle is off, we wipe the value so a
  # stale number doesn't sit on the row whispering "I might be used".
  defp validate_hourly_rate(cs) do
    enabled = get_field(cs, :hourly_rate_enabled)

    cond do
      enabled == true ->
        cs
        |> validate_required([:hourly_rate],
          message: "set the hourly rate or untick the box"
        )
        |> validate_number(:hourly_rate, greater_than_or_equal_to: 0)

      enabled == false ->
        put_change(cs, :hourly_rate, nil)

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

  # Strip a leading "#" so the FE colour-picker can send either
  # `#ff0000` or `ff0000` and we store the same thing.
  defp clean_color(cs) do
    case get_change(cs, :color) do
      raw when is_binary(raw) ->
        cleaned = raw |> String.trim() |> String.downcase()
        put_change(cs, :color, cleaned)

      _ ->
        cs
    end
  end
end
