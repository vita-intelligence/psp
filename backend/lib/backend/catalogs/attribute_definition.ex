defmodule Backend.Catalogs.AttributeDefinition do
  @moduledoc """
  One typed, scope-bound custom attribute. Items of the matching
  `scope` may carry a value for this definition in their `attributes`
  JSONB. The platform validates each value against the definition's
  `attribute_type` + `enum_choices` before write.

  Definitions are PER-COMPANY — tenants can shape their own
  catalogue without interfering with each other.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  @valid_scopes ~w(raw_material semi_finished finished_product packaging consumable item_any)
  @valid_types ~w(text number boolean date enum url)

  schema "attribute_definitions" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :scope, :string
    field :key, :string
    field :label, :string
    field :attribute_type, :string
    field :enum_choices, {:array, :map}, default: []
    field :required, :boolean, default: false
    field :default_value, :map
    field :unit_symbol, :string
    field :help_text, :string
    field :sort_order, :integer, default: 0
    field :is_active, :boolean, default: true

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def valid_scopes, do: @valid_scopes
  def valid_types, do: @valid_types

  def changeset(def_, attrs) do
    def_
    |> cast(attrs, [
      :company_id,
      :scope,
      :key,
      :label,
      :attribute_type,
      :enum_choices,
      :required,
      :default_value,
      :unit_symbol,
      :help_text,
      :sort_order,
      :is_active,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :scope, :key, :label, :attribute_type])
    |> normalise_key()
    |> validate_length(:key, min: 1, max: 60)
    |> validate_length(:label, min: 1, max: 80)
    |> validate_format(:key, ~r/\A[a-z][a-z0-9_]*\z/,
      message: "must be lowercase letters / digits / underscores, starting with a letter"
    )
    |> validate_inclusion(:scope, @valid_scopes,
      message: "must be one of: #{Enum.join(@valid_scopes, ", ")}"
    )
    |> validate_inclusion(:attribute_type, @valid_types,
      message: "must be one of: #{Enum.join(@valid_types, ", ")}"
    )
    |> validate_enum_choices()
    |> unique_constraint([:company_id, :scope, :key],
      name: :attribute_definitions_company_id_scope_key_index,
      message: "this key is already in use within this scope"
    )
  end

  # When attribute_type = "enum", enum_choices must be a non-empty
  # list of `{ "value": "...", "label": "..." }` maps. Anything else
  # is a schema bug we want surfaced now.
  defp validate_enum_choices(changeset) do
    case get_field(changeset, :attribute_type) do
      "enum" ->
        case get_field(changeset, :enum_choices) do
          [_ | _] = choices ->
            if Enum.all?(choices, fn
                 %{"value" => v, "label" => l} when is_binary(v) and is_binary(l) -> true
                 _ -> false
               end) do
              changeset
            else
              add_error(
                changeset,
                :enum_choices,
                ~s|each enum choice must be {"value": "...", "label": "..."}|
              )
            end

          _ ->
            add_error(
              changeset,
              :enum_choices,
              "enum attributes need at least one choice"
            )
        end

      _ ->
        changeset
    end
  end

  defp normalise_key(changeset) do
    case get_change(changeset, :key) do
      raw when is_binary(raw) ->
        put_change(changeset, :key, raw |> String.trim() |> String.downcase())

      _ ->
        changeset
    end
  end
end
