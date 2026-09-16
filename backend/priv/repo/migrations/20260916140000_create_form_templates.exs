defmodule Backend.Repo.Migrations.CreateFormTemplates do
  @moduledoc """
  PSP-authored form templates published to vita-performance.

  Templates are a **library** — one row per authored form. A single
  template can be assigned to any number of workstations through the
  workstations table (`start_of_shift_form_template_id`,
  `end_of_shift_form_template_id`, `cleaning_form_template_id`). On
  save/publish, PSP walks each assigned workstation and pushes a
  resolved DynamicForm row to vita-perf; equipment sections are
  expanded at that point when `trigger = "cleaning"` and the workstation
  has attached equipment.

  Schema JSON has two arms:
    * `fields`               — universal field list, rendered as-is
    * `per_equipment_fields` — cleaning-only template that gets
                               replicated once per attached piece
                               (auto-sectioning happens at publish
                               time, not at kiosk render).
  """

  use Ecto.Migration

  def change do
    create table(:form_templates) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false

      add :name, :string, size: 200, null: false
      add :description, :text

      add :trigger, :string, size: 32, null: false

      # jsonb blob: %{ "fields" => [...], "per_equipment_fields" => [...] | nil }
      add :schema, :map, null: false, default: %{}

      # Bumped on every save; vita-perf uses it for idempotent upserts.
      add :version, :integer, null: false, default: 1

      # Set to now() on successful publish to vita-perf, plus the
      # version at that moment so we can tell "dirty since last publish".
      add :last_published_at, :utc_datetime
      add :last_published_version, :integer

      add :is_active, :boolean, null: false, default: true

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)
      timestamps(type: :utc_datetime)
    end

    create unique_index(:form_templates, [:uuid])

    # Names unique per tenant among *active* rows. Archiving a form
    # frees the name so a replacement can reuse it.
    create unique_index(:form_templates, [:company_id, :name],
             name: :form_templates_company_active_name_index,
             where: "is_active = true"
           )

    create index(:form_templates, [:company_id])
    create index(:form_templates, [:trigger])

    create constraint(:form_templates, :form_templates_trigger_valid,
             check: "trigger IN ('start_of_shift', 'end_of_shift', 'cleaning')"
           )
  end
end
