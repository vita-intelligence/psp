defmodule Backend.HR.EmployeeShift do
  @moduledoc """
  Mirror of vita-performance's `WorkerShift`. One row per clock-in /
  clock-out window on the personal kiosk. Open shifts have
  `ended_at == nil`; closed shifts carry both timestamps and a
  materialised `duration_seconds` so listing pages don't need to
  compute it per row.

  Idempotent via `external_id` scoped per company — the same vp
  `WorkerShift.pk` maps to the same PSP row across retries.
  """

  use Ecto.Schema
  import Ecto.Changeset

  schema "employee_shifts" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :external_id, :string
    field :started_at, :utc_datetime
    field :ended_at, :utc_datetime
    field :duration_seconds, :integer
    field :device_id, :string
    field :notes, :string

    belongs_to :company, Backend.Companies.Company
    belongs_to :employee, Backend.HR.Employee

    timestamps(type: :utc_datetime)
  end

  @cast_fields ~w(company_id employee_id external_id started_at ended_at
                  duration_seconds device_id notes)a

  def create_changeset(struct, attrs) do
    struct
    |> cast(attrs, @cast_fields)
    |> validate_required([:company_id, :employee_id, :started_at])
    |> validate_end_after_start()
    |> unique_constraint(:external_id,
      name: :employee_shifts_company_external_index,
      message: "already synced under this external_id"
    )
  end

  def update_changeset(struct, attrs) do
    struct
    |> cast(attrs, [:ended_at, :duration_seconds, :notes])
    |> validate_end_after_start()
  end

  defp validate_end_after_start(changeset) do
    started = get_field(changeset, :started_at)
    ended = get_field(changeset, :ended_at)

    case {started, ended} do
      {%DateTime{} = s, %DateTime{} = e} ->
        if DateTime.compare(e, s) in [:gt, :eq] do
          changeset
        else
          add_error(changeset, :ended_at, "must be at or after started_at")
        end

      _ ->
        changeset
    end
  end
end
