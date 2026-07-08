defmodule Backend.Production.WorkstationSession do
  @moduledoc """
  A single execution event recorded at a workstation. Landing point
  for kiosk writebacks from vita-performance.

  Two shapes, one table:

    * MO-attached — `activity_kind = "mo"`,
      `manufacturing_order_step_id` set. The session counts toward
      MO progress and gets stamped on the step's actual_start /
      actual_finish.
    * Off-MO — `activity_kind ∈ ["cleaning", "maintenance",
      "other"]`, `manufacturing_order_step_id = nil`. Rolls into
      the workstation's off-MO time report but not into any MO's
      cost breakdown (unless the company's non_mo_overhead_policy
      pro-rates it back over concurrent MOs — see phase 7 in the
      proposal doc).
  """

  use Ecto.Schema
  import Ecto.Changeset

  @activity_kinds ~w(mo cleaning maintenance other)
  @statuses ~w(active completed verified)

  def activity_kinds, do: @activity_kinds
  def statuses, do: @statuses

  schema "workstation_sessions" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :external_id, :string
    field :activity_kind, :string, default: "mo"
    field :activity_label, :string
    field :employee_uuids, {:array, Ecto.UUID}, default: []
    field :started_at, :utc_datetime
    field :finished_at, :utc_datetime
    field :quantity_produced, :decimal
    field :quantity_rejected, :decimal
    field :performance_percentage, :float
    field :notes, :string
    field :form_responses, :map, default: %{}
    field :status, :string, default: "completed"

    belongs_to :company, Backend.Companies.Company
    belongs_to :workstation, Backend.Production.Workstation

    belongs_to :manufacturing_order_step, Backend.Production.ManufacturingOrderStep,
      foreign_key: :manufacturing_order_step_id

    timestamps(type: :utc_datetime)
  end

  @cast_fields ~w(company_id workstation_id manufacturing_order_step_id
                  external_id activity_kind activity_label employee_uuids
                  started_at finished_at quantity_produced quantity_rejected
                  performance_percentage notes form_responses status)a

  def create_changeset(struct, attrs) do
    struct
    |> cast(attrs, @cast_fields)
    |> validate_required([:company_id, :workstation_id, :activity_kind, :started_at])
    |> validate_inclusion(:activity_kind, @activity_kinds)
    |> validate_inclusion(:status, @statuses)
    |> validate_activity_step_consistency()
    |> validate_finish_after_start()
    |> unique_constraint(:external_id,
      name: :workstation_sessions_company_external_index,
      message: "already synced under this external_id"
    )
  end

  defp validate_activity_step_consistency(changeset) do
    kind = get_field(changeset, :activity_kind)
    step_id = get_field(changeset, :manufacturing_order_step_id)

    case {kind, step_id} do
      {"mo", nil} ->
        add_error(changeset, :manufacturing_order_step_id,
          "required when activity_kind is 'mo'")

      {kind, id} when kind != "mo" and not is_nil(id) ->
        add_error(changeset, :manufacturing_order_step_id,
          "must be nil when activity_kind is not 'mo'")

      _ ->
        changeset
    end
  end

  defp validate_finish_after_start(changeset) do
    started = get_field(changeset, :started_at)
    finished = get_field(changeset, :finished_at)

    case {started, finished} do
      {%DateTime{} = s, %DateTime{} = f} ->
        if DateTime.compare(f, s) in [:gt, :eq] do
          changeset
        else
          add_error(changeset, :finished_at, "must be at or after started_at")
        end

      _ ->
        changeset
    end
  end
end
