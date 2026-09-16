defmodule Backend.Production.WorkstationFormAssignment do
  @moduledoc """
  One (workstation × form_template × slot) attachment.

  A workstation can carry any number of these per slot; the kiosk
  walks them in ``sort_order`` sequentially on the matching trigger.
  Audience filtering happens on the referenced template
  (`form_templates.worker_uuids`), not here — a form's audience
  stays the same wherever it's attached.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Forms.FormTemplate
  alias Backend.Production.Workstation

  @slots ~w(workstation_start workstation_end cleaning)

  def slots, do: @slots

  schema "workstation_form_assignments" do
    field :slot, :string
    field :sort_order, :integer, default: 0

    belongs_to :workstation, Workstation
    belongs_to :form_template, FormTemplate

    timestamps(type: :utc_datetime)
  end

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [:workstation_id, :form_template_id, :slot, :sort_order])
    |> validate_required([:workstation_id, :form_template_id, :slot])
    |> validate_inclusion(:slot, @slots)
    |> validate_number(:sort_order, greater_than_or_equal_to: 0)
    |> assoc_constraint(:workstation)
    |> assoc_constraint(:form_template)
    |> unique_constraint([:workstation_id, :form_template_id, :slot],
      name: :workstation_form_assignments_wid_tid_slot_index,
      message: "already attached to this workstation for this slot"
    )
  end
end
