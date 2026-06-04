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

    %StorageCell{}
    |> StorageCell.changeset(attrs)
    |> Repo.insert()
    |> after_cell_create(actor)
  end

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
        {:ok, deleted}

      other ->
        other
    end
  end

  defp after_cell_create({:ok, cell}, actor) do
    Audit.record_created(actor, "storage_cell", cell, cell_audit_snapshot(cell))
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

    {:ok, Repo.preload(cell, [:created_by, :updated_by])}
  end

  defp after_cell_update(other, _actor, _before_state), do: other

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
      preload: [:created_by, :updated_by, cells: ^cell_query()],
      order_by: [asc: l.name]
    )
  end

  defp cell_query do
    from(c in StorageCell,
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
end
