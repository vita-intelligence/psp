defmodule Backend.GoodsInTest do
  @moduledoc """
  File-attachment tests for `Backend.GoodsIn` — operator photos +
  supplier paperwork captured at the dock. Sign-off + lot fan-out
  logic is covered by `client/tests/e2e/26-goods-in-flow.spec.ts`
  end-to-end; this suite locks in the file-upload contract that
  ships alongside the mobile wizard.
  """

  use Backend.DataCase, async: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.GoodsIn
  alias Backend.GoodsIn.{Inspection, InspectionFile}
  alias Backend.Items.Item
  alias Backend.Purchasing.PurchaseOrder
  alias Backend.Repo
  alias Backend.Vendors.Vendor

  # ----- fixtures --------------------------------------------------

  defp company_fixture(name \\ "GoodsIn-Test Co") do
    Repo.insert!(%Company{name: name})
  end

  defp user_fixture(company) do
    n = System.unique_integer([:positive])

    Repo.insert!(%User{
      company_id: company.id,
      email: "inspector-#{n}@example.com",
      name: "Inspector #{n}",
      hashed_password: "$2b$12$placeholder",
      is_active: true,
      confirmed_at: DateTime.utc_now() |> DateTime.truncate(:second)
    })
  end

  defp vendor_fixture(company) do
    Repo.insert!(%Vendor{
      company_id: company.id,
      name: "Acme",
      currency_code: "GBP",
      approval_status: "approved",
      is_active: true
    })
  end

  defp item_fixture(company) do
    Repo.insert!(%Item{
      company_id: company.id,
      name: "Widget",
      item_type: "raw_material"
    })
  end

  defp insert_po(company, vendor) do
    Repo.insert!(%PurchaseOrder{
      company_id: company.id,
      vendor_id: vendor.id,
      currency_code: "GBP",
      status: "ordered"
    })
  end

  defp insert_inspection(company, po, actor, status \\ "draft") do
    Repo.insert!(%Inspection{
      company_id: company.id,
      purchase_order_id: po.id,
      delivery_date: ~D[2026-06-11],
      status: status,
      created_by_id: actor.id,
      updated_by_id: actor.id
    })
  end

  defp setup_world(_ctx) do
    company = company_fixture()
    vendor = vendor_fixture(company)
    _item = item_fixture(company)
    actor = user_fixture(company)
    po = insert_po(company, vendor)
    inspection = insert_inspection(company, po, actor)

    {:ok, company: company, vendor: vendor, actor: actor, po: po, inspection: inspection}
  end

  defp upload_fixture(bytes, opts \\ []) do
    filename = Keyword.get(opts, :filename, "photo.jpg")
    mime = Keyword.get(opts, :mime, "image/jpeg")
    tmp = Path.join(System.tmp_dir!(), "goods_in_test_#{System.unique_integer([:positive])}")
    File.write!(tmp, bytes)

    %Plug.Upload{
      path: tmp,
      filename: filename,
      content_type: mime
    }
  end

  # ----- upload_file/4 --------------------------------------------

  describe "upload_file/4 — happy path" do
    setup :setup_world

    test "inserts row + blob lands on disk", %{
      actor: actor,
      inspection: inspection,
      company: company
    } do
      upload = upload_fixture("pretend-jpeg-bytes")

      assert {:ok, %InspectionFile{} = file} =
               GoodsIn.upload_file(actor, inspection, "photo", upload)

      assert file.goods_in_inspection_id == inspection.id
      assert file.company_id == company.id
      assert file.kind == "photo"
      assert file.filename == "photo.jpg"
      assert file.mime == "image/jpeg"
      assert file.byte_size == byte_size("pretend-jpeg-bytes")
      assert file.blob_path =~ ~r{^goods_in_files/}

      # Round-trip: get_file scoped under the parent inspection works.
      assert %InspectionFile{} = GoodsIn.get_file(company.id, inspection.uuid, file.uuid)
    end

    test "submitted inspections still accept file uploads", %{
      actor: actor,
      inspection: inspection
    } do
      submitted = %{inspection | status: "submitted"}
      upload = upload_fixture("more-evidence-bytes")

      assert {:ok, %InspectionFile{}} =
               GoodsIn.upload_file(actor, submitted, "coa", upload)
    end

    test "PDF (application/pdf) accepted", %{actor: actor, inspection: inspection} do
      upload = upload_fixture("%PDF-fake", filename: "coa.pdf", mime: "application/pdf")
      assert {:ok, %InspectionFile{kind: "coa"}} = GoodsIn.upload_file(actor, inspection, "coa", upload)
    end
  end

  describe "upload_file/4 — rejections" do
    setup :setup_world

    test "rejects oversize upload (> 20 MB)", %{actor: actor, inspection: inspection} do
      oversized = String.duplicate("x", 21 * 1024 * 1024)
      upload = upload_fixture(oversized, filename: "huge.jpg")

      assert {:error, {:too_large, bytes}} =
               GoodsIn.upload_file(actor, inspection, "photo", upload)

      assert bytes > 20 * 1024 * 1024
    end

    test "rejects disallowed mime", %{actor: actor, inspection: inspection} do
      upload =
        upload_fixture(
          "pretend-text",
          filename: "notes.txt",
          mime: "text/plain"
        )

      assert {:error, {:invalid_mime, detail}} =
               GoodsIn.upload_file(actor, inspection, "other", upload)

      assert detail =~ "text/plain"
    end

    test "rejects when inspection is already approved (locked)", %{
      actor: actor,
      inspection: inspection
    } do
      locked = %{inspection | status: "approved"}
      upload = upload_fixture("late-photo")

      assert {:error, :not_editable} =
               GoodsIn.upload_file(actor, locked, "photo", upload)
    end

    test "rejects when inspection is rejected (locked)", %{
      actor: actor,
      inspection: inspection
    } do
      locked = %{inspection | status: "rejected"}
      upload = upload_fixture("late-photo")

      assert {:error, :not_editable} =
               GoodsIn.upload_file(actor, locked, "photo", upload)
    end
  end

  # ----- delete_file/3 --------------------------------------------

  describe "delete_file/3" do
    setup :setup_world

    test "removes row + blob (happy path)", %{
      actor: actor,
      inspection: inspection,
      company: company
    } do
      upload = upload_fixture("delete-me-bytes")

      {:ok, file} = GoodsIn.upload_file(actor, inspection, "photo", upload)

      assert {:ok, _deleted} = GoodsIn.delete_file(actor, inspection, file.uuid)
      assert GoodsIn.get_file(company.id, inspection.uuid, file.uuid) == nil
    end

    test "rejects delete when inspection is locked", %{
      actor: actor,
      inspection: inspection
    } do
      upload = upload_fixture("locked-photo")
      {:ok, file} = GoodsIn.upload_file(actor, inspection, "photo", upload)

      locked = %{inspection | status: "approved"}

      assert {:error, :not_editable} =
               GoodsIn.delete_file(actor, locked, file.uuid)
    end

    test "returns :not_found for bogus file uuid", %{
      actor: actor,
      inspection: inspection
    } do
      assert {:error, :not_found} =
               GoodsIn.delete_file(actor, inspection, Ecto.UUID.generate())
    end
  end

  # ----- get_file/3 -----------------------------------------------

  describe "get_file/3 — tenant scoping" do
    setup :setup_world

    test "cross-tenant: file from company A is not visible to company B", %{
      actor: actor,
      inspection: inspection
    } do
      upload = upload_fixture("tenant-a")
      {:ok, file} = GoodsIn.upload_file(actor, inspection, "photo", upload)

      other_company = company_fixture("Other Co")
      assert GoodsIn.get_file(other_company.id, inspection.uuid, file.uuid) == nil
    end

    test "wrong inspection uuid yields nil even on a matching file uuid", %{
      actor: actor,
      inspection: inspection,
      company: company
    } do
      upload = upload_fixture("wrong-parent")
      {:ok, file} = GoodsIn.upload_file(actor, inspection, "photo", upload)

      assert GoodsIn.get_file(company.id, Ecto.UUID.generate(), file.uuid) == nil
    end

    test "bad uuid input returns nil", %{company: company} do
      assert GoodsIn.get_file(company.id, "not-a-uuid", "also-bogus") == nil
    end
  end
end
