defmodule Backend.Equipment.CategoryFormAssignment do
  @moduledoc """
  One (equipment_category × form_template × slot) attachment.

  Parallel to `Backend.Production.WorkstationFormAssignment` — same
  shape, different tenant of forms. Cleaning + maintenance sessions
  the operator scopes to a specific machine walk this table's forms
  (through the machine's `equipment.category_id`).

  Slot enforcement lives at the changeset layer: only equipment-
  scoped triggers (``equipment_cleaning`` / ``equipment_maintenance``)
  are legal here. A workstation-scoped form (``cleaning``,
  ``maintenance``, ``workstation_start``, ``workstation_end``)
  attached here would never fire — the kiosk queries this table
  only on equipment-scoped sessions.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.Equipment.Category
  alias Backend.Forms.FormTemplate

  @slots ~w(
    equipment_cleaning_start
    equipment_cleaning_end
    equipment_maintenance_start
    equipment_maintenance_end
  )

  def slots, do: @slots

  schema "equipment_category_form_assignments" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :slot, :string
    field :sort_order, :integer, default: 0

    belongs_to :company, Company
    belongs_to :equipment_category, Category
    belongs_to :form_template, FormTemplate

    timestamps(type: :utc_datetime)
  end

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :uuid,
      :company_id,
      :equipment_category_id,
      :form_template_id,
      :slot,
      :sort_order
    ])
    |> validate_required([
      :company_id,
      :equipment_category_id,
      :form_template_id,
      :slot
    ])
    |> validate_inclusion(:slot, @slots)
    |> validate_number(:sort_order, greater_than_or_equal_to: 0)
    |> validate_template_matches_slot()
    |> assoc_constraint(:company)
    |> assoc_constraint(:equipment_category)
    |> assoc_constraint(:form_template)
    |> unique_constraint([:company_id, :equipment_category_id, :form_template_id, :slot],
      name: :ec_form_assignments_company_cat_tpl_slot_index,
      message: "already attached to this category for this slot"
    )
  end

  # A form template's trigger must equal the assignment's slot. This
  # is what keeps a "workstation cleaning" template from being
  # attached here (where the kiosk would never fire it).
  defp validate_template_matches_slot(cs) do
    template_id = get_field(cs, :form_template_id)
    slot = get_field(cs, :slot)

    if is_integer(template_id) and is_binary(slot) do
      case Backend.Repo.get(FormTemplate, template_id) do
        %FormTemplate{trigger: ^slot} ->
          cs

        %FormTemplate{trigger: other} ->
          add_error(
            cs,
            :form_template_id,
            "template trigger `#{other}` doesn't match slot `#{slot}`"
          )

        _ ->
          add_error(cs, :form_template_id, "template not found")
      end
    else
      cs
    end
  end
end
