defmodule BackendWeb.IntegrationReadItemsTest do
  @moduledoc """
  End-to-end tests for the machine-to-machine `/api/integration/items`
  surface. NPD is the downstream consumer — its formulation builder
  and price hint UI both fetch through here — so the wire shape is a
  hard contract.

  Coverage:

  * Auth pipeline: missing / bad token, missing scope → 401 / 403.
  * List: item-type filter, search filter (name / external_sku /
    barcode), `use_as` attribute filter (drives NPD's ingredient
    pickers), cross-company scoping (no leakage across tenants).
  * Pricing: `selling_price` + `currency_code` sourced from the
    company's active default pricelist at min_quantity=1; nil when
    no active default exists or the item has no row on it.
  * Get one: 404 for cross-company / inactive / unknown UUIDs.
  """

  use BackendWeb.ConnCase, async: false

  alias Backend.Accounts.User
  alias Backend.Catalogs
  alias Backend.Companies.Company
  alias Backend.IntegrationTokens
  alias Backend.Items.Item
  alias Backend.Pricelists
  alias Backend.Pricelists.{Pricelist, PricelistItem}
  alias Backend.Repo

  defp seed_company(name) do
    company = Repo.insert!(%Company{name: name})

    user =
      Repo.insert!(%User{
        company_id: company.id,
        email: "ops-#{System.unique_integer([:positive])}@example.com",
        name: "Ops",
        hashed_password: "$2b$12$placeholder",
        is_active: true,
        confirmed_at: DateTime.utc_now() |> DateTime.truncate(:second)
      })

    {:ok, %{token: raw, record: record}} =
      IntegrationTokens.create(
        %{name: "npd-integration", scopes: ["item:read"]},
        company.id,
        user.id
      )

    %{company: company, user: user, raw: raw, token_record: record}
  end

  defp insert_item(company, attrs) do
    default = %{
      company_id: company.id,
      name: "Item #{System.unique_integer([:positive])}",
      item_type: "raw_material",
      is_active: true,
      attributes: %{}
    }

    Repo.insert!(struct!(Item, Map.merge(default, attrs)))
  end

  defp create_default_pricelist(company, currency \\ "GBP") do
    Repo.insert!(%Pricelist{
      company_id: company.id,
      name: "Default",
      currency_code: currency,
      is_default: true,
      is_active: true
    })
  end

  defp set_price(pricelist, item, selling_price, min_quantity \\ Decimal.new(1)) do
    Repo.insert!(%PricelistItem{
      pricelist_id: pricelist.id,
      item_id: item.id,
      company_id: pricelist.company_id,
      selling_price: Decimal.new(selling_price),
      min_quantity: min_quantity
    })
  end

  # ---------------------------------------------------------------------------
  # Auth pipeline
  # ---------------------------------------------------------------------------

  test "list_items 401 without a token", %{conn: conn} do
    result =
      conn
      |> get(~p"/api/integration/items")
      |> json_response(401)

    assert result["error"] == "missing_integration_token"
  end

  test "list_items 403 when token lacks item:read scope", %{conn: conn} do
    %{company: company, user: user} = seed_company("NoScope Co")

    {:ok, %{token: raw}} =
      IntegrationTokens.create(
        %{name: "no-item-scope", scopes: ["mo:read"]},
        company.id,
        user.id
      )

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items")
      |> json_response(403)

    assert result["error"] == "insufficient_scope"
  end

  # ---------------------------------------------------------------------------
  # List — filters + shape
  # ---------------------------------------------------------------------------

  test "list_items returns rows scoped to the caller's company", %{conn: conn} do
    %{company: mine, raw: raw} = seed_company("Mine Co")
    other = seed_company("Other Co")

    insert_item(mine, %{name: "mine-a"})
    insert_item(mine, %{name: "mine-b"})
    insert_item(other.company, %{name: "other-x"})

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items")
      |> json_response(200)

    names = Enum.map(result["items"], & &1["name"])
    assert Enum.sort(names) == ["mine-a", "mine-b"]
  end

  test "list_items search matches name / external_sku / barcode", %{conn: conn} do
    %{company: company, raw: raw} = seed_company("Search Co")

    insert_item(company, %{name: "Ashwagandha KSM-66"})
    insert_item(company, %{
      name: "Vitamin C 500mg",
      external_sku: "VIT-C-500"
    })
    insert_item(company, %{name: "Green Tea Extract", barcode: "5000000123456"})
    insert_item(company, %{name: "Unrelated Fizzy Powder"})

    # name substring
    r1 =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items?search=Ashwa")
      |> json_response(200)

    assert Enum.map(r1["items"], & &1["name"]) == ["Ashwagandha KSM-66"]

    # SKU exact-tail
    r2 =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items?search=VIT-C-500")
      |> json_response(200)

    assert Enum.map(r2["items"], & &1["name"]) == ["Vitamin C 500mg"]

    # Barcode
    r3 =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items?search=5000000123456")
      |> json_response(200)

    assert Enum.map(r3["items"], & &1["name"]) == ["Green Tea Extract"]
  end

  test "list_items search ignores blank / whitespace strings", %{conn: conn} do
    %{company: company, raw: raw} = seed_company("Blank Co")
    insert_item(company, %{name: "A"})
    insert_item(company, %{name: "B"})

    for search <- ["", "   ", "\t"] do
      result =
        conn
        |> put_req_header("x-integration-token", raw)
        |> get(~p"/api/integration/items?search=#{search}")
        |> json_response(200)

      assert length(result["items"]) == 2
    end
  end

  test "list_items filters by use_as attribute", %{conn: conn} do
    %{company: company, raw: raw} = seed_company("UseAs Co")

    insert_item(company, %{
      name: "Peppermint Oil",
      attributes: %{"use_as" => "flavouring"}
    })
    insert_item(company, %{
      name: "Beta Carotene",
      attributes: %{"use_as" => "colour"}
    })
    insert_item(company, %{
      name: "Plain Filler",
      attributes: %{}
    })

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items?use_as=flavouring")
      |> json_response(200)

    assert Enum.map(result["items"], & &1["name"]) == ["Peppermint Oil"]
    row = List.first(result["items"])
    assert row["use_as"] == "flavouring"
  end

  test "list_items emits system code even when external_sku is nil", %{conn: conn} do
    # The system-generated code (rendered on the fly from
    # ``Numbering.render``) is what the PSP UI prints as "Code"
    # and what NPD's BOM should show for procurement. Items with
    # no external_sku still get a code — every item has one by
    # default. Load-bearing regression guard: prior to this the
    # integration wire only exposed ``external_sku``, so
    # SKU-less items rendered as ``—`` in NPD downstream.
    %{company: company, raw: raw} = seed_company("Code Co")

    # ``Numbering.render`` returns ``nil`` unless the company
    # has a format configured for the ``item`` entity key —
    # every real company does (seeded on creation); the test
    # fixture builds a bare company, so we mirror the seeded
    # format here.
    company
    |> Ecto.Changeset.change(numbering_formats: %{"item" => %{"prefix" => "MA", "padding" => 5}})
    |> Repo.update!()

    item = insert_item(company, %{name: "Beeswax Yellow", external_sku: nil})

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items")
      |> json_response(200)

    row = Enum.find(result["items"], &(&1["uuid"] == item.uuid))
    assert row["external_sku"] == nil
    assert is_binary(row["code"]) and row["code"] != ""
    assert String.starts_with?(row["code"], "MA")
  end

  test "list_items filters by comma-separated use_as list", %{conn: conn} do
    # NPD's shared multi-picker pushes its whole ``useAsIn`` set
    # through in one query (MCC carrier = Sweetener + Bulking
    # Agent, powder carrier = Carrier + Bulking Agent, etc.).
    # This locks the behaviour so a future refactor can't
    # silently narrow it back to single-value.
    %{company: company, raw: raw} = seed_company("UseAs List Co")

    insert_item(company, %{
      name: "Sucralose",
      attributes: %{"use_as" => "Sweetener"}
    })
    insert_item(company, %{
      name: "MCC 101",
      attributes: %{"use_as" => "Bulking Agent"}
    })
    insert_item(company, %{
      name: "Silica",
      attributes: %{"use_as" => "Anti-caking"}
    })

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items?use_as=Sweetener,Bulking%20Agent")
      |> json_response(200)

    assert Enum.sort(Enum.map(result["items"], & &1["name"])) ==
             ["MCC 101", "Sucralose"]
  end

  test "list_items filters by item_type", %{conn: conn} do
    %{company: company, raw: raw} = seed_company("Types Co")
    insert_item(company, %{name: "raw", item_type: "raw_material"})
    insert_item(company, %{name: "pack", item_type: "packaging"})
    insert_item(company, %{name: "fp", item_type: "finished_product"})

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items?item_types=raw_material,packaging")
      |> json_response(200)

    names = Enum.map(result["items"], & &1["name"]) |> Enum.sort()
    assert names == ["pack", "raw"]
  end

  # ---------------------------------------------------------------------------
  # Pricing
  # ---------------------------------------------------------------------------

  test "list_items surfaces selling_price from active default pricelist", %{conn: conn} do
    %{company: company, raw: raw} = seed_company("Pricing Co")
    item = insert_item(company, %{name: "Priced Item"})
    pricelist = create_default_pricelist(company, "GBP")
    set_price(pricelist, item, "5.25")

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items")
      |> json_response(200)

    row = List.first(result["items"])
    # Decimal serialised as string preserves the DB scale (scale=4 on
    # the pricelist_items.selling_price column). NPD's FE parses to
    # Number on display so the trailing zeros don't affect rendering.
    assert row["selling_price"] == "5.2500"
    assert row["currency_code"] == "GBP"
  end

  test "list_items returns nil price when no active default pricelist", %{conn: conn} do
    %{company: company, raw: raw} = seed_company("NoPricelist Co")
    insert_item(company, %{name: "Unpriced"})

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items")
      |> json_response(200)

    row = List.first(result["items"])
    assert row["selling_price"] == nil
    assert row["currency_code"] == nil
  end

  test "list_items returns nil price for item missing from pricelist", %{conn: conn} do
    %{company: company, raw: raw} = seed_company("PartialPrice Co")
    priced_item = insert_item(company, %{name: "Has Price"})
    _unpriced = insert_item(company, %{name: "No Price"})
    pricelist = create_default_pricelist(company)
    set_price(pricelist, priced_item, "10.00")

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items")
      |> json_response(200)

    by_name = Map.new(result["items"], &{&1["name"], &1})
    assert by_name["Has Price"]["selling_price"] == "10.0000"
    assert by_name["No Price"]["selling_price"] == nil
  end

  # ---------------------------------------------------------------------------
  # Get one
  # ---------------------------------------------------------------------------

  test "get_item returns the same shape as list rows", %{conn: conn} do
    %{company: company, raw: raw} = seed_company("Detail Co")

    item =
      insert_item(company, %{
        name: "Vitamin C 500mg",
        external_sku: "VIT-C-500",
        barcode: "5000000123456",
        description: "Ascorbic acid powder",
        attributes: %{"use_as" => "active"}
      })

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items/#{item.uuid}")
      |> json_response(200)

    row = result["item"]
    assert row["uuid"] == item.uuid
    assert row["name"] == "Vitamin C 500mg"
    assert row["external_sku"] == "VIT-C-500"
    assert row["barcode"] == "5000000123456"
    assert row["description"] == "Ascorbic acid powder"
    assert row["use_as"] == "active"
    assert row["is_active"] == true
    # Full attributes map is exposed so downstream integration
    # consumers (NPD dose-math needs purity / overage /
    # extract_ratio) receive everything the PSP-side scientist
    # recorded, not just the flat ``use_as`` projection.
    assert row["attributes"] == %{"use_as" => "active"}
  end

  test "list_items and get_item expose the full attributes map", %{conn: conn} do
    %{company: company, raw: raw} = seed_company("Attrs Co")

    attrs = %{
      "use_as" => "active",
      "purity" => "0.995",
      "overage" => "0.02",
      "extract_ratio" => "10:1",
      "allergen_flags" => ["soy"]
    }

    item = insert_item(company, %{name: "L-Theanine 200mg", attributes: attrs})

    list_row =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items")
      |> json_response(200)
      |> Map.fetch!("items")
      |> Enum.find(&(&1["uuid"] == item.uuid))

    assert list_row["attributes"] == attrs

    detail =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items/#{item.uuid}")
      |> json_response(200)

    assert detail["item"]["attributes"] == attrs
  end

  test "get_item 404 for cross-company uuid", %{conn: conn} do
    %{raw: raw} = seed_company("Detail Mine Co")
    other = seed_company("Detail Other Co")
    other_item = insert_item(other.company, %{name: "Not yours"})

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/items/#{other_item.uuid}")
      |> json_response(404)

    assert result["error"] == "item_not_found"
  end

  test "get_item 404 for inactive item", %{conn: conn} do
    %{company: company, raw: raw} = seed_company("Detail Inactive Co")
    item = insert_item(company, %{name: "Archived", is_active: false})

    conn
    |> put_req_header("x-integration-token", raw)
    |> get(~p"/api/integration/items/#{item.uuid}")
    |> json_response(404)
  end

  # ---------------------------------------------------------------------------
  # Batch pricing helper — direct unit test for the context boundary
  # ---------------------------------------------------------------------------

  test "default_list_prices_for_items batches lookups by item id" do
    %{company: company} = seed_company("Batch Co")
    a = insert_item(company, %{name: "A"})
    b = insert_item(company, %{name: "B"})
    c = insert_item(company, %{name: "C"})
    pricelist = create_default_pricelist(company)
    set_price(pricelist, a, "1.00")
    set_price(pricelist, b, "2.00")
    # c has no row → absent from the result

    result =
      Pricelists.default_list_prices_for_items(company.id, [a.id, b.id, c.id])

    assert Decimal.equal?(Map.get(result, a.id).selling_price, Decimal.new("1.00"))
    assert Decimal.equal?(Map.get(result, b.id).selling_price, Decimal.new("2.00"))
    refute Map.has_key?(result, c.id)
  end

  test "default_list_prices_for_items empty when no default pricelist" do
    %{company: company} = seed_company("Empty Batch Co")
    item = insert_item(company, %{name: "X"})

    result = Pricelists.default_list_prices_for_items(company.id, [item.id])
    assert result == %{}
  end
end
