defmodule BackendWeb.IntegrationReadController do
  @moduledoc """
  Read-side endpoints for the vita-performance integration. Every
  action is scope-gated by a `RequireIntegrationAuth` plug applied
  at the router level.

  All responses are company-scoped from `conn.assigns.current_company_id`,
  which the plug sets from the bearer token — the caller can't
  accidentally cross tenants.
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.HR
  alias Backend.HR.EmployeeWage
  alias Backend.Items.Item
  alias Backend.Pricelists
  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderStep, Workstation}
  alias Backend.Repo

  plug :require_integration_scope, "mo:read"
       when action in [:list_manufacturing_orders, :get_manufacturing_order]

  plug :require_integration_scope, "workstation:read" when action == :list_workstations
  plug :require_integration_scope, "item:read" when action in [:list_items, :get_item]
  plug :require_integration_scope, "hr:read" when action == :list_employees

  action_fallback BackendWeb.FallbackController

  # ---- Manufacturing orders ----

  def list_manufacturing_orders(conn, params) do
    company_id = conn.assigns.current_company_id
    statuses = parse_status_filter(params["status"])
    workstation_uuid = params["workstation_uuid"]

    # MO steps route to a workstation_group, not to a specific
    # workstation. So "MOs routed to Weighing #1" means "MOs with a
    # step targeting Weighing #1's group". We look up the group off
    # the workstation before hitting the MO query so the SQL stays
    # a plain WHERE, not a JOIN across a nullable chain.
    group_id =
      case workstation_uuid do
        u when is_binary(u) and u != "" ->
          Repo.one(
            from w in Workstation,
              where: w.company_id == ^company_id and w.uuid == ^u,
              select: w.workstation_group_id
          )

        _ ->
          nil
      end

    base =
      from mo in ManufacturingOrder,
        where: mo.company_id == ^company_id and mo.status in ^statuses,
        preload: [:item, steps: :workstation_group]

    base =
      if group_id do
        from mo in base,
          join: s in assoc(mo, :steps),
          where: s.workstation_group_id == ^group_id,
          distinct: true
      else
        base
      end

    mos = Repo.all(base)
    json(conn, %{items: Enum.map(mos, &mo_payload(&1, group_id))})
  end

  def get_manufacturing_order(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    case Repo.one(
           from mo in ManufacturingOrder,
             where: mo.company_id == ^company_id and mo.uuid == ^uuid,
             preload: [:item, steps: :workstation_group]
         ) do
      nil -> {:error, :not_found}
      mo -> json(conn, %{manufacturing_order: mo_payload(mo, nil)})
    end
  end

  defp parse_status_filter(nil), do: ["scheduled", "in_progress"]
  defp parse_status_filter(""), do: ["scheduled", "in_progress"]

  defp parse_status_filter(s) when is_binary(s) do
    s
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1)
    |> Enum.filter(&(&1 != ""))
  end

  defp mo_payload(%ManufacturingOrder{} = mo, filter_group_id) do
    %{
      uuid: mo.uuid,
      status: mo.status,
      quantity: to_string(mo.quantity),
      due_date: mo.due_date,
      item: item_summary(mo.item),
      steps:
        Enum.map(mo.steps || [], fn step ->
          step
          |> mo_step_summary()
          |> Map.put(
            :for_this_workstation,
            filter_group_id != nil and
              step.workstation_group_id == filter_group_id
          )
        end)
    }
  end

  defp mo_step_summary(%ManufacturingOrderStep{} = step) do
    %{
      uuid: step.uuid,
      sort_order: step.sort_order,
      # Steps use `operation_description` as their human label; `name`
      # is a legacy field that no longer exists on the schema.
      name: step.operation_description,
      # Steps don't carry their own status column — it's derived from
      # the parent MO's status + preflight / QC events. Return nil
      # so callers know to look at the MO status instead.
      status: nil,
      planned_start: step.planned_start,
      planned_finish: step.planned_finish,
      actual_start: step.actual_start,
      actual_finish: step.actual_finish,
      # Steps target a workstation group, not a specific station.
      # The kiosk uses the group to know "is this MO for any of the
      # stations in my group?"
      workstation_group: workstation_group_summary(step.workstation_group)
    }
  end

  defp workstation_group_summary(nil), do: nil

  defp workstation_group_summary(%{uuid: uuid, name: name}) do
    %{uuid: uuid, name: name}
  end

  defp item_summary(nil), do: nil

  defp item_summary(%Item{} = i) do
    %{uuid: i.uuid, name: i.name, item_type: Map.get(i, :item_type)}
  end

  # ---- Workstations ----

  def list_workstations(conn, params) do
    company_id = conn.assigns.current_company_id
    only_sot = params["source_of_truth_only"] in ["true", "1"]

    query =
      from w in Workstation,
        where: w.company_id == ^company_id and w.is_active == true

    query =
      if only_sot, do: from(w in query, where: w.psp_source_of_truth == true), else: query

    workstations = Repo.all(from w in query, order_by: w.name)

    json(conn, %{
      items:
        Enum.map(workstations, fn w ->
          %{
            uuid: w.uuid,
            external_id: w.external_id,
            name: w.name,
            hourly_rate: w.hourly_rate,
            productivity: w.productivity,
            is_active: w.is_active,
            psp_source_of_truth: w.psp_source_of_truth
          }
        end)
    })
  end

  # ---- Items ----

  @doc """
  List items for the integration caller.

  Supports:

  * `item_types=raw_material,packaging` — comma-separated whitelist
    filter. Omitted → all types.
  * `search=` — case-insensitive substring match against name,
    `external_sku`, and barcode. Untrimmed empty strings and
    whitespace-only values are ignored so a stale FE query state
    doesn't hide every row.
  * `use_as=flavouring` — exact match against `attributes.use_as`.
    Used by NPD's ingredient pickers, which pre-filter items by
    category (flavouring / colour / gummy_base / …).

  Response fields on each row:

  * Base identity: `uuid`, `name`, `description`, `item_type`,
    `external_sku`, `barcode`, `is_active`.
  * `use_as` — sourced from `attributes.use_as` when present.
  * `product_family` — `{uuid, name}` or `null`.
  * `selling_price` + `currency_code` — from the company's active
    default pricelist at the min_quantity=1 tier. Nil when the
    company has no active default pricelist OR the item has no
    row on it. Callers render "no PSP price" the same way they
    handle a missing item.
  """
  def list_items(conn, params) do
    company_id = conn.assigns.current_company_id

    types =
      case params["item_types"] do
        nil -> nil
        "" -> nil
        s -> String.split(s, ",", trim: true)
      end

    search =
      case params["search"] do
        s when is_binary(s) ->
          trimmed = String.trim(s)
          if trimmed == "", do: nil, else: trimmed

        _ ->
          nil
      end

    use_as =
      case params["use_as"] do
        s when is_binary(s) ->
          trimmed = String.trim(s)
          if trimmed == "", do: nil, else: trimmed

        _ ->
          nil
      end

    base =
      from i in Item,
        left_join: pf in assoc(i, :product_family),
        where: i.company_id == ^company_id and i.is_active == true,
        order_by: i.name,
        preload: [product_family: pf]

    query =
      base
      |> maybe_filter_item_types(types)
      |> maybe_filter_search(search)
      |> maybe_filter_use_as(use_as)

    items = Repo.all(query)
    prices = load_prices(company_id, items)

    json(conn, %{
      items: Enum.map(items, &integration_item_shape(&1, prices))
    })
  end

  @doc """
  Fetch a single item by UUID. Same wire shape as one entry from
  `list_items`. 404 when the UUID doesn't belong to the caller's
  company or the item is inactive — matches the "no existence
  leak" convention every other integration read enforces.
  """
  def get_item(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    item =
      Repo.one(
        from i in Item,
          left_join: pf in assoc(i, :product_family),
          where:
            i.company_id == ^company_id and i.uuid == ^uuid and
              i.is_active == true,
          preload: [product_family: pf]
      )

    case item do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "item_not_found"})

      %Item{} ->
        prices = load_prices(company_id, [item])

        json(conn, %{item: integration_item_shape(item, prices)})
    end
  end

  defp maybe_filter_item_types(query, nil), do: query
  defp maybe_filter_item_types(query, types) do
    from i in query, where: i.item_type in ^types
  end

  defp maybe_filter_search(query, nil), do: query
  defp maybe_filter_search(query, needle) do
    like = "%#{needle}%"

    from i in query,
      where:
        ilike(i.name, ^like) or
          ilike(i.external_sku, ^like) or
          ilike(i.barcode, ^like)
  end

  # ``attributes`` is a jsonb map on the Item row; NPD's ingredient
  # pickers filter by ``attributes.use_as`` (flavouring / colour /
  # gummy_base / …). Exact match — the categories are a small
  # closed vocabulary, no substring semantics needed.
  defp maybe_filter_use_as(query, nil), do: query
  defp maybe_filter_use_as(query, needle) do
    from i in query, where: fragment("?->>'use_as' = ?", i.attributes, ^needle)
  end

  defp load_prices(_company_id, []), do: %{}

  defp load_prices(company_id, items) do
    ids = Enum.map(items, & &1.id)
    Pricelists.default_list_prices_for_items(company_id, ids)
  end

  defp integration_item_shape(%Item{} = i, prices_by_id) do
    price = Map.get(prices_by_id, i.id)
    attributes = i.attributes || %{}
    use_as = Map.get(attributes, "use_as")

    %{
      uuid: i.uuid,
      name: i.name,
      description: i.description,
      item_type: i.item_type,
      external_sku: i.external_sku,
      barcode: i.barcode,
      is_active: i.is_active,
      use_as: use_as,
      product_family:
        case i.product_family do
          nil ->
            nil

          pf ->
            %{uuid: pf.uuid, name: pf.name}
        end,
      # Selling price snapshot from the active default pricelist at
      # the qty=1 tier. Serialise as a string so the wire format
      # matches every other Decimal in this repo — the FE parses
      # to Number on display and never has to worry about JS
      # float-precision drift.
      selling_price:
        case price do
          %{selling_price: p} -> Decimal.to_string(p)
          _ -> nil
        end,
      currency_code:
        case price do
          %{currency_code: c} -> c
          _ -> nil
        end
    }
  end

  # ---- HR / Employees ----

  def list_employees(conn, _params) do
    company_id = conn.assigns.current_company_id
    employees = HR.list_employees(company_id, active_only: true)

    json(conn, %{
      items:
        Enum.map(employees, fn e ->
          wage = HR.current_wage(e)

          %{
            uuid: e.uuid,
            external_id: e.external_id,
            full_name: e.full_name,
            preferred_name: e.preferred_name,
            is_active: e.is_active,
            is_qa: e.is_qa,
            reputation_score: e.reputation_score,
            employee_number: e.employee_number,
            has_pin: not is_nil(e.kiosk_pin_hash),
            current_hourly_rate:
              case wage do
                %EmployeeWage{hourly_rate: r} -> to_string(r)
                _ -> nil
              end,
            currency_code: wage && wage.currency_code
          }
        end)
    })
  end
end
