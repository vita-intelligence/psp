defmodule Backend.Equipment.MaintenanceTask do
  @moduledoc """
  One recurring preventive-maintenance / calibration task for a piece
  of equipment. See migration doc for the "why one row per task".

  ``next_due_date`` is a cached scalar so the due-soon queue stays a
  simple index scan; ``Backend.Equipment.MaintenanceTasks.complete/3``
  is the only path that mutates it — a completion bumps
  ``last_completion_date`` to the completion date and recomputes
  ``next_due_date`` from the periodicity.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Equipment.Equipment

  @task_types ~w(preventive calibration inspection safety_check cleaning other)
  @periodicities ~w(daily weekly monthly quarterly half_yearly yearly two_yearly three_yearly)

  def task_types, do: @task_types
  def periodicities, do: @periodicities

  schema "equipment_maintenance_tasks" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :task_name, :string
    field :task_type, :string, default: "preventive"

    field :periodicity, :string
    field :periodicity_interval, :integer

    field :start_date, :date
    field :end_date, :date

    field :last_completion_date, :date
    field :next_due_date, :date

    field :certificate_required, :boolean, default: false

    field :notes, :string
    field :is_active, :boolean, default: true

    belongs_to :company, Company
    belongs_to :equipment, Equipment
    belongs_to :assigned_to_user, User
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :company_id,
      :equipment_id,
      :task_name,
      :task_type,
      :periodicity,
      :periodicity_interval,
      :assigned_to_user_id,
      :start_date,
      :end_date,
      :last_completion_date,
      :next_due_date,
      :certificate_required,
      :notes,
      :is_active,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :equipment_id, :task_name, :task_type])
    |> validate_length(:task_name, min: 1, max: 200)
    |> validate_inclusion(:task_type, @task_types)
    |> validate_inclusion(:periodicity, [nil | @periodicities])
    |> validate_number(:periodicity_interval, greater_than: 0)
    |> assoc_constraint(:company)
    |> assoc_constraint(:equipment)
    |> assoc_constraint(:assigned_to_user)
  end
end
