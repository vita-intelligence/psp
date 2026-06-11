defmodule Backend.Purchasing.VendorPricesTest do
  use Backend.DataCase, async: false

  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Purchasing.{PurchaseOrder, PurchaseOrderLine, VendorItemPrice, VendorPrices}
  alias Backend.Repo
  alias Backend.Vendors.Vendor

  # ----- fixtures --------------------------------------------------

  defp company_fixture(name \\ "Vendor-Prices Co") do
    Repo.insert!(%Company{name: name})
  end

  defp vendor_fixture(company, name \\ "Acme Supplies") do
    Repo.insert!(%Vendor{
      company_id: company.id,
      name: name,
      currency_code: "GBP",
      approval_status: "approved",
      is_active: true
    })
  end

  defp item_fixture(company, name \\ "Sodium Citrate 1kg") do
    Repo.insert!(%Item{
      company_id: company.id,
      name: name,
      item_type: "raw_material"
    })
  end

  defp po_fixture(company, vendor, currency \\ "GBP") do
    Repo.insert!(%PurchaseOrder{
      company_id: company.id,
      vendor_id: vendor.id,
      currency_code: currency,
      status: "ordered"
    })
  end

  defp line_fixture(po, item, unit_price, qty_received) do
    Repo.insert!(%PurchaseOrderLine{
      purchase_order_id: po.id,
      company_id: po.company_id,
      item_id: item.id,
      qty_ordered: Decimal.new("100"),
      qty_received: Decimal.new(qty_received),
      unit_price: Decimal.new(unit_price),
      line_subtotal: Decimal.new("0")
    })
  end

  defp setup_world(_ctx) do
    company = company_fixture()
    vendor = vendor_fixture(company)
    item = item_fixture(company)
    po = po_fixture(company, vendor)

    {:ok, company: company, vendor: vendor, item: item, po: po}
  end

  describe "upsert_from_receipt/2" do
    setup :setup_world

    test "inserts a new row when no prior history exists", %{
      company: company,
      vendor: vendor,
      item: item,
      po: po
    } do
      line = line_fixture(po, item, "5.0000", "10")

      assert {:ok, %VendorItemPrice{} = row} = VendorPrices.upsert_from_receipt(po, line)
      assert row.company_id == company.id
      assert row.vendor_id == vendor.id
      assert row.item_id == item.id
      assert row.currency_code == "GBP"
      assert Decimal.compare(row.unit_price, Decimal.new("5.0000")) == :eq
      assert Decimal.compare(row.qty_purchased, Decimal.new("10")) == :eq
      assert row.last_po_line_id == line.id
    end

    test "overwrites the cached price with the most recent receipt", %{
      po: po,
      item: item
    } do
      first = line_fixture(po, item, "5.0000", "10")
      assert {:ok, _} = VendorPrices.upsert_from_receipt(po, first)

      second = line_fixture(po, item, "6.5000", "8")
      assert {:ok, %VendorItemPrice{} = row} = VendorPrices.upsert_from_receipt(po, second)

      assert Decimal.compare(row.unit_price, Decimal.new("6.5000")) == :eq
      assert row.last_po_line_id == second.id
      # Rolling total — first 10 + second 8 = 18.
      assert Decimal.compare(row.qty_purchased, Decimal.new("18")) == :eq
    end

    test "idempotent on re-receiving the same line", %{po: po, item: item} do
      line = line_fixture(po, item, "5.0000", "10")
      assert {:ok, row_a} = VendorPrices.upsert_from_receipt(po, line)
      assert {:ok, row_b} = VendorPrices.upsert_from_receipt(po, line)

      assert row_a.id == row_b.id
      assert Decimal.compare(row_b.unit_price, Decimal.new("5.0000")) == :eq
    end

    test "skips when the line has zero unit_price", %{po: po, item: item} do
      line = line_fixture(po, item, "0", "10")
      assert {:ok, :skipped} = VendorPrices.upsert_from_receipt(po, line)
      assert Repo.aggregate(VendorItemPrice, :count, :id) == 0
    end

    test "normalises currency to uppercase", %{company: company, vendor: vendor, item: item} do
      po = po_fixture(company, vendor, "gbp")
      line = line_fixture(po, item, "5.0000", "10")

      assert {:ok, %VendorItemPrice{currency_code: "GBP"}} =
               VendorPrices.upsert_from_receipt(po, line)
    end

    test "separates rows by currency", %{company: company, vendor: vendor, item: item} do
      po_gbp = po_fixture(company, vendor, "GBP")
      po_eur = po_fixture(company, vendor, "EUR")

      assert {:ok, _} =
               VendorPrices.upsert_from_receipt(po_gbp, line_fixture(po_gbp, item, "5.0000", "10"))

      assert {:ok, _} =
               VendorPrices.upsert_from_receipt(po_eur, line_fixture(po_eur, item, "6.0000", "10"))

      assert Repo.aggregate(VendorItemPrice, :count, :id) == 2
    end
  end

  describe "last_paid_for/4" do
    setup :setup_world

    test "returns the cached row's shape", %{
      company: company,
      vendor: vendor,
      item: item,
      po: po
    } do
      line = line_fixture(po, item, "5.0000", "10")
      {:ok, _} = VendorPrices.upsert_from_receipt(po, line)

      assert %{
               unit_price: %Decimal{} = price,
               currency_code: "GBP",
               last_po_line_id: last_id,
               last_paid_at: %DateTime{}
             } = VendorPrices.last_paid_for(company.id, vendor.id, item.id, "GBP")

      assert Decimal.compare(price, Decimal.new("5.0000")) == :eq
      assert last_id == line.id
    end

    test "returns nil when no history exists", %{
      company: company,
      vendor: vendor,
      item: item
    } do
      assert VendorPrices.last_paid_for(company.id, vendor.id, item.id, "GBP") == nil
    end

    test "is case-insensitive on the currency lookup", %{
      company: company,
      vendor: vendor,
      item: item,
      po: po
    } do
      line = line_fixture(po, item, "5.0000", "10")
      {:ok, _} = VendorPrices.upsert_from_receipt(po, line)

      assert %{unit_price: _} =
               VendorPrices.last_paid_for(company.id, vendor.id, item.id, "gbp")
    end
  end

  describe "deviation_check/5" do
    setup :setup_world

    setup %{po: po, item: item} = ctx do
      # Seed cache at £5.00.
      line = line_fixture(po, item, "5.0000", "10")
      {:ok, _} = VendorPrices.upsert_from_receipt(po, line)
      ctx
    end

    test "no_history when the cache is empty", %{company: company, vendor: vendor} do
      other_item = item_fixture(company, "Different Item")

      assert VendorPrices.deviation_check(
               company.id,
               vendor.id,
               other_item.id,
               "GBP",
               "5.0"
             ) == :no_history
    end

    test "within_range at exactly +20% (boundary inclusive)", %{
      company: company,
      vendor: vendor,
      item: item
    } do
      assert VendorPrices.deviation_check(company.id, vendor.id, item.id, "GBP", "6.00") ==
               :within_range
    end

    test "within_range at exactly -20% (boundary inclusive)", %{
      company: company,
      vendor: vendor,
      item: item
    } do
      assert VendorPrices.deviation_check(company.id, vendor.id, item.id, "GBP", "4.00") ==
               :within_range
    end

    test "within_range just inside +20%", %{company: company, vendor: vendor, item: item} do
      assert VendorPrices.deviation_check(company.id, vendor.id, item.id, "GBP", "5.99") ==
               :within_range
    end

    test "warning just outside +20%", %{company: company, vendor: vendor, item: item} do
      assert {:warning, %{last: last, proposed: proposed, pct_change: pct}} =
               VendorPrices.deviation_check(company.id, vendor.id, item.id, "GBP", "6.01")

      assert Decimal.compare(last, Decimal.new("5.0000")) == :eq
      assert Decimal.compare(proposed, Decimal.new("6.01")) == :eq
      assert Decimal.compare(pct, Decimal.new("0")) == :gt
    end

    test "warning just outside -20%", %{company: company, vendor: vendor, item: item} do
      assert {:warning, %{pct_change: pct}} =
               VendorPrices.deviation_check(company.id, vendor.id, item.id, "GBP", "3.99")

      assert Decimal.compare(pct, Decimal.new("0")) == :lt
    end

    test "within_range on exact match", %{company: company, vendor: vendor, item: item} do
      assert VendorPrices.deviation_check(company.id, vendor.id, item.id, "GBP", "5.00") ==
               :within_range
    end

    test "ignores garbage proposed prices", %{company: company, vendor: vendor, item: item} do
      assert VendorPrices.deviation_check(company.id, vendor.id, item.id, "GBP", "nope") ==
               :within_range
    end
  end

  describe "list_for_vendor/2" do
    setup :setup_world

    test "returns rows ordered by most-recent paid date", %{
      company: company,
      vendor: vendor,
      item: item,
      po: po
    } do
      first = line_fixture(po, item, "5.0000", "10")
      {:ok, _} = VendorPrices.upsert_from_receipt(po, first)

      other = item_fixture(company, "Second item")
      second_line = line_fixture(po, other, "10.0000", "2")
      {:ok, _} = VendorPrices.upsert_from_receipt(po, second_line)

      rows = VendorPrices.list_for_vendor(company.id, vendor.id)
      assert length(rows) == 2
      assert [%{item_id: top_item_id} | _] = rows
      # Most-recent first — `other` was upserted second.
      assert top_item_id == other.id
    end
  end
end
