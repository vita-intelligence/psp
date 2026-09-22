defmodule Backend.Forms.Submission do
  @moduledoc """
  One filled DynamicForm on the vp kiosk, mirrored onto PSP as the
  audit-trail read model. See the migration for the "why mirror
  instead of query on demand" rationale.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Equipment.Equipment
  alias Backend.Forms.FormTemplate
  alias Backend.Production.{Workstation, WorkstationSession}

  @activity_kinds ~w(mo cleaning maintenance other)

  def activity_kinds, do: @activity_kinds

  schema "form_submissions" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :workstation_session_uuid, Ecto.UUID
    field :form_template_uuid, Ecto.UUID
    field :form_name, :string
    field :form_trigger, :string
    field :schema_snapshot, :map, default: %{}
    field :schema_version, :integer

    field :workstation_uuid, Ecto.UUID
    field :equipment_uuid, Ecto.UUID
    field :activity_kind, :string

    field :submitted_by_uuid, :string
    field :submitted_by_name, :string
    field :submitted_at, :utc_datetime
    field :answers, :map, default: %{}

    field :vp_response_id, :integer

    belongs_to :company, Company
    belongs_to :workstation_session, WorkstationSession
    belongs_to :form_template, FormTemplate
    belongs_to :workstation, Workstation
    belongs_to :equipment, Equipment, foreign_key: :equipment_id
    belongs_to :submitted_by, User, foreign_key: :submitted_by_id

    timestamps(type: :utc_datetime)
  end

  @cast_fields ~w(
    company_id
    workstation_session_id workstation_session_uuid
    form_template_id form_template_uuid form_name form_trigger
    schema_snapshot schema_version
    workstation_id workstation_uuid
    equipment_id equipment_uuid
    activity_kind
    submitted_by_id submitted_by_uuid submitted_by_name
    submitted_at answers vp_response_id
  )a

  def create_changeset(struct, attrs) do
    struct
    |> cast(attrs, @cast_fields)
    |> validate_required([
      :company_id,
      :workstation_id,
      :workstation_uuid,
      :form_template_uuid,
      :form_name,
      :form_trigger,
      :submitted_at,
      :vp_response_id
    ])
    |> validate_inclusion(:form_trigger, FormTemplate.triggers())
    |> validate_activity_kind()
    |> validate_length(:form_name, max: 200)
    |> validate_length(:submitted_by_name, max: 200)
    |> unique_constraint([:company_id, :vp_response_id],
      name: :form_submissions_company_vp_response_index,
      message: "already mirrored for this vp response"
    )
  end

  defp validate_activity_kind(cs) do
    case get_field(cs, :activity_kind) do
      nil ->
        cs

      kind when kind in @activity_kinds ->
        cs

      _ ->
        add_error(cs, :activity_kind, "must be one of #{Enum.join(@activity_kinds, ", ")}")
    end
  end
end
