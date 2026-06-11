defmodule Backend.GoodsIn.MobileIncomingTest do
  @moduledoc """
  `MobileIncoming.list_expected/2` — the projection feeding the tablet
  landing page at /m/incoming. Hits three things:

    * Window filter — POs outside today + N drop off the list.
    * Status filter — only ordered / partially_received show.
    * Open-inspection join — the most-recent draft / submitted
      inspection per PO is attached (so the operator can jump back
      into the one they half-filled yesterday).
  """

  use Backend.DataCase, async: false

  alias Backend.Companies.Company
  alias Backend.GoodsIn.{Inspection, MobileIncoming}
  alias Backend.Items.Item
  alias Backend.Purchasing.{PurchaseOrder, PurchaseOrderLine}
  alias Backend.Repo
  alias Backend.Vendors.Vendor
  alias Backend.Warehouses.Warehouse

  # ----- fixtures --------------------------------------------------

  defp dec(v), do: Decimal.new(to_string(v))

  defp company_fixture do
    Repo.insert!(%Company{name: "Mobile-Incoming Co"})
  end

  defp warehouse_fixture(company, name) do
    Repo.insert!(%Warehouse{
      company_id: company.id,
      name: name,
      is_active: true
    })
  end

  defp vendor_fixture(company, name \\ "Acme") do
    Repo.insert!(%Vendor{
      company_id: company.id,
      name: name,
      currency_code: "GBP",
      approval_status: "approved",
      is_active: true
    })
  end

  defp item_fixture(company, name \\ "Vitamin D3") do
    Repo.insert!(%Item{
      company_id: company.id,
      name: name,
      item_type: "raw_material",
      is_active: true
    })
  end

  defp insert_po(company, vendor, attrs) do
    base = %{
      company_id: company.id,
      vendor_id: vendor.id,
      currency_code: "GBP"
    }

    Repo.insert!(struct(%PurchaseOrder{}, Map.merge(base, attrs)))
  end

  defp insert_line(po, item, qty_ordered, qty_received \\ "0") do
    Repo.insert!(%PurchaseOrderLine{
      purchase_order_id: po.id,
      company_id: po.company_id,
      item_id: item.id,
      qty_ordered: dec(qty_ordered),
      qty_received: dec(qty_received),
      unit_price: dec("1.00"),
      line_subtotal: dec(qty_ordered)
    })
  end

  defp insert_inspection(company, po, status, attrs \\ %{}) do
    base = %{
      company_id: company.id,
      purchase_order_id: po.id,
      status: status,
      delivery_date: Date.utc_today()
    }

    Repo.insert!(struct(%Inspection{}, Map.merge(base, attrs)))
  end

  # ----- list_expected/2 -------------------------------------------

  describe "list_expected/2 — window + status filtering" do
    test "today / tomorrow / next month — only the first two land in the default 7-day window" do
      company = company_fixture()
      vendor = vendor_fixture(company)
      item = item_fixture(company)
      today = Date.utc_today()

      po_today =
        insert_po(company, vendor, %{
          status: "ordered",
          expected_delivery_date: today
        })

      po_tomorrow =
        insert_po(company, vendor, %{
          status: "partially_received",
          expected_delivery_date: Date.add(today, 1)
        })

      _po_next_month =
        insert_po(company, vendor, %{
          status: "ordered",
          expected_delivery_date: Date.add(today, 30)
        })

      insert_line(po_today, item, "100")
      insert_line(po_tomorrow, item, "50", "10")

      %{items: items, by_day: by_day} =
        MobileIncoming.list_expected(company.id, today: today)

      uuids = Enum.map(items, fn {po, _} -> po.uuid end)
      assert po_today.uuid in uuids
      assert po_tomorrow.uuid in uuids
      assert length(items) == 2

      # by_day counts grouped by expected_delivery_date
      assert Map.get(by_day, Date.to_iso8601(today)) == 1
      assert Map.get(by_day, Date.to_iso8601(Date.add(today, 1))) == 1
      refute Map.has_key?(by_day, Date.to_iso8601(Date.add(today, 30)))
    end

    test "draft + approved POs are excluded — only ordered + partially_received show" do
      company = company_fixture()
      vendor = vendor_fixture(company)
      item = item_fixture(company)
      today = Date.utc_today()

      draft_po =
        insert_po(company, vendor, %{
          status: "draft",
          expected_delivery_date: today
        })

      approved_po =
        insert_po(company, vendor, %{
          status: "approved",
          expected_delivery_date: today
        })

      received_po =
        insert_po(company, vendor, %{
          status: "received",
          expected_delivery_date: today
        })

      ordered_po =
        insert_po(company, vendor, %{
          status: "ordered",
          expected_delivery_date: today
        })

      Enum.each([draft_po, approved_po, received_po, ordered_po], fn po ->
        insert_line(po, item, "10")
      end)

      %{items: items} = MobileIncoming.list_expected(company.id, today: today)
      uuids = Enum.map(items, fn {po, _} -> po.uuid end)

      assert uuids == [ordered_po.uuid]
    end

    test "warehouse_id filter narrows the list to the given site" do
      company = company_fixture()
      vendor = vendor_fixture(company)
      item = item_fixture(company)
      today = Date.utc_today()
      wh_a = warehouse_fixture(company, "Site A")
      wh_b = warehouse_fixture(company, "Site B")

      po_a =
        insert_po(company, vendor, %{
          status: "ordered",
          expected_delivery_date: today,
          default_warehouse_id: wh_a.id
        })

      po_b =
        insert_po(company, vendor, %{
          status: "ordered",
          expected_delivery_date: today,
          default_warehouse_id: wh_b.id
        })

      insert_line(po_a, item, "10")
      insert_line(po_b, item, "10")

      %{items: a_items} =
        MobileIncoming.list_expected(company.id,
          today: today,
          warehouse_id: wh_a.id
        )

      a_uuids = Enum.map(a_items, fn {po, _} -> po.uuid end)
      assert a_uuids == [po_a.uuid]

      %{items: b_items} =
        MobileIncoming.list_expected(company.id,
          today: today,
          warehouse_id: wh_b.id
        )

      b_uuids = Enum.map(b_items, fn {po, _} -> po.uuid end)
      assert b_uuids == [po_b.uuid]
    end

    test "overdue POs included by default, excluded when :include_overdue? is false" do
      company = company_fixture()
      vendor = vendor_fixture(company)
      item = item_fixture(company)
      today = Date.utc_today()
      yesterday = Date.add(today, -1)

      overdue =
        insert_po(company, vendor, %{
          status: "ordered",
          expected_delivery_date: yesterday
        })

      insert_line(overdue, item, "10")

      %{items: with_overdue} =
        MobileIncoming.list_expected(company.id, today: today)

      assert Enum.any?(with_overdue, fn {po, _} -> po.uuid == overdue.uuid end)

      %{items: without_overdue} =
        MobileIncoming.list_expected(company.id,
          today: today,
          include_overdue?: false
        )

      refute Enum.any?(without_overdue, fn {po, _} -> po.uuid == overdue.uuid end)
    end
  end

  describe "list_expected/2 — open-inspection join" do
    test "PO with a draft inspection surfaces it on the row" do
      company = company_fixture()
      vendor = vendor_fixture(company)
      item = item_fixture(company)
      today = Date.utc_today()

      po =
        insert_po(company, vendor, %{
          status: "ordered",
          expected_delivery_date: today
        })

      insert_line(po, item, "10")

      draft = insert_inspection(company, po, "draft")

      %{items: [{result_po, open_inspection}]} =
        MobileIncoming.list_expected(company.id, today: today)

      assert result_po.uuid == po.uuid
      assert %Inspection{} = open_inspection
      assert open_inspection.id == draft.id
      assert open_inspection.status == "draft"
    end

    test "PO with only terminal inspections (approved/rejected/hold) gets nil" do
      company = company_fixture()
      vendor = vendor_fixture(company)
      item = item_fixture(company)
      today = Date.utc_today()

      po =
        insert_po(company, vendor, %{
          status: "partially_received",
          expected_delivery_date: today
        })

      insert_line(po, item, "20", "5")

      insert_inspection(company, po, "approved")
      insert_inspection(company, po, "rejected")
      insert_inspection(company, po, "hold")

      %{items: [{_po, open_inspection}]} =
        MobileIncoming.list_expected(company.id, today: today)

      assert is_nil(open_inspection)
    end

    test "most-recent open inspection wins when there are several" do
      company = company_fixture()
      vendor = vendor_fixture(company)
      item = item_fixture(company)
      today = Date.utc_today()

      po =
        insert_po(company, vendor, %{
          status: "ordered",
          expected_delivery_date: today
        })

      insert_line(po, item, "10")

      _older = insert_inspection(company, po, "draft")
      # Force a strictly-later inserted_at so the sort is deterministic
      # even on fast test machines where two rows can share a timestamp.
      Process.sleep(1100)
      newer = insert_inspection(company, po, "submitted")

      %{items: [{_po, open_inspection}]} =
        MobileIncoming.list_expected(company.id, today: today)

      assert open_inspection.id == newer.id
      assert open_inspection.status == "submitted"
    end
  end

  describe "list_expected/2 — input parsing" do
    test "days param widens the window when passed as a string" do
      company = company_fixture()
      vendor = vendor_fixture(company)
      item = item_fixture(company)
      today = Date.utc_today()

      far_po =
        insert_po(company, vendor, %{
          status: "ordered",
          expected_delivery_date: Date.add(today, 20)
        })

      insert_line(far_po, item, "10")

      %{items: default_items} =
        MobileIncoming.list_expected(company.id, today: today)

      refute Enum.any?(default_items, fn {po, _} -> po.uuid == far_po.uuid end)

      %{items: widened_items} =
        MobileIncoming.list_expected(company.id, today: today, window_days: "30")

      assert Enum.any?(widened_items, fn {po, _} -> po.uuid == far_po.uuid end)
    end

    test "garbage warehouse_id falls back to no warehouse filter" do
      company = company_fixture()
      vendor = vendor_fixture(company)
      item = item_fixture(company)
      today = Date.utc_today()

      po =
        insert_po(company, vendor, %{
          status: "ordered",
          expected_delivery_date: today
        })

      insert_line(po, item, "10")

      %{items: items} =
        MobileIncoming.list_expected(company.id,
          today: today,
          warehouse_id: "not-a-number"
        )

      assert length(items) == 1
    end
  end
end
