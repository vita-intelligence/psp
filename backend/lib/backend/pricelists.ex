defmodule Backend.Pricelists do
  @moduledoc """
  Boundary for the pricelist registry + its per-item lines.

  The headline function for downstream callers is `price_for/3`:

      price_for(customer, item_id, qty)
        ⇒ %{
            unit_price: Decimal.t(),
            currency_code: String.t(),
            min_quantity: Decimal.t(),
            pricelist_id: integer,
            pricelist_name: String.t(),
            source: :customer | :company_default
          }
        | nil

  Hierarchy:
    1. The customer's pricelist (`customers.pricelist_id`)
    2. The company's default pricelist (`is_default = true`)
    3. nil — no quote available, caller must use catalogue / prompt

  For a given pricelist, tiered pricing falls out of the row layout:
  we pick the row with the highest `min_quantity` whose threshold
  ≤ `qty`. So 50 units of an item with rows at min_qty (1, 100, 1000)
  uses the min_qty=1 row.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Customers.Customer
  alias Backend.ListQueries
  alias Backend.Repo
  alias Backend.Pricelists.{Pricelist, PricelistItem}

  @pricelist_audit_fields ~w(name currency_code is_default is_active
                             valid_from valid_until notes)a
  @pricelist_sortable ~w(id name currency_code is_default is_active valid_from
                         valid_until inserted_at updated_at)a
  @pricelist_search ~w(name notes)a
  @pricelist_default_sort {:name, :asc}

  # ----- registry list / get ---------------------------------------

  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = normalise_sort(Keyword.get(opts, :sort, @pricelist_default_sort))

    {code_id, column_filter} =
      ListQueries.pop_code_column_filter(opts[:column_filter], company_id, "pricelist")

    base =
      Pricelist
      |> where([p], p.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @pricelist_search, {company_id, "pricelist"})
      |> maybe_active_filter(opts[:is_active])
      |> maybe_code_id_filter(code_id)
      |> ListQueries.apply_column_filters(column_filter, @pricelist_sortable)
      |> ListQueries.apply_sort(sort, @pricelist_sortable, @pricelist_default_sort)
      |> preload([:created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  defp maybe_code_id_filter(query, nil), do: query
  defp maybe_code_id_filter(query, :no_match), do: where(query, [p], false)
  defp maybe_code_id_filter(query, id) when is_integer(id),
    do: where(query, [p], p.id == ^id)

  defp maybe_active_filter(query, nil), do: query

  defp maybe_active_filter(query, val) when is_boolean(val),
    do: where(query, [p], p.is_active == ^val)

  defp maybe_active_filter(query, "true"), do: where(query, [p], p.is_active == true)
  defp maybe_active_filter(query, "false"), do: where(query, [p], p.is_active == false)
  defp maybe_active_filter(query, _), do: query

  def list_for_company(company_id) do
    Repo.all(
      from(p in Pricelist,
        where: p.company_id == ^company_id and p.is_active == true,
        order_by: [desc: p.is_default, asc: p.name]
      )
    )
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Pricelist
        |> where([p], p.company_id == ^company_id and p.uuid == ^cast)
        |> Repo.one()
        |> case do
          nil -> nil
          pricelist -> preload_pricelist(pricelist)
        end

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  # ----- create / update / delete ----------------------------------

  def create(%User{} = actor, company_id, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %Pricelist{}
    |> Pricelist.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, pricelist} ->
        Audit.record_created(actor, "pricelist", pricelist, pricelist_snapshot(pricelist))
        Backend.Broadcasts.entity_changed("pricelist", pricelist.uuid, pricelist.company_id, "created")
        {:ok, preload_pricelist(pricelist)}

      other ->
        other
    end
  end

  def update(%User{} = actor, %Pricelist{} = pricelist, attrs) do
    before_state = pricelist_snapshot(pricelist)
    attrs = attrs |> stringify_keys() |> Map.put("updated_by_id", actor.id)

    pricelist
    |> Pricelist.changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "pricelist",
          updated,
          before_state,
          pricelist_snapshot(updated)
        )

        Backend.Broadcasts.entity_changed("pricelist", updated.uuid, updated.company_id, "updated")
        {:ok, preload_pricelist(updated)}

      other ->
        other
    end
  end

  def delete(%User{} = actor, %Pricelist{} = pricelist) do
    before_state = pricelist_snapshot(pricelist)

    case Repo.delete(pricelist) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "pricelist", pricelist, before_state)
        Backend.Broadcasts.entity_changed("pricelist", pricelist.uuid, pricelist.company_id, "deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  @doc """
  Flip the `is_default` flag on one pricelist + clear it on any
  previous default in the same company. Wrapped in a transaction so
  the partial unique index never sees two defaults at once.
  """
  def set_default(%User{} = actor, %Pricelist{} = pricelist) do
    Repo.transaction(fn ->
      Repo.update_all(
        from(p in Pricelist,
          where: p.company_id == ^pricelist.company_id and p.id != ^pricelist.id
        ),
        set: [is_default: false, updated_at: DateTime.utc_now() |> DateTime.truncate(:second)]
      )

      changeset =
        Pricelist.set_default_changeset(pricelist, %{
          "is_default" => true,
          "updated_by_id" => actor.id
        })

      case Repo.update(changeset) do
        {:ok, updated} ->
          Audit.record_updated(
            actor,
            "pricelist",
            updated,
            %{is_default: pricelist.is_default},
            %{is_default: true}
          )

          preload_pricelist(updated)

        {:error, cs} ->
          Repo.rollback(cs)
      end
    end)
    |> tap(fn
      {:ok, %Pricelist{} = pl} ->
        Backend.Broadcasts.entity_changed("pricelist", pl.uuid, pl.company_id, "default_set")

      _ ->
        :ok
    end)
  end

  # ----- line items -----------------------------------------------

  def add_line(%User{} = actor, %Pricelist{} = pricelist, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "pricelist_id" => pricelist.id,
        "company_id" => pricelist.company_id
      })

    %PricelistItem{}
    |> PricelistItem.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, row} ->
        Audit.record_created(actor, "pricelist_item", row, %{
          pricelist_id: row.pricelist_id,
          item_id: row.item_id,
          min_quantity: row.min_quantity,
          selling_price: row.selling_price
        })

        Backend.Broadcasts.entity_changed(
          "pricelist",
          pricelist.uuid,
          pricelist.company_id,
          "line_added"
        )

        {:ok, Repo.preload(row, [item: :stock_uom])}

      other ->
        other
    end
  end

  def update_line(%User{} = actor, %PricelistItem{} = row, attrs) do
    before_state = %{
      item_id: row.item_id,
      min_quantity: row.min_quantity,
      selling_price: row.selling_price,
      notes: row.notes
    }

    row
    |> PricelistItem.changeset(stringify_keys(attrs))
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "pricelist_item",
          updated,
          before_state,
          %{
            item_id: updated.item_id,
            min_quantity: updated.min_quantity,
            selling_price: updated.selling_price,
            notes: updated.notes
          }
        )

        broadcast_pricelist_by_id(updated.pricelist_id, updated.company_id, "line_updated")
        {:ok, Repo.preload(updated, [item: :stock_uom])}

      other ->
        other
    end
  end

  def remove_line(%User{} = actor, %PricelistItem{} = row) do
    case Repo.delete(row) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "pricelist_item", row, %{
          pricelist_id: row.pricelist_id,
          item_id: row.item_id,
          min_quantity: row.min_quantity
        })

        broadcast_pricelist_by_id(row.pricelist_id, row.company_id, "line_deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  defp broadcast_pricelist_by_id(pricelist_id, company_id, action)
       when is_integer(pricelist_id) and is_integer(company_id) do
    case Repo.get(Pricelist, pricelist_id) do
      %Pricelist{uuid: uuid} ->
        Backend.Broadcasts.entity_changed("pricelist", uuid, company_id, action)

      _ ->
        :ok
    end
  end

  defp broadcast_pricelist_by_id(_, _, _), do: :ok

  def get_line(pricelist_id, uuid) when is_integer(pricelist_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(li in PricelistItem,
            where: li.pricelist_id == ^pricelist_id and li.uuid == ^cast,
            preload: [item: :stock_uom]
          )
        )

      :error ->
        nil
    end
  end

  def get_line(_, _), do: nil

  # ----- lookup ----------------------------------------------------

  @doc """
  Resolve the unit price for (customer, item, qty). Returns nil if
  no pricelist quotes the item.

  Skips inactive pricelists and ones outside their validity window.
  Picks the highest-min_quantity tier whose threshold ≤ qty.
  """
  def price_for(%Customer{} = customer, item_id, qty) when is_integer(item_id) do
    qty_dec = to_decimal(qty)

    resolved_pricelist =
      cond do
        customer.pricelist_id != nil ->
          {fetch_active_pricelist(customer.company_id, customer.pricelist_id), :customer}

        true ->
          {fetch_active_default(customer.company_id), :company_default}
      end

    case resolved_pricelist do
      {nil, _} ->
        nil

      {pricelist, source} ->
        case fetch_tier(pricelist.id, item_id, qty_dec) do
          nil -> nil
          row -> build_price_result(pricelist, row, source)
        end
    end
  end

  @doc """
  Batch list-price lookup for a set of item ids against the company's
  active default pricelist at min_quantity 1 (the "list price" tier).

  Returns a map `%{item_id => %{selling_price: Decimal, currency_code: String}}`.
  Items with no matching pricelist row are simply absent from the
  result, so a caller can distinguish "priced" from "unpriced" without
  a second query per item.

  Used by the machine-to-machine integration surface
  (`GET /api/integration/items`) — NPD needs the price to seed its
  proposal / spec-sheet price-hint UI. A per-item `price_for/3` call
  in a loop would be one round-trip per row; this single query
  handles the whole page.

  When no active default pricelist exists on the company, returns
  an empty map — callers render "no PSP price" the same way they
  do for individual missing rows.
  """
  def default_list_prices_for_items(company_id, item_ids)
      when is_integer(company_id) and is_list(item_ids) do
    case fetch_active_default(company_id) do
      nil ->
        %{}

      %Pricelist{} = pricelist ->
        # Highest-min_quantity row whose threshold ≤ 1 wins — matches
        # the price_for/3 tier semantics for the list-price case. We
        # take the row where min_quantity is smallest (typically 1),
        # per item.
        one = Decimal.new(1)

        rows =
          Repo.all(
            from(li in PricelistItem,
              where:
                li.pricelist_id == ^pricelist.id and
                  li.item_id in ^item_ids and
                  li.min_quantity <= ^one,
              order_by: [asc: li.item_id, desc: li.min_quantity]
            )
          )

        # First row per item_id wins because of the order_by desc on
        # min_quantity — matches the fetch_tier/3 semantics.
        Enum.reduce(rows, %{}, fn row, acc ->
          Map.put_new(acc, row.item_id, %{
            selling_price: row.selling_price,
            currency_code: pricelist.currency_code
          })
        end)
    end
  end

  defp build_price_result(%Pricelist{} = pricelist, %PricelistItem{} = row, source) do
    %{
      unit_price: row.selling_price,
      currency_code: pricelist.currency_code,
      min_quantity: row.min_quantity,
      pricelist_id: pricelist.id,
      pricelist_uuid: pricelist.uuid,
      pricelist_name: pricelist.name,
      source: source
    }
  end

  defp fetch_active_pricelist(company_id, pricelist_id) do
    today = Date.utc_today()

    Repo.one(
      from(p in Pricelist,
        where:
          p.company_id == ^company_id and p.id == ^pricelist_id and
            p.is_active == true and
            (is_nil(p.valid_from) or p.valid_from <= ^today) and
            (is_nil(p.valid_until) or p.valid_until >= ^today)
      )
    )
  end

  defp fetch_active_default(company_id) do
    today = Date.utc_today()

    Repo.one(
      from(p in Pricelist,
        where:
          p.company_id == ^company_id and p.is_default == true and
            p.is_active == true and
            (is_nil(p.valid_from) or p.valid_from <= ^today) and
            (is_nil(p.valid_until) or p.valid_until >= ^today),
        limit: 1
      )
    )
  end

  defp fetch_tier(pricelist_id, item_id, %Decimal{} = qty) do
    # Highest min_quantity row whose threshold ≤ qty wins.
    Repo.one(
      from(li in PricelistItem,
        where:
          li.pricelist_id == ^pricelist_id and li.item_id == ^item_id and
            li.min_quantity <= ^qty,
        order_by: [desc: li.min_quantity],
        limit: 1
      )
    )
  end

  defp to_decimal(%Decimal{} = d), do: d
  defp to_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp to_decimal(n) when is_float(n), do: Decimal.from_float(n)

  defp to_decimal(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, _} -> d
      :error -> Decimal.new(0)
    end
  end

  defp to_decimal(_), do: Decimal.new(0)

  # ----- internals -------------------------------------------------

  defp preload_pricelist(%Pricelist{} = p) do
    p
    |> Repo.preload([
      :created_by,
      :updated_by,
      items: [item: :stock_uom]
    ])
    |> sort_items()
  end

  defp sort_items(%Pricelist{} = p) do
    sorted =
      Enum.sort_by(p.items, fn li ->
        {li.item && li.item.name, Decimal.to_float(li.min_quantity)}
      end)

    %{p | items: sorted}
  end

  defp pricelist_snapshot(%Pricelist{} = p),
    do: Map.new(@pricelist_audit_fields, fn k -> {k, Map.get(p, k)} end)

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
