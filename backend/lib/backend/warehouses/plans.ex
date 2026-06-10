defmodule Backend.Warehouses.Plans do
  @moduledoc """
  Boundary for the warehouse plan editor — floors + storage locations.
  Sits alongside `Backend.Warehouses` so the original module stays
  focused on the warehouse entity itself.

  Both floors and storage locations:
    * stamp `created_by_id` / `updated_by_id` from the actor on every
      mutation (same convention as warehouses)
    * write audit events via `Backend.Audit` so the warehouse detail
      page's Activity timeline picks them up automatically
    * preload `:created_by` + `:updated_by` on every read so the
      "Ownership" strip can render immediately

  All mutation fns require an actor (`%User{}`) — there's no
  system-issued mutation path here. Calls from controllers always
  carry the current_user.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Companies.Company
  alias Backend.Numbering
  alias Backend.Repo
  alias Backend.Warehouses.{Floor, StorageCell, StorageLocation, Warehouse}

  # Audit surfaces — what the history rows actually show. Bookkeeping
  # columns (created_by_id, updated_by_id) are excluded.
  @floor_audit_fields ~w(name ordinal canvas_json)a
  @location_audit_fields ~w(name code x y width height width_m height_m depth_m notes color tags floor_id)a
  @cell_audit_fields ~w(name ordinal width_m depth_m height_m max_weight_kg tags notes storage_location_id)a

  ## Floors — read --------------------------------------------------

  @doc """
  All floors of a warehouse, ordered by ordinal. Storage locations
  are preloaded so the UI can render a complete plan with a single
  fetch. Audit meta is preloaded too.
  """
  def list_floors(%Warehouse{} = warehouse) do
    Floor
    |> where([f], f.warehouse_id == ^warehouse.id)
    # Hide system slots — the auto-managed Unregistered hierarchy
    # exists only so manual lots have somewhere to land before
    # they're scan-moved to a real shelf. Operators shouldn't see
    # it in the plan editor or floor list.
    |> where([f], is_nil(f.system_kind))
    |> order_by([f], asc: f.ordinal, asc: f.id)
    |> preload([:created_by, :updated_by, storage_locations: ^location_query()])
    |> Repo.all()
  end

  def get_floor(%Warehouse{} = warehouse, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Floor
        |> where([f], f.warehouse_id == ^warehouse.id and f.uuid == ^cast)
        |> preload([:created_by, :updated_by, storage_locations: ^location_query()])
        |> Repo.one()

      :error ->
        nil
    end
  end

  def get_floor(_warehouse, _), do: nil

  @doc """
  Lookup variant by integer primary key. Used when an associated
  row (storage_location) only carries `floor_id` and the caller
  wants the floor's uuid (e.g. realtime broadcasts).
  """
  def get_floor_by_id(%Warehouse{} = warehouse, floor_id)
      when is_integer(floor_id) do
    Floor
    |> where([f], f.warehouse_id == ^warehouse.id and f.id == ^floor_id)
    |> Repo.one()
  end

  def get_floor_by_id(_warehouse, _), do: nil

  ## Floors — mutation ---------------------------------------------

  @doc """
  Create a new floor on the warehouse. `ordinal` defaults to "after
  the current highest" so adding a new floor lands at the bottom of
  the switcher and doesn't displace existing floors.
  """
  def create_floor(%User{} = actor, %Warehouse{} = warehouse, attrs) do
    next_ordinal = next_ordinal_for(warehouse)

    attrs =
      attrs
      |> stringify_keys()
      |> Map.put_new("ordinal", next_ordinal)
      |> Map.merge(%{
        "warehouse_id" => warehouse.id,
        # Denormalised from the parent warehouse so the audit_events
        # insert (which needs entity.company_id) succeeds. See the
        # `AddCompanyIdToFloorsAndLocations` migration for the why.
        "company_id" => warehouse.company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %Floor{}
    |> Floor.changeset(attrs)
    |> Repo.insert()
    |> after_floor_create(actor)
  end

  def update_floor(%User{} = actor, %Floor{} = floor, attrs) do
    before_state = floor_audit_snapshot(floor)

    floor
    |> Floor.changeset(
      attrs
      |> stringify_keys()
      |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> after_floor_update(actor, before_state)
  end

  def delete_floor(%User{} = actor, %Floor{} = floor) do
    before_state = floor_audit_snapshot(floor)

    case Repo.delete(floor) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "floor", floor, before_state)
        {:ok, deleted}

      other ->
        other
    end
  end

  defp after_floor_create({:ok, floor}, actor) do
    Audit.record_created(actor, "floor", floor, floor_audit_snapshot(floor))
    {:ok, Repo.preload(floor, [:created_by, :updated_by, :storage_locations])}
  end

  defp after_floor_create(other, _actor), do: other

  defp after_floor_update({:ok, floor}, actor, before_state) do
    Audit.record_updated(
      actor,
      "floor",
      floor,
      before_state,
      floor_audit_snapshot(floor)
    )

    {:ok,
     Repo.preload(floor, [:created_by, :updated_by, storage_locations: location_query()])}
  end

  defp after_floor_update(other, _actor, _before_state), do: other

  defp floor_audit_snapshot(%Floor{} = f),
    do: Map.new(@floor_audit_fields, fn k -> {k, Map.get(f, k)} end)

  defp next_ordinal_for(%Warehouse{} = warehouse) do
    Floor
    |> where([f], f.warehouse_id == ^warehouse.id)
    |> select([f], coalesce(max(f.ordinal), -1))
    |> Repo.one()
    |> Kernel.+(1)
  end

  ## Storage locations — read --------------------------------------

  def get_location(%Warehouse{} = warehouse, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        StorageLocation
        |> where([l], l.warehouse_id == ^warehouse.id and l.uuid == ^cast)
        |> preload([:created_by, :updated_by])
        |> Repo.one()

      :error ->
        nil
    end
  end

  def get_location(_warehouse, _), do: nil

  ## Storage locations — mutation ----------------------------------

  def create_location(%User{} = actor, %Floor{} = floor, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "warehouse_id" => floor.warehouse_id,
        "floor_id" => floor.id,
        # Same denormalisation as floors — audit_events.company_id
        # needs to be populated for the row to insert.
        "company_id" => floor.company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })
      |> maybe_assign_code("storage_location", floor.company_id)

    %StorageLocation{}
    |> StorageLocation.changeset(attrs)
    |> Repo.insert()
    |> after_location_create(actor)
  end

  def update_location(%User{} = actor, %StorageLocation{} = location, attrs) do
    before_state = location_audit_snapshot(location)

    location
    |> StorageLocation.changeset(
      attrs
      |> stringify_keys()
      |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> after_location_update(actor, before_state)
  end

  def delete_location(%User{} = actor, %StorageLocation{} = location) do
    before_state = location_audit_snapshot(location)

    case Repo.delete(location) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "storage_location", location, before_state)
        {:ok, deleted}

      other ->
        other
    end
  end

  defp after_location_create({:ok, location}, actor) do
    Audit.record_created(
      actor,
      "storage_location",
      location,
      location_audit_snapshot(location)
    )

    {:ok, Repo.preload(location, [:created_by, :updated_by])}
  end

  defp after_location_create(other, _actor), do: other

  defp after_location_update({:ok, location}, actor, before_state) do
    Audit.record_updated(
      actor,
      "storage_location",
      location,
      before_state,
      location_audit_snapshot(location)
    )

    {:ok, Repo.preload(location, [:created_by, :updated_by])}
  end

  defp after_location_update(other, _actor, _before_state), do: other

  defp location_audit_snapshot(%StorageLocation{} = l),
    do: Map.new(@location_audit_fields, fn k -> {k, Map.get(l, k)} end)

  ## Storage cells — read ------------------------------------------

  def list_cells(%StorageLocation{} = location) do
    StorageCell
    |> where([c], c.storage_location_id == ^location.id)
    |> order_by([c], asc: c.ordinal, asc: c.id)
    |> preload([:created_by, :updated_by])
    |> Repo.all()
  end

  def get_cell(%StorageLocation{} = location, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        StorageCell
        |> where([c], c.storage_location_id == ^location.id and c.uuid == ^cast)
        |> preload([:created_by, :updated_by])
        |> Repo.one()

      :error ->
        nil
    end
  end

  def get_cell(_location, _), do: nil

  ## Storage cells — mutation ---------------------------------------

  def create_cell(%User{} = actor, %StorageLocation{} = location, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "storage_location_id" => location.id,
        # Same denormalisation rationale — audit_events.company_id is
        # NOT NULL and the cross-company filter wants a column hit.
        "company_id" => location.company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })
      |> Map.put_new_lazy("ordinal", fn -> next_cell_ordinal(location) end)
      |> inherit_footprint_from_location(location)

    %StorageCell{}
    |> StorageCell.changeset(attrs)
    |> Repo.insert()
    |> after_cell_create(actor)
  end

  # New levels default to the rack's outer footprint — most shelves
  # span the full rack and re-typing the same dimensions on every
  # level is friction the operator never wins. Caller-supplied
  # width_m / depth_m still take precedence: explicit override wins
  # over inheritance.
  #
  # Source of truth for the rack footprint is the canvas integer
  # `width` / `height` (cm), since that's where the FE writes the
  # operator's stated dimensions. The schema's `width_m`/`height_m`
  # columns are reserved for future use and may be nil.
  defp inherit_footprint_from_location(attrs, %StorageLocation{} = location) do
    attrs
    |> maybe_inherit_metres("width_m", location.width)
    |> maybe_inherit_metres("depth_m", location.height)
    |> maybe_inherit_tags(location.tags)
  end

  # Levels are the authoritative source for allocation tags — at
  # create time we seed them from the rack so most operators don't
  # have to repeat themselves, but the level then owns its set and
  # can add or remove freely. A caller passing `tags: []` opts the
  # level out of inheritance (explicit empty list wins over the
  # rack's defaults).
  defp maybe_inherit_tags(attrs, rack_tags) when is_list(rack_tags) do
    case Map.get(attrs, "tags") do
      nil -> Map.put(attrs, "tags", rack_tags)
      _ -> attrs
    end
  end

  defp maybe_inherit_tags(attrs, _), do: attrs

  @doc """
  Overwrite every cell on this location with the rack's current tag
  set. Called from the FE confirm prompt that fires after a rack tag
  edit. Tag inheritance is normally one-way at creation; this is the
  explicit "yes, push my new rack tags to existing levels" door.

  Returns `{:ok, count}` where `count` is the number of cells
  updated. Each touched cell gets a normal `update_cell` so audit
  history reflects the change.
  """
  def sync_tags_to_cells(%User{} = actor, %StorageLocation{} = location) do
    cells = list_cells(location)
    target_tags = location.tags || []

    Repo.transaction(fn ->
      Enum.reduce(cells, 0, fn cell, acc ->
        if Enum.sort(cell.tags || []) == Enum.sort(target_tags) do
          acc
        else
          case update_cell(actor, cell, %{"tags" => target_tags}) do
            {:ok, _} -> acc + 1
            {:error, cs} -> Repo.rollback(cs)
          end
        end
      end)
    end)
  end

  defp maybe_inherit_metres(attrs, key, cm) when is_integer(cm) and cm > 0 do
    case Map.get(attrs, key) do
      v when v in [nil, ""] ->
        Map.put(attrs, key, cm |> Decimal.new() |> Decimal.div(100))

      _ ->
        attrs
    end
  end

  defp maybe_inherit_metres(attrs, _key, _), do: attrs

  def update_cell(%User{} = actor, %StorageCell{} = cell, attrs) do
    before_state = cell_audit_snapshot(cell)

    cell
    |> StorageCell.changeset(
      attrs
      |> stringify_keys()
      |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> after_cell_update(actor, before_state)
  end

  def delete_cell(%User{} = actor, %StorageCell{} = cell) do
    before_state = cell_audit_snapshot(cell)

    case Repo.delete(cell) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "storage_cell", cell, before_state)
        touch_floor_for_cell(cell)
        {:ok, deleted}

      other ->
        other
    end
  end

  @doc """
  Seed N cells onto a location in one transaction. Caller supplies the
  per-level heights (in metres) — equal-split is the common case but
  manual heights are accepted too so a "0.6 / 0.6 / 0.6 / 0.3 / 0.3"
  rack can be created in one round-trip.

  Ordinals start at the location's next free slot, so calling this on
  a rack that already has two cells appends rather than overwrites.

  Returns `{:ok, [%StorageCell{}, …]}` (top-to-bottom — ordinal
  ascending) or `{:error, reason}`. Reasons: `:no_levels`,
  `{:bad_height, value}`, or an `%Ecto.Changeset{}` from the first
  failing insert (the whole transaction rolls back).
  """
  def split_cells(%User{} = actor, %StorageLocation{} = location, heights_m)
      when is_list(heights_m) do
    cond do
      heights_m == [] ->
        {:error, :no_levels}

      Enum.any?(heights_m, &(not valid_height?(&1))) ->
        bad = Enum.find(heights_m, &(not valid_height?(&1)))
        {:error, {:bad_height, bad}}

      true ->
        start_ordinal = next_cell_ordinal(location)

        Repo.transaction(fn ->
          heights_m
          |> Enum.with_index(start_ordinal)
          |> Enum.reduce_while([], fn {h, ordinal}, acc ->
            attrs = %{
              "ordinal" => ordinal,
              "height_m" => h
            }

            case create_cell(actor, location, attrs) do
              {:ok, cell} -> {:cont, [cell | acc]}
              {:error, cs} -> {:halt, {:error, cs}}
            end
          end)
          |> case do
            {:error, cs} -> Repo.rollback(cs)
            list when is_list(list) -> Enum.reverse(list)
          end
        end)
    end
  end

  defp valid_height?(value) do
    case parse_decimal(value) do
      {:ok, d} -> Decimal.positive?(d)
      :error -> false
    end
  end

  defp parse_decimal(%Decimal{} = d), do: {:ok, d}
  defp parse_decimal(value) when is_integer(value), do: {:ok, Decimal.new(value)}

  defp parse_decimal(value) when is_float(value),
    do: {:ok, Decimal.from_float(value)}

  defp parse_decimal(value) when is_binary(value) do
    case Decimal.parse(value) do
      {d, ""} -> {:ok, d}
      _ -> :error
    end
  end

  defp parse_decimal(_), do: :error

  defp after_cell_create({:ok, cell}, actor) do
    Audit.record_created(actor, "storage_cell", cell, cell_audit_snapshot(cell))
    touch_floor_for_cell(cell)
    {:ok, Repo.preload(cell, [:created_by, :updated_by])}
  end

  defp after_cell_create(other, _actor), do: other

  defp after_cell_update({:ok, cell}, actor, before_state) do
    Audit.record_updated(
      actor,
      "storage_cell",
      cell,
      before_state,
      cell_audit_snapshot(cell)
    )

    touch_floor_for_cell(cell)
    {:ok, Repo.preload(cell, [:created_by, :updated_by])}
  end

  defp after_cell_update(other, _actor, _before_state), do: other

  # Cell mutations live on a child table — the warehouse plan FE
  # gates "did this floor change?" on `floor.updated_at`, so we need
  # to bump the floor row whenever a cell lands, otherwise the
  # post-action refetch is silently ignored. One UPDATE per mutation
  # is cheap; the FE merge already preserves user drafts.
  defp touch_floor_for_cell(%StorageCell{storage_location_id: loc_id}) do
    from(f in Floor,
      join: l in StorageLocation,
      on: l.floor_id == f.id,
      where: l.id == ^loc_id
    )
    |> Repo.update_all(set: [updated_at: DateTime.utc_now() |> DateTime.truncate(:second)])

    :ok
  end

  defp cell_audit_snapshot(%StorageCell{} = c),
    do: Map.new(@cell_audit_fields, fn k -> {k, Map.get(c, k)} end)

  defp next_cell_ordinal(%StorageLocation{id: location_id}) do
    StorageCell
    |> where([c], c.storage_location_id == ^location_id)
    |> select([c], max(c.ordinal))
    |> Repo.one()
    |> case do
      nil -> 0
      n -> n + 1
    end
  end

  ## ----------------------------------------------------------------

  # Query template for preloading locations with their audit meta and
  # a stable order (by name) so the UI doesn't shuffle them between
  # fetches. Cells come along too — the LocationBody renders the cell
  # count and the editor opens straight onto the existing list.
  defp location_query do
    from(l in StorageLocation,
      where: is_nil(l.system_kind),
      preload: [:created_by, :updated_by, cells: ^cell_query()],
      order_by: [asc: l.name]
    )
  end

  defp cell_query do
    from(c in StorageCell,
      where: is_nil(c.system_kind),
      preload: [:created_by, :updated_by],
      order_by: [asc: c.ordinal, asc: c.id]
    )
  end

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end

  # Stamp a generated code on insert when the caller didn't supply
  # one and the company has a numbering format configured. Operators
  # can still type their own; we only fill the gap so a blank Code
  # field on the UI produces `SL00012`, `FL00003`, … instead of nil.
  defp maybe_assign_code(attrs, entity_key, company_id) do
    case Map.get(attrs, "code") do
      val when is_binary(val) and val != "" ->
        attrs

      _ ->
        case Repo.get(Company, company_id) do
          nil ->
            attrs

          company ->
            case Numbering.next_code(company, entity_key) do
              nil -> attrs
              code -> Map.put(attrs, "code", code)
            end
        end
    end
  end
end
