defmodule Backend.Forms.FormTemplate do
  @moduledoc """
  One authored form template. See migration doc for the "why templates
  are a library, not a per-workstation row".

  ``schema`` is the raw JSON blob edited on the PSP builder canvas.
  Shape:

      %{
        "fields" => [FormField, ...],
        "per_equipment_fields" => [FormField, ...] | nil
      }

  ``per_equipment_fields`` is only meaningful when ``trigger == "cleaning"``
  and the assigned workstation has attached equipment. At publish
  time PSP flattens the template into a resolved DynamicForm on
  vita-perf by adding one header field per attached piece followed by
  the per-equipment field list with ids scoped by equipment uuid
  (``<field_id>__<equipment_uuid>``).
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company

  # Workstation-scoped triggers fire on sessions attached to a
  # workstation (start / end / cleaning / maintenance of the cell
  # itself). Equipment-scoped triggers fire on sessions targeting a
  # specific machine — those forms attach to `EquipmentCategory` so
  # one "V-blender CIP" checklist covers every V-blender.
  #
  # `per_equipment_fields` in the schema is only meaningful for
  # workstation-scoped `cleaning` / `maintenance` triggers (see
  # `validate_per_equipment_fields/1` below). Equipment-scoped forms
  # ARE the equipment form — there's nothing to expand per-piece.
  @triggers ~w(
    workstation_start
    workstation_end
    cleaning
    maintenance
    equipment_cleaning
    equipment_maintenance
  )

  @equipment_scoped_triggers ~w(equipment_cleaning equipment_maintenance)

  def equipment_scoped_triggers, do: @equipment_scoped_triggers

  def equipment_scoped?(trigger) when is_binary(trigger),
    do: trigger in @equipment_scoped_triggers

  def equipment_scoped?(_), do: false

  def triggers, do: @triggers

  schema "form_templates" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :name, :string
    field :description, :string

    field :trigger, :string

    # Persisted as `jsonb` (via `add :schema, :map`) — accepts either
    # atom-keyed or string-keyed maps; readers should assume string
    # keys since that's what the DB round-trips.
    field :schema, :map, default: %{"fields" => [], "per_equipment_fields" => nil}

    field :version, :integer, default: 1

    field :last_published_at, :utc_datetime
    field :last_published_version, :integer

    field :is_active, :boolean, default: true

    # Optional audience filter. Empty = every worker on the assigned
    # workstation. Non-empty = only fires for workers whose vita-perf
    # `Worker.uuid` matches. Stored as opaque strings — PSP doesn't
    # dereference them; publisher forwards the array to vita-perf and
    # the kiosk enforces the check.
    field :worker_uuids, {:array, :string}, default: []

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :company_id,
      :name,
      :description,
      :trigger,
      :schema,
      :version,
      :last_published_at,
      :last_published_version,
      :is_active,
      :worker_uuids,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name, :trigger, :schema])
    |> normalise_worker_uuids()
    |> validate_length(:name, min: 1, max: 200)
    |> validate_length(:description, max: 4000)
    |> validate_inclusion(:trigger, @triggers)
    |> validate_schema()
    |> trim_name()
    |> assoc_constraint(:company)
    |> unique_constraint([:company_id, :name],
      name: :form_templates_company_active_name_index,
      message: "another active form already uses this name"
    )
  end

  # Enforce the two-arm shape at the changeset layer so downstream
  # consumers (publisher, kiosk) can trust the read model.
  defp validate_schema(cs) do
    trigger = get_field(cs, :trigger)

    case get_field(cs, :schema) do
      nil ->
        add_error(cs, :schema, "must be a map")

      schema when is_map(schema) ->
        fields = Map.get(schema, "fields") || Map.get(schema, :fields)
        per_eq = Map.get(schema, "per_equipment_fields") || Map.get(schema, :per_equipment_fields)

        cond do
          not is_list(fields) ->
            add_error(cs, :schema, "`fields` must be a list")

          not (is_nil(per_eq) or is_list(per_eq)) ->
            add_error(cs, :schema, "`per_equipment_fields` must be a list or null")

          equipment_scoped?(trigger) and is_list(per_eq) and per_eq != [] ->
            # Equipment-scoped forms already target one machine —
            # there's no cell to expand per-piece against. Reject
            # per_equipment_fields to keep the model honest.
            add_error(
              cs,
              :schema,
              "`per_equipment_fields` is not applicable to equipment-scoped triggers; put the machine questions directly in `fields`"
            )

          true ->
            cs
        end

      _ ->
        add_error(cs, :schema, "must be a map")
    end
  end

  defp trim_name(cs) do
    case get_change(cs, :name) do
      raw when is_binary(raw) -> put_change(cs, :name, String.trim(raw))
      _ -> cs
    end
  end

  # De-dupe + drop blanks + validate UUID shape. Anything unparseable
  # gets silently dropped rather than blocking a save — the picker
  # only produces valid uuids in practice, and a stray bad entry from
  # a bad merge shouldn't gate the whole form.
  defp normalise_worker_uuids(cs) do
    case get_change(cs, :worker_uuids) do
      nil ->
        cs

      list when is_list(list) ->
        cleaned =
          list
          |> Enum.map(fn
            s when is_binary(s) -> String.trim(s)
            _ -> ""
          end)
          |> Enum.reject(&(&1 == ""))
          |> Enum.filter(&valid_uuid?/1)
          |> Enum.uniq()

        put_change(cs, :worker_uuids, cleaned)

      _ ->
        add_error(cs, :worker_uuids, "must be a list of uuids")
    end
  end

  defp valid_uuid?(s) when is_binary(s) do
    case Ecto.UUID.cast(s) do
      {:ok, _} -> true
      _ -> false
    end
  end

  defp valid_uuid?(_), do: false
end
