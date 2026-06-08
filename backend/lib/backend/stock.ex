defmodule Backend.Stock do
  @moduledoc """
  Boundary for stock lots, placements, and movements. Read paths
  return lots with optional preloads (item, unit, placements,
  movements). Mutations (receive / move / consume / dispose) land
  in subsequent slices — Slice 1 is read-only.

  Lots are scoped per company via every query. Movements are
  append-only audit rows; the public API exposes no edit/delete.
  """

  import Ecto.Query, warn: false

  alias Backend.Items.Item
  alias Backend.ListQueries
  alias Backend.Repo
  alias Backend.Stock.{Lot, Movement, Placement}

  # Sortable on the list endpoint. `code` maps to `id` since the
  # numbering format guarantees code-order == id-order for a given
  # prefix + padding (same trick as Items.list_page).
  @sortable_fields ~w(id status qty_received unit_cost supplier_batch_no expiry_at received_at available_from inserted_at)a
  @search_fields ~w(supplier_batch_no source_ref notes country_of_origin revision)a
  @default_sort {:id, :desc}

  # ----- read ------------------------------------------------------

  @doc """
  List page of lots scoped to the company. Supports cursor pagination
  (via ListQueries), search across supplier batch + provenance, and
  filters on status / item / cell.

  Opts:
    * `:sort`     — `{field, :asc | :desc}`
    * `:limit`    — page size hint
    * `:cursor`   — opaque cursor from a previous page
    * `:search`   — search term (string)
    * `:status`   — restrict to one status
    * `:item_id`  — restrict to one item
    * `:cell_id`  — restrict to lots with a placement at this cell
  """
  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = normalise_sort(Keyword.get(opts, :sort, @default_sort))

    base =
      Lot
      |> where([l], l.company_id == ^company_id)
      |> maybe_status_filter(opts[:status])
      |> maybe_item_filter(opts[:item_id])
      |> maybe_cell_filter(opts[:cell_id])
      |> apply_lot_search(company_id, opts[:search])
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)
      |> preload([
        :item,
        :unit_of_measurement,
        :created_by,
        :updated_by,
        placements: [:storage_cell]
      ])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  # The DataTable search input is a single field — operators type
  # whatever they're looking at (lot code, item name, item code,
  # supplier batch, ...). We OR across the lot's own text columns
  # AND the joined item.name / item.external_sku so the search "just
  # works". A separate parse-as-lot-code branch lets `L00007` hit
  # by id directly.
  defp apply_lot_search(query, _company_id, nil), do: query
  defp apply_lot_search(query, _company_id, ""), do: query

  defp apply_lot_search(query, company_id, term) when is_binary(term) do
    needle = "%" <> escape_like(String.trim(term)) <> "%"
    id_from_code = parse_lot_code(company_id, term)

    from l in query,
      left_join: i in Item,
      on: i.id == l.item_id,
      where:
        ilike(l.supplier_batch_no, ^needle) or
          ilike(l.source_ref, ^needle) or
          ilike(l.notes, ^needle) or
          ilike(l.country_of_origin, ^needle) or
          ilike(l.revision, ^needle) or
          ilike(i.name, ^needle) or
          ilike(i.external_sku, ^needle) or
          (^id_from_code != 0 and l.id == ^id_from_code)
  end

  defp parse_lot_code(company_id, term) do
    case Repo.get(Backend.Companies.Company, company_id) do
      nil ->
        0

      company ->
        case Backend.Numbering.parse_search(term, company, "stock_lot") do
          nil -> 0
          id when is_integer(id) -> id
        end
    end
  end

  defp escape_like(s),
    do: s |> String.replace("\\", "\\\\") |> String.replace("%", "\\%") |> String.replace("_", "\\_")

  def list_config do
    %{
      sortable_fields: Enum.map(@sortable_fields, &Atom.to_string/1),
      search_fields: Enum.map(@search_fields, &Atom.to_string/1),
      default_sort: %{
        field: Atom.to_string(elem(@default_sort, 0)),
        direction: Atom.to_string(elem(@default_sort, 1))
      }
    }
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(l in Lot,
            where: l.company_id == ^company_id and l.uuid == ^cast,
            preload: [
              :item,
              :unit_of_measurement,
              :created_by,
              :updated_by,
              placements: [:storage_cell],
              movements:
                ^from(m in Movement,
                  order_by: [desc: m.occurred_at, desc: m.id],
                  preload: [:from_cell, :to_cell, :actor]
                )
            ]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  @doc """
  Compute on-hand for a preloaded lot. `qty_on_hand = sum(placements.qty)`.
  Cheap when placements are already loaded; the API uses this rather
  than denormalising onto the lot row so movements never need to
  touch the parent.
  """
  def qty_on_hand(%Lot{placements: %Ecto.Association.NotLoaded{}} = lot) do
    Repo.one(
      from(p in Placement,
        where: p.stock_lot_id == ^lot.id,
        select: coalesce(sum(p.qty), 0)
      )
    )
  end

  def qty_on_hand(%Lot{placements: placements}) when is_list(placements) do
    Enum.reduce(placements, Decimal.new(0), fn p, acc -> Decimal.add(acc, p.qty) end)
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  defp maybe_status_filter(query, nil), do: query

  defp maybe_status_filter(query, status) when is_binary(status) do
    where(query, [l], l.status == ^status)
  end

  defp maybe_item_filter(query, nil), do: query

  defp maybe_item_filter(query, item_id) when is_integer(item_id) do
    where(query, [l], l.item_id == ^item_id)
  end

  defp maybe_cell_filter(query, nil), do: query

  defp maybe_cell_filter(query, cell_id) when is_integer(cell_id) do
    cell_lot_ids =
      from(p in Placement,
        where: p.storage_cell_id == ^cell_id and p.qty > 0,
        select: p.stock_lot_id
      )

    where(query, [l], l.id in subquery(cell_lot_ids))
  end

  # ----- write -----------------------------------------------------

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Warehouses.StorageCell

  @lot_audit_fields ~w(status qty_received unit_cost currency source_kind source_ref
                       supplier_batch_no country_of_origin revision overall_risk
                       allergen_status coa_status quality_status manufactured_at
                       expiry_at available_from received_at notes)a

  @doc """
  Receive a new lot — atomic create of lot + initial placement +
  initial movement. All three rows land in one transaction so we
  never publish a lot row with no movement behind it (and vice
  versa).

  `attrs` shape (string keys, mirrors the controller body):

      %{
        "item_id" => 12,                       # required
        "qty_received" => "25",                # required
        "unit_of_measurement_id" => 4,         # required
        "destination_cell_id" => 87,           # required
        "status" => "received",                # default "received"
        "unit_cost" => "5.15",                 # optional
        "currency" => "GBP",
        "source_kind" => "purchase_order",
        "source_ref" => "PO00438",
        "supplier_batch_no" => "BATCH-AA-42",
        "country_of_origin" => "IT",
        "revision" => "V00",
        "available_from" => "2026-06-08T09:00:00Z",
        "expiry_at" => "2028-06-04",
        "manufactured_at" => "2025-05-21",
        "overall_risk" => "low",
        "allergen_status" => "pending",
        "coa_status" => "accepted",
        "quality_status" => "pending",
        "notes" => "Heat-treated batch"
      }
  """
  def receive_lot(%User{} = actor, company_id, attrs) when is_integer(company_id) do
    # Multi-cell receive: callers may pass `placements: [{cell_id, qty}, …]`
    # to land the same lot across N cells in one shot. The old
    # single-cell shape (`destination_cell_id` + `qty_received`)
    # still works — it collapses to a one-row placements list.
    with {:ok, %Item{} = item} <- fetch_item(actor.company_id, attrs["item_id"]),
         {:ok, placement_specs} <- parse_placements(actor.company_id, attrs) do
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      total_qty =
        Enum.reduce(placement_specs, Decimal.new(0), fn {_cell, qty}, acc ->
          Decimal.add(acc, qty)
        end)

      lot_attrs =
        attrs
        |> Map.drop(["placements", "destination_cell_id"])
        |> Map.put("company_id", company_id)
        |> Map.put("item_id", item.id)
        |> Map.put("qty_received", total_qty)
        |> Map.put_new("status", "received")
        |> Map.put_new_lazy("received_at", fn ->
          if Map.get(attrs, "status") in [nil, "received"], do: now, else: nil
        end)
        |> Map.put_new_lazy("available_from", fn -> now end)
        # When no source was supplied this is an operator-created
        # ad-hoc lot (opening balance, adjustment, etc.). Real
        # receives against a Purchase Order will set source_kind
        # explicitly from the procurement module later.
        |> Map.put_new("source_kind", "manual")
        |> Map.put("created_by_id", actor.id)
        |> Map.put("updated_by_id", actor.id)

      Repo.transaction(fn ->
        with {:ok, lot} <-
               %Lot{} |> Lot.changeset(lot_attrs) |> Repo.insert(),
             {:ok, _} <-
               insert_placements_and_movements(
                 actor,
                 company_id,
                 lot,
                 placement_specs,
                 now,
                 attrs
               ) do
          Audit.record_created(actor, "stock_lot", lot, lot_audit_snapshot(lot))

          Repo.preload(lot, [
            :item,
            :unit_of_measurement,
            :created_by,
            :updated_by,
            placements: [:storage_cell],
            movements: [:from_cell, :to_cell, :actor]
          ])
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          other -> Repo.rollback(other)
        end
      end)
    end
  end

  # Normalise both old (destination_cell_id + qty_received) and new
  # (placements: [...]) shapes into a list of `{cell, qty_decimal}`
  # tuples. Validates every cell belongs to the company and every
  # qty parses as a positive decimal.
  defp parse_placements(company_id, %{"placements" => list}) when is_list(list) do
    if list == [] do
      {:error, :no_placements}
    else
      Enum.reduce_while(list, {:ok, []}, fn row, {:ok, acc} ->
        cell_id = parse_int(row["cell_id"] || row["storage_cell_id"])
        qty_raw = row["qty"] || row["qty_received"]

        with {:ok, cell} <- fetch_cell(company_id, cell_id),
             {:ok, qty} <- parse_positive_decimal(qty_raw) do
          {:cont, {:ok, acc ++ [{cell, qty}]}}
        else
          err -> {:halt, err}
        end
      end)
    end
  end

  defp parse_placements(company_id, attrs) do
    cell_id = parse_int(attrs["destination_cell_id"])
    qty_raw = attrs["qty_received"]

    with {:ok, cell} <- fetch_cell(company_id, cell_id),
         {:ok, qty} <- parse_positive_decimal(qty_raw) do
      {:ok, [{cell, qty}]}
    end
  end

  defp parse_int(nil), do: nil
  defp parse_int(v) when is_integer(v), do: v

  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp parse_int(_), do: nil

  defp insert_placements_and_movements(
         actor,
         company_id,
         %Lot{} = lot,
         placement_specs,
         now,
         attrs
       ) do
    Enum.reduce_while(placement_specs, {:ok, []}, fn {cell, qty}, {:ok, acc} ->
      with {:ok, placement} <-
             %Placement{}
             |> Placement.changeset(%{
               "company_id" => company_id,
               "stock_lot_id" => lot.id,
               "storage_cell_id" => cell.id,
               "qty" => qty
             })
             |> Repo.insert(),
           {:ok, movement} <-
             %Movement{}
             |> Movement.changeset(%{
               "company_id" => company_id,
               "stock_lot_id" => lot.id,
               "to_cell_id" => cell.id,
               "delta_qty" => qty,
               "kind" => "receive",
               "reason" => "Initial receipt",
               "reference_kind" => attrs["source_kind"],
               "reference_ref" => attrs["source_ref"],
               "actor_id" => actor.id,
               "occurred_at" => now
             })
             |> Repo.insert() do
        Audit.record_created(actor, "stock_lot_placement", placement, %{
          qty: placement.qty,
          storage_cell_id: placement.storage_cell_id
        })

        Audit.record_created(actor, "stock_movement", movement, %{
          kind: movement.kind,
          delta_qty: movement.delta_qty,
          to_cell_id: movement.to_cell_id
        })

        {:cont, {:ok, [{placement, movement} | acc]}}
      else
        err -> {:halt, err}
      end
    end)
  end

  defp fetch_item(company_id, item_id) when is_integer(item_id) do
    case Repo.get(Item, item_id) do
      %Item{company_id: ^company_id} = i -> {:ok, i}
      _ -> {:error, :item_not_found}
    end
  end

  defp fetch_item(_company_id, _), do: {:error, :item_not_found}

  defp fetch_cell(company_id, cell_id) when is_integer(cell_id) do
    case Repo.get(StorageCell, cell_id) do
      %StorageCell{company_id: ^company_id} = c -> {:ok, c}
      _ -> {:error, :cell_not_found}
    end
  end

  defp fetch_cell(_company_id, _), do: {:error, :cell_not_found}

  defp parse_positive_decimal(value) do
    with {:ok, d} <- parse_decimal(value),
         true <- Decimal.positive?(d) do
      {:ok, d}
    else
      _ -> {:error, :bad_qty}
    end
  end

  defp parse_decimal(%Decimal{} = d), do: {:ok, d}
  defp parse_decimal(n) when is_integer(n), do: {:ok, Decimal.new(n)}
  defp parse_decimal(n) when is_float(n), do: {:ok, Decimal.from_float(n)}

  defp parse_decimal(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, ""} -> {:ok, d}
      _ -> :error
    end
  end

  defp parse_decimal(_), do: :error

  defp lot_audit_snapshot(%Lot{} = l),
    do: Map.new(@lot_audit_fields, fn k -> {k, Map.get(l, k)} end)

  # ----- picker helpers --------------------------------------------

  alias Backend.Warehouses.{Floor, StorageLocation, Warehouse}

  @picker_limit_default 50
  @picker_limit_max 200

  @doc """
  Searchable, filterable cell picker. Built for the receive form
  where a warehouse can have hundreds of thousands of cells — every
  filter is pushed to Postgres so we never hold more than `limit`
  rows in memory.

  Opts:
    * `:search`        — free-text ILIKE across cell.name, location.name,
                         location.code, warehouse.name
    * `:warehouse_id`  — scope to one warehouse (the form's Site filter)
    * `:item_id`       — combined with `:match_tags`, requires that
                         `(location.tags ∪ cell.tags) ⊇ item.storage_tags`
    * `:match_tags`    — boolean; default `true` when an item_id is
                         supplied so the picker honours the operator's
                         intent without an extra round-trip
    * `:limit`         — capped at #{@picker_limit_max}, default
                         #{@picker_limit_default}
    * `:cursor`        — opaque, exclusive-of cursor from a previous page

  Returns `{rows, next_cursor}` — keyset paginated by (warehouse.name,
  floor.ordinal, location.name, cell.ordinal, cell.id) so the
  ordering matches the natural breadcrumb traversal.
  """
  def list_cells_for_picker(company_id, opts \\ []) when is_integer(company_id) do
    limit = opts |> Keyword.get(:limit) |> normalise_limit()
    item = maybe_fetch_item_for_tags(company_id, opts)

    query =
      from c in StorageCell,
        join: l in StorageLocation,
        on: l.id == c.storage_location_id,
        join: f in Floor,
        on: f.id == l.floor_id,
        join: w in Warehouse,
        on: w.id == l.warehouse_id,
        where: c.company_id == ^company_id,
        # Order by cell id ascending — keeps keyset cursor cheap and
        # unambiguous. UX-wise the operator types a search term
        # almost immediately, so default ordering matters less than
        # pagination correctness.
        order_by: [asc: c.id],
        select: %{cell: c, location: l, floor: f, warehouse: w}

    query
    |> maybe_warehouse_filter(opts[:warehouse_id])
    |> maybe_cell_search(opts[:search])
    |> maybe_tag_match(item, opts[:match_tags])
    |> maybe_apply_cursor(opts[:cursor])
    |> limit(^(limit + 1))
    |> Repo.all()
    |> paginate_picker(limit)
  end

  defp normalise_limit(nil), do: @picker_limit_default
  defp normalise_limit(n) when is_integer(n) and n > 0, do: min(n, @picker_limit_max)
  defp normalise_limit(_), do: @picker_limit_default

  defp maybe_warehouse_filter(query, nil), do: query

  defp maybe_warehouse_filter(query, warehouse_id) when is_integer(warehouse_id) do
    where(query, [c, _l, _f, w], w.id == ^warehouse_id)
  end

  defp maybe_cell_search(query, nil), do: query
  defp maybe_cell_search(query, ""), do: query

  defp maybe_cell_search(query, term) when is_binary(term) do
    needle = "%" <> escape_like(String.trim(term)) <> "%"

    from [c, l, _f, w] in query,
      where:
        ilike(c.name, ^needle) or
          ilike(l.name, ^needle) or
          ilike(l.code, ^needle) or
          ilike(w.name, ^needle)
  end

  # When the item declares storage_tags and the caller wants strict
  # matching, require that the cell's effective set (location.tags ∪
  # cell.tags) is a superset. PG arrays make this a single `@>`. We
  # build the array literal at query time via a fragment so any
  # special chars are parameterised.
  defp maybe_tag_match(query, %{storage_tags: tags}, match)
       when is_list(tags) and tags != [] and match != false do
    from [c, l, _f, _w] in query,
      where: fragment("(? || ?) @> ?", l.tags, c.tags, ^tags)
  end

  defp maybe_tag_match(query, _item, _), do: query

  defp maybe_fetch_item_for_tags(company_id, opts) do
    case opts[:item_id] do
      id when is_integer(id) ->
        case Repo.get(Item, id) do
          %Item{company_id: ^company_id} = item -> item
          _ -> nil
        end

      _ ->
        nil
    end
  end

  defp maybe_apply_cursor(query, nil), do: query
  defp maybe_apply_cursor(query, ""), do: query

  defp maybe_apply_cursor(query, cursor) when is_binary(cursor) do
    case decode_picker_cursor(cursor) do
      {:ok, last_id} when is_integer(last_id) ->
        from [c, _l, _f, _w] in query, where: c.id > ^last_id

      _ ->
        query
    end
  end

  defp paginate_picker(rows, limit) do
    {page, rest} = Enum.split(rows, limit)

    next_cursor =
      case rest do
        [] -> nil
        _ ->
          last = List.last(page)
          last && encode_picker_cursor(last.cell.id)
      end

    {page, next_cursor}
  end

  defp encode_picker_cursor(id) when is_integer(id),
    do: Integer.to_string(id) |> Base.url_encode64(padding: false)

  defp decode_picker_cursor(cursor) when is_binary(cursor) do
    case Base.url_decode64(cursor, padding: false) do
      {:ok, raw} ->
        case Integer.parse(raw) do
          {n, ""} -> {:ok, n}
          _ -> :error
        end

      _ ->
        :error
    end
  end
end
