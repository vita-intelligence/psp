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

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.HR
  alias Backend.HR.EmployeeWage
  alias Backend.Items.Item
  alias Backend.Items.RawMaterialCompliance
  alias Backend.Numbering
  alias Backend.Pricelists
  alias Backend.Allergens.Allergen
  alias Backend.Catalogs.ProductFamily
  alias Backend.Production.{
    BOM,
    BOMLine,
    ManufacturingOrder,
    ManufacturingOrderStep,
    Workstation,
    WorkstationGroup
  }
  alias Backend.Repo
  alias Backend.Units.UnitOfMeasurement
  alias Backend.Warehouses.StorageTag

  plug :require_integration_scope, "mo:read"
       when action in [:list_manufacturing_orders, :get_manufacturing_order]

  plug :require_integration_scope, "workstation:read"
       when action in [:list_workstations, :list_workstation_groups]
  plug :require_integration_scope, "item:read"
       when action in [
              :list_items,
              :get_item,
              :get_item_bom,
              :list_units_of_measurement,
              :list_product_families,
              :list_allergens,
              :list_storage_tags
            ]
  plug :require_integration_scope, "hr:read" when action == :list_employees
  plug :require_integration_scope, "user:read" when action == :list_users

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

  # ---- Workstation groups ----

  @doc """
  List workstation groups the caller can target when pushing a
  routing. NPD's stage builder renders these as the "run on"
  dropdown per stage — one row = one machine cluster on the
  shop floor (blender bank, encapsulation line, bottling line).

  Returns only active groups. `kind` distinguishes operator-driven
  (`active_processing`) from unattended (`passive_processing`)
  workstations — NPD surfaces this in the picker so the operator
  understands why some options carry no cycle-time cost.
  """
  def list_workstation_groups(conn, _params) do
    company_id = conn.assigns.current_company_id

    groups =
      Repo.all(
        from g in WorkstationGroup,
          where: g.company_id == ^company_id and g.is_active == true,
          order_by: g.name
      )

    json(conn, %{
      items:
        Enum.map(groups, fn g ->
          %{
            uuid: g.uuid,
            name: g.name,
            kind: g.kind,
            hourly_rate: g.hourly_rate,
            color: g.color,
            default_operation_notes: g.default_operation_notes
          }
        end)
    })
  end

  # ---- Units of measurement + product families ----

  @doc """
  List active units of measurement for the caller's company. NPD's
  stage form renders these as the ``Stock UOM`` picker so scientists
  can align the semi-finished / finished-product output units with
  PSP's own UOM catalog. Returns active only — deprecated UOMs stay
  off the picker.
  """
  def list_units_of_measurement(conn, _params) do
    company_id = conn.assigns.current_company_id

    units =
      Repo.all(
        from u in UnitOfMeasurement,
          where: u.company_id == ^company_id and u.is_active == true,
          order_by: u.name
      )

    json(conn, %{
      items:
        Enum.map(units, fn u ->
          %{
            uuid: u.uuid,
            name: u.name,
            symbol: u.symbol,
            dimension: u.dimension
          }
        end)
    })
  end

  @doc """
  List active product families. NPD renders these as the ``Product
  family`` picker on the stage form — a group tag PSP uses to
  cluster catalogue items in reports + BOM overviews. Returns active
  only.
  """
  def list_product_families(conn, _params) do
    company_id = conn.assigns.current_company_id

    families =
      Repo.all(
        from f in ProductFamily,
          where: f.company_id == ^company_id and f.is_active == true,
          order_by: f.name
      )

    json(conn, %{
      items:
        Enum.map(families, fn f ->
          %{
            uuid: f.uuid,
            name: f.name,
            description: f.description
          }
        end)
    })
  end

  # ---- Allergens + storage tags ----

  @doc """
  List EU FIC Annex II allergens (global, read-only). NPD's Setup
  tab renders these as checkboxes so scientists can flag which
  allergens the finished product declares. Rows are seeded by
  migration; ``uuid`` is the load-bearing key downstream.
  """
  def list_allergens(conn, _params) do
    allergens =
      Repo.all(
        from a in Allergen,
          order_by: [asc: a.sort_order, asc: a.label]
      )

    json(conn, %{
      items:
        Enum.map(allergens, fn a ->
          %{
            uuid: a.uuid,
            key: a.key,
            label: a.label,
            source: a.source
          }
        end)
    })
  end

  @doc """
  List active storage tags for the caller's company. NPD's Setup
  tab uses these as a multi-select on the formulation's warehouse
  identity — every finished-product item carries them so goods-in
  can auto-route lots on receive.
  """
  def list_storage_tags(conn, _params) do
    company_id = conn.assigns.current_company_id

    tags =
      Repo.all(
        from t in StorageTag,
          where: t.company_id == ^company_id and t.is_active == true,
          order_by: t.name
      )

    json(conn, %{
      items:
        Enum.map(tags, fn t ->
          %{
            uuid: t.uuid,
            name: t.name,
            color: t.color
          }
        end)
    })
  end

  # ---- Users ----

  @doc """
  List active operators the caller can assign to a routing step.
  NPD's stage builder renders these as the "workers" multi-picker
  in each stage's operation-details drawer, so scientists can
  attach the default crew per stage. Returns only active users —
  disabled accounts stay off the picker.
  """
  def list_users(conn, _params) do
    company_id = conn.assigns.current_company_id

    users =
      Repo.all(
        from u in User,
          where: u.company_id == ^company_id and u.is_active == true,
          order_by: u.name
      )

    json(conn, %{
      items:
        Enum.map(users, fn u ->
          %{
            uuid: u.uuid,
            name: u.name,
            email: u.email,
            is_admin: u.is_admin
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

    # Accept comma-separated lists so NPD's shared multi-picker
    # can push its whole ``useAsIn`` set through in one query
    # (MCC carrier = Sweetener + Bulking Agent, powder carrier =
    # Carrier + Bulking Agent, etc.). Single value keeps working
    # unchanged — that's the vast majority of picker callers.
    use_as_list =
      case params["use_as"] do
        s when is_binary(s) ->
          parts =
            s
            |> String.split(",", trim: true)
            |> Enum.map(&String.trim/1)
            |> Enum.reject(&(&1 == ""))

          if parts == [], do: nil, else: parts

        _ ->
          nil
      end

    base =
      from i in Item,
        left_join: pf in assoc(i, :product_family),
        where: i.company_id == ^company_id and i.is_active == true,
        order_by: i.name,
        # Preload the raw-material compliance side-table so the
        # shape helper can pull ``use_as`` from there when it's
        # not on ``attributes``. Items with no compliance row
        # (packaging, equipment, ...) come back with a nil assoc,
        # handled explicitly downstream.
        preload: [:raw_material_compliance, product_family: pf]

    query =
      base
      |> maybe_filter_item_types(types)
      |> maybe_filter_search(search)
      |> maybe_filter_use_as(use_as_list)

    items = Repo.all(query)
    prices = load_prices(company_id, items)
    company = Repo.get!(Company, company_id)

    json(conn, %{
      items: Enum.map(items, &integration_item_shape(&1, prices, company))
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
          preload: [:raw_material_compliance, product_family: pf]
      )

    case item do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "item_not_found"})

      %Item{} ->
        prices = load_prices(company_id, [item])
        company = Repo.get!(Company, company_id)

        json(conn, %{item: integration_item_shape(item, prices, company)})
    end
  end

  @doc """
  Return the item's active primary BOM (header + component lines).

  Used by NPD to hydrate a formulation from PSP's existing recipe —
  the scientist links the finished-product item, hits "Load BOM from
  PSP", and NPD wholesale-replaces the finished stage's lines with
  what PSP has. On save the push cascade writes the (possibly-edited)
  BOM back over the top as a new version.

  Response shape:

      {"bom": {
         "uuid": "...",
         "name": "...",
         "notes": "...",
         "item_uuid": "...",
         "lines": [
           {"sort_order": 0, "qty": "0.5000", "is_fixed": false,
            "notes": "", "uom_uuid": "...", "uom_symbol": "kg",
            "part": {<same shape as GET /items/:uuid>}},
           ...
         ]}}

  Returns 404 if the item exists but has no primary BOM — that lets
  the caller distinguish "no BOM yet" from "item not found".
  """
  def get_item_bom(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    with %Item{} = item <- fetch_item_by_uuid(company_id, uuid),
         %BOM{} = bom <- fetch_primary_bom(company_id, item.id) do
      preloaded_bom =
        Repo.preload(bom,
          lines: [
            :unit_of_measurement,
            part: [:raw_material_compliance, :product_family]
          ]
        )

      lines = Enum.sort_by(preloaded_bom.lines, & &1.sort_order)
      # Load prices for every line's part in one query so the
      # projection re-uses `integration_item_shape` without spawning
      # an N+1 pricelist lookup.
      parts = Enum.map(lines, & &1.part)
      prices = load_prices(company_id, parts)
      company = Repo.get!(Company, company_id)

      json(conn, %{
        bom: %{
          uuid: preloaded_bom.uuid,
          name: preloaded_bom.name,
          notes: preloaded_bom.notes,
          is_primary: preloaded_bom.is_primary,
          is_active: preloaded_bom.is_active,
          item_uuid: item.uuid,
          lines:
            Enum.map(lines, fn line ->
              %{
                uuid: line.uuid,
                sort_order: line.sort_order,
                qty: (line.qty && Decimal.to_string(line.qty)) || nil,
                is_fixed: line.is_fixed,
                notes: line.notes,
                uom_uuid: line.unit_of_measurement && line.unit_of_measurement.uuid,
                uom_symbol:
                  line.unit_of_measurement && line.unit_of_measurement.symbol,
                uom_name:
                  line.unit_of_measurement && line.unit_of_measurement.name,
                part: integration_item_shape(line.part, prices, company)
              }
            end)
        }
      })
    else
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "bom_not_found"})
    end
  end

  defp fetch_item_by_uuid(company_id, uuid) do
    Repo.one(
      from i in Item,
        where:
          i.company_id == ^company_id and i.uuid == ^uuid and
            i.is_active == true,
        limit: 1
    )
  end

  defp fetch_primary_bom(company_id, item_id) do
    Repo.one(
      from b in BOM,
        where:
          b.company_id == ^company_id and b.item_id == ^item_id and
            b.is_active == true and b.is_primary == true,
        limit: 1
    )
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
  #
  # Accepts a list so the shared multi-picker in NPD (which drives
  # MCC carrier = Sweetener + Bulking Agent, powder carrier =
  # Carrier + Bulking Agent, etc.) can push its whole set through
  # in one query.
  defp maybe_filter_use_as(query, nil), do: query
  defp maybe_filter_use_as(query, needles) when is_list(needles) do
    # ``attributes.use_as`` (JSONB) stores the historical Title
    # Case values from the NPD import + PSP integration wire.
    # ``raw_material_compliance.use_as`` (side-table column)
    # stores lowercase snake_case values from the item-form UI.
    # A caller filtering ``?use_as=Capsule%20Shell`` should match
    # items tagged EITHER way — so we probe both sources with
    # their respective forms.
    snake_needles =
      needles
      |> Enum.map(&RawMaterialCompliance.snake_use_as/1)
      |> Enum.reject(&is_nil/1)

    from i in query,
      left_join: rmc in assoc(i, :raw_material_compliance),
      where:
        fragment("?->>'use_as' = ANY(?)", i.attributes, ^needles) or
          rmc.use_as in ^snake_needles
  end

  defp load_prices(_company_id, []), do: %{}

  defp load_prices(company_id, items) do
    ids = Enum.map(items, & &1.id)
    Pricelists.default_list_prices_for_items(company_id, ids)
  end

  defp integration_item_shape(%Item{} = i, prices_by_id, %Company{} = company) do
    price = Map.get(prices_by_id, i.id)
    attributes = i.attributes || %{}
    # Two possible sources for ``use_as``:
    #
    # 1. ``attributes.use_as`` (a JSONB key) — populated by the
    #    NPD import + tag scripts using the Title-Case form NPD
    #    picker filters expect ("Carrier", "Capsule Shell", ...).
    # 2. ``item.raw_material_compliance.use_as`` (a side-table
    #    column) — populated by PSP's item form UI using
    #    lowercase snake ("carrier", "capsule_shell", ...).
    #
    # Attributes win when set (they're the direct "wire override"
    # path). Otherwise fall through to the compliance row and
    # normalise snake → Title Case via ``display_use_as/1`` so
    # NPD's picker filters match either source.
    use_as =
      case Map.get(attributes, "use_as") do
        nil -> compliance_use_as(i)
        "" -> compliance_use_as(i)
        v -> v
      end

    %{
      uuid: i.uuid,
      name: i.name,
      description: i.description,
      item_type: i.item_type,
      external_sku: i.external_sku,
      # System-generated display code (``MA00295``, ``PT00007``,
      # ...), rendered on the fly from the item's integer PK
      # against the company's numbering format. Every item has
      # one — this is the value the PSP UI prints as "Code" and
      # what NPD's BOM should show for procurement scans.
      # ``nil`` when the company has no numbering format
      # configured for the ``item`` entity key, which the FE
      # renders as an em-dash.
      code: Numbering.render(i.id, company, "item"),
      barcode: i.barcode,
      is_active: i.is_active,
      use_as: use_as,
      # Full attributes map so downstream integration consumers
      # (NPD's dose-math reads purity / overage / extract_ratio;
      # spec sheets read allergen / country-of-origin) can pick up
      # anything the PSP-side scientist has recorded against the
      # item. The flat ``use_as`` field above stays for backward
      # compatibility with early NPD picker code that reads the
      # projection — cheap to keep and avoids a coordinated FE rev.
      attributes: attributes,
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

  # Read ``use_as`` off the item's raw_material_compliance side-
  # table (populated by the item form UI) and render it as the
  # Title Case form the wire has always emitted. Handles the
  # not-loaded / no-row / packaging-item cases by returning nil.
  defp compliance_use_as(%Item{raw_material_compliance: %RawMaterialCompliance{use_as: raw}}) do
    RawMaterialCompliance.display_use_as(raw)
  end

  defp compliance_use_as(_), do: nil

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
