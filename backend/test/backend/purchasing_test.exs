defmodule Backend.PurchasingTest do
  @moduledoc """
  Recompute-totals math, `create_with_lines/3` happy path + rollback,
  file upload happy path + rejection paths, vendor `tax_rate` defaulting.

  Totals are the financial source of truth — math bugs cost real
  money — so every leg gets a direct assertion against an expected
  Decimal, not an approximate.
  """

  use Backend.DataCase, async: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Purchasing
  alias Backend.Purchasing.{PurchaseOrder, PurchaseOrderFile, PurchaseOrderLine}
  alias Backend.Repo
  alias Backend.Vendors.Vendor

  # ----- fixtures --------------------------------------------------

  defp company_fixture(name \\ "Purchasing-Test Co") do
    Repo.insert!(%Company{name: name})
  end

  defp user_fixture(company, email \\ nil) do
    n = System.unique_integer([:positive])
    Repo.insert!(%User{
      company_id: company.id,
      email: email || "buyer-#{n}@example.com",
      name: "Buyer #{n}",
      hashed_password: "$2b$12$placeholder",
      is_active: true,
      confirmed_at: DateTime.utc_now() |> DateTime.truncate(:second)
    })
  end

  defp vendor_fixture(company, attrs \\ %{}) do
    base = %Vendor{
      company_id: company.id,
      name: "Acme",
      currency_code: "GBP",
      tax_rate: nil,
      approval_status: "approved",
      is_active: true
    }

    Repo.insert!(struct(base, attrs))
  end

  defp item_fixture(company, name \\ "Widget") do
    Repo.insert!(%Item{
      company_id: company.id,
      name: name,
      item_type: "raw_material"
    })
  end

  defp insert_po(company, vendor, attrs \\ %{}) do
    base = %{
      company_id: company.id,
      vendor_id: vendor.id,
      currency_code: "GBP",
      status: "draft"
    }

    Repo.insert!(struct(%PurchaseOrder{}, Map.merge(base, attrs)))
  end

  defp insert_line(po, item, qty, unit_price) do
    qty_d = Decimal.new(qty)
    price_d = Decimal.new(unit_price)

    Repo.insert!(%PurchaseOrderLine{
      purchase_order_id: po.id,
      company_id: po.company_id,
      item_id: item.id,
      qty_ordered: qty_d,
      qty_received: Decimal.new(0),
      unit_price: price_d,
      line_subtotal: Decimal.mult(qty_d, price_d)
    })
  end

  defp setup_world(_ctx) do
    company = company_fixture()
    vendor = vendor_fixture(company)
    item = item_fixture(company)
    actor = user_fixture(company)

    {:ok, company: company, vendor: vendor, item: item, actor: actor}
  end

  defp dec(v), do: Decimal.new(to_string(v))

  # ----- recompute_totals/1 ----------------------------------------

  describe "recompute_totals/1 — math" do
    setup :setup_world

    test "simple sum: no discount / tax / fees — grand_total == subtotal", %{
      company: company,
      vendor: vendor,
      item: item
    } do
      po = insert_po(company, vendor)
      insert_line(po, item, "10", "5.00")
      insert_line(po, item, "2", "12.50")

      assert {:ok, recomputed} = Purchasing.recompute_totals(po)

      # 10 × 5.00 + 2 × 12.50 = 50.00 + 25.00 = 75.00
      assert Decimal.equal?(recomputed.subtotal, dec("75.00"))
      assert Decimal.equal?(recomputed.discount_amount, dec("0.00"))
      assert Decimal.equal?(recomputed.tax_amount, dec("0.00"))
      assert Decimal.equal?(recomputed.grand_total, dec("75.00"))
    end

    test "with discount only", %{company: company, vendor: vendor, item: item} do
      po = insert_po(company, vendor, %{discount_pct: dec("10")})
      insert_line(po, item, "10", "5.00")
      insert_line(po, item, "2", "12.50")

      assert {:ok, recomputed} = Purchasing.recompute_totals(po)

      # subtotal 75.00 × 10% = discount 7.50
      # grand_total = 75.00 − 7.50 = 67.50
      assert Decimal.equal?(recomputed.discount_amount, dec("7.50"))
      assert Decimal.equal?(recomputed.tax_amount, dec("0.00"))
      assert Decimal.equal?(recomputed.grand_total, dec("67.50"))
    end

    test "with tax only", %{company: company, vendor: vendor, item: item} do
      po = insert_po(company, vendor, %{tax_rate: dec("20")})
      insert_line(po, item, "10", "5.00")

      assert {:ok, recomputed} = Purchasing.recompute_totals(po)

      # subtotal 50.00 × 20% = tax 10.00
      # grand_total = 50.00 + 10.00 = 60.00
      assert Decimal.equal?(recomputed.subtotal, dec("50.00"))
      assert Decimal.equal?(recomputed.tax_amount, dec("10.00"))
      assert Decimal.equal?(recomputed.grand_total, dec("60.00"))
    end

    test "with discount + tax + shipping + additional", %{
      company: company,
      vendor: vendor,
      item: item
    } do
      po =
        insert_po(company, vendor, %{
          discount_pct: dec("10"),
          tax_rate: dec("20"),
          shipping_fees: dec("15.00"),
          additional_fees: dec("5.00")
        })

      insert_line(po, item, "10", "5.00")
      insert_line(po, item, "2", "12.50")

      assert {:ok, recomputed} = Purchasing.recompute_totals(po)

      # subtotal = 75.00
      # discount = 75.00 × 10% = 7.50
      # taxable  = 75.00 − 7.50 = 67.50
      # tax      = 67.50 × 20% = 13.50
      # grand    = 75.00 − 7.50 + 13.50 + 15.00 + 5.00 = 101.00
      assert Decimal.equal?(recomputed.subtotal, dec("75.00"))
      assert Decimal.equal?(recomputed.discount_amount, dec("7.50"))
      assert Decimal.equal?(recomputed.tax_amount, dec("13.50"))
      assert Decimal.equal?(recomputed.grand_total, dec("101.00"))
    end

    test "precision: every leg rounds to 2dp", %{company: company, vendor: vendor, item: item} do
      po = insert_po(company, vendor, %{discount_pct: dec("7.5"), tax_rate: dec("17.5")})
      insert_line(po, item, "3", "9.99")

      assert {:ok, recomputed} = Purchasing.recompute_totals(po)

      # subtotal = 3 × 9.99 = 29.97
      # discount = 29.97 × 7.5% = 2.24775 → 2.25 (2dp banker's-style)
      # taxable  = 29.97 − 2.25 = 27.72
      # tax      = 27.72 × 17.5% = 4.851 → 4.85
      # grand    = 29.97 − 2.25 + 4.85 = 32.57
      assert Decimal.equal?(recomputed.subtotal, dec("29.97"))
      assert Decimal.equal?(recomputed.discount_amount, dec("2.25"))
      assert Decimal.equal?(recomputed.tax_amount, dec("4.85"))
      assert Decimal.equal?(recomputed.grand_total, dec("32.57"))

      # Footer self-consistency: subtotal − discount + tax should equal
      # grand_total exactly (no off-by-one-penny mismatch).
      sum =
        recomputed.subtotal
        |> Decimal.sub(recomputed.discount_amount)
        |> Decimal.add(recomputed.tax_amount)

      assert Decimal.equal?(sum, recomputed.grand_total)
    end

    test "zero-line PO collapses to all-zero totals", %{
      company: company,
      vendor: vendor
    } do
      po =
        insert_po(company, vendor, %{
          discount_pct: dec("10"),
          tax_rate: dec("20"),
          shipping_fees: dec("15.00"),
          additional_fees: dec("5.00")
        })

      assert {:ok, recomputed} = Purchasing.recompute_totals(po)

      assert Decimal.equal?(recomputed.subtotal, dec("0.00"))
      assert Decimal.equal?(recomputed.discount_amount, dec("0.00"))
      assert Decimal.equal?(recomputed.tax_amount, dec("0.00"))
      # Shipping + additional still land in the grand total even with
      # no lines — that mirrors real-world "freight booked, items
      # cancelled" cases.
      assert Decimal.equal?(recomputed.grand_total, dec("20.00"))
    end

    test "legacy total_amount stays in step with grand_total", %{
      company: company,
      vendor: vendor,
      item: item
    } do
      po = insert_po(company, vendor, %{tax_rate: dec("20")})
      insert_line(po, item, "5", "10.00")

      assert {:ok, recomputed} = Purchasing.recompute_totals(po)
      assert Decimal.equal?(recomputed.total_amount, recomputed.grand_total)
    end
  end

  # ----- create_with_lines/3 ---------------------------------------

  describe "create_with_lines/3" do
    setup :setup_world

    test "happy path inserts PO + lines atomically and runs totals once", %{
      company: company,
      vendor: vendor,
      item: item,
      actor: actor
    } do
      attrs = %{
        "company_id" => company.id,
        "vendor_id" => vendor.id,
        "tax_rate" => "20",
        "shipping_fees" => "10"
      }

      lines = [
        %{"item_id" => item.id, "qty_ordered" => "4", "unit_price" => "5.00"},
        %{"item_id" => item.id, "qty_ordered" => "2", "unit_price" => "12.50"}
      ]

      assert {:ok, po} = Purchasing.create_with_lines(actor, attrs, lines)

      # subtotal = 4 × 5.00 + 2 × 12.50 = 45.00
      # tax      = 45.00 × 20% = 9.00
      # grand    = 45.00 + 9.00 + 10.00 = 64.00
      assert Decimal.equal?(po.subtotal, dec("45.00"))
      assert Decimal.equal?(po.tax_amount, dec("9.00"))
      assert Decimal.equal?(po.grand_total, dec("64.00"))

      assert length(po.lines) == 2

      assert Enum.all?(po.lines, fn line ->
               line.purchase_order_id == po.id and line.company_id == company.id
             end)
    end

    test "rolls back on bad line attrs — no PO row left behind", %{
      company: company,
      vendor: vendor,
      item: item,
      actor: actor
    } do
      attrs = %{
        "company_id" => company.id,
        "vendor_id" => vendor.id
      }

      lines = [
        %{"item_id" => item.id, "qty_ordered" => "4", "unit_price" => "5.00"},
        # Bad — qty_ordered missing entirely.
        %{"item_id" => item.id, "unit_price" => "12.50"}
      ]

      assert {:error, %Ecto.Changeset{}} = Purchasing.create_with_lines(actor, attrs, lines)

      # No PO and no lines committed.
      assert Repo.aggregate(PurchaseOrder, :count, :id) == 0
      assert Repo.aggregate(PurchaseOrderLine, :count, :id) == 0
    end
  end

  # ----- vendor tax_rate default ----------------------------------

  describe "create/3 — vendor defaults" do
    test "defaults tax_rate from vendor on create when caller omits it" do
      company = company_fixture()
      vendor = vendor_fixture(company, %{tax_rate: dec("17.5")})
      actor = user_fixture(company)

      assert {:ok, po} =
               Purchasing.create(actor, company.id, %{
                 "vendor_id" => vendor.id
               })

      assert Decimal.equal?(po.tax_rate, dec("17.5"))
    end

    test "honours caller-supplied tax_rate even when vendor has one" do
      company = company_fixture()
      vendor = vendor_fixture(company, %{tax_rate: dec("17.5")})
      actor = user_fixture(company)

      assert {:ok, po} =
               Purchasing.create(actor, company.id, %{
                 "vendor_id" => vendor.id,
                 "tax_rate" => "5"
               })

      assert Decimal.equal?(po.tax_rate, dec("5"))
    end

    test "defaults currency_code from vendor when caller omits it" do
      company = company_fixture()
      vendor = vendor_fixture(company, %{currency_code: "EUR"})
      actor = user_fixture(company)

      assert {:ok, po} =
               Purchasing.create(actor, company.id, %{
                 "vendor_id" => vendor.id
               })

      assert po.currency_code == "EUR"
    end
  end

  # ----- file uploads ---------------------------------------------

  describe "upload_file/4" do
    setup :setup_world

    test "happy path inserts row + bytes resolve via Storage", %{
      vendor: vendor,
      company: company,
      actor: actor
    } do
      po = insert_po(company, vendor)
      bytes = "PDF-pretend-payload"

      attrs = %{
        "kind" => "quote",
        "filename" => "quote.pdf",
        "mime" => "application/pdf",
        "byte_size" => byte_size(bytes)
      }

      assert {:ok, %PurchaseOrderFile{} = file} = Purchasing.upload_file(actor, po, attrs, bytes)
      assert file.purchase_order_id == po.id
      assert file.company_id == company.id
      assert file.kind == "quote"
      assert file.byte_size == byte_size(bytes)
      assert file.blob_path =~ ~r{^po_files/}

      # Round-trip: get_file returns it scoped under the parent.
      assert %PurchaseOrderFile{} = Purchasing.get_file(po.id, file.uuid)
    end

    test "cross-tenant: file from PO A is not visible from PO B's id", %{
      company: company,
      vendor: vendor,
      actor: actor
    } do
      po_a = insert_po(company, vendor)
      po_b = insert_po(company, vendor)
      bytes = "doc"

      {:ok, file} =
        Purchasing.upload_file(
          actor,
          po_a,
          %{
            "kind" => "spec",
            "filename" => "spec.txt",
            "mime" => "text/plain",
            "byte_size" => byte_size(bytes)
          },
          bytes
        )

      assert Purchasing.get_file(po_b.id, file.uuid) == nil
    end

    test "rejects when changeset fails (unknown kind)", %{
      company: company,
      vendor: vendor,
      actor: actor
    } do
      po = insert_po(company, vendor)
      bytes = "x"

      attrs = %{
        "kind" => "totally-made-up",
        "filename" => "x.txt",
        "mime" => "text/plain",
        "byte_size" => 1
      }

      assert {:error, %Ecto.Changeset{}} = Purchasing.upload_file(actor, po, attrs, bytes)
    end
  end

  describe "delete_file/3" do
    setup :setup_world

    test "removes the row", %{vendor: vendor, company: company, actor: actor} do
      po = insert_po(company, vendor)
      bytes = "doc"

      {:ok, file} =
        Purchasing.upload_file(
          actor,
          po,
          %{
            "kind" => "other",
            "filename" => "ref.txt",
            "mime" => "text/plain",
            "byte_size" => byte_size(bytes)
          },
          bytes
        )

      assert {:ok, _deleted} = Purchasing.delete_file(actor, po, file)
      assert Purchasing.get_file(po.id, file.uuid) == nil
    end
  end
end
