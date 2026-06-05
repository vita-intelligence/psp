defmodule Backend.Repo.Migrations.CreateAttributeDefinitions do
  use Ecto.Migration

  @moduledoc """
  Catalogue-scoped typed custom attributes. Mirrors the vita-cff
  AttributeDefinition pattern: each row defines a named, typed extension
  field (text / number / boolean / date / enum / url) attached to a
  specific item_type. The actual values live in `items.attributes`
  JSONB, validated at write-time against the definitions for the
  item's type.

  Lets admins add domain-specific fields (a new regulatory dimension
  on raw materials, a new dosage-form-specific value) without a code
  change — but keeps it typed + scoped, so queries on attribute values
  stay sane and the FE can render the right input per type.

  Hard architectural rule: this is for SECONDARY metadata only.
  Universal regulatory fields (allergens, country of origin, claims,
  contaminant limits) live as first-class columns on the per-type
  subtables. AttributeDefinition is the release valve, not the
  primary schema mechanism.
  """

  def change do
    create table(:attribute_definitions) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies), null: false

      # Which item_type this attribute can attach to. `item_any`
      # means it applies to every item regardless of type (rare).
      add :scope, :string, null: false, size: 32

      # Machine identifier — snake_case, immutable once assigned.
      # Allocation / query / FE field-binding all join on this.
      add :key, :string, null: false, size: 60

      add :label, :string, null: false, size: 80

      # Validated value type. Drives form rendering on the FE.
      add :attribute_type, :string, null: false, size: 16

      # When attribute_type = "enum": the allowed choices.
      # Shape: [{ "value": "...", "label": "..." }, ...]
      add :enum_choices, :jsonb

      add :required, :boolean, null: false, default: false
      add :default_value, :jsonb
      add :unit_symbol, :string, size: 12
      add :help_text, :text
      add :sort_order, :integer, null: false, default: 0
      add :is_active, :boolean, null: false, default: true

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:attribute_definitions, [:uuid])
    create unique_index(:attribute_definitions, [:company_id, :scope, :key])
    create index(:attribute_definitions, [:company_id, :scope, :is_active, :sort_order])
  end
end
