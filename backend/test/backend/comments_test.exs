defmodule Backend.CommentsTest do
  @moduledoc """
  Unit tests for the polymorphic comments boundary. Verifies:

    * basic create / list / update / delete flow
    * RBAC inheritance from the entity's edit permission
    * author-only edit rule
    * soft-delete preserves the row + author
    * cross-tenant lookups don't leak

  These tests bypass the HTTP layer and call `Backend.Comments`
  directly. Channel + controller behaviour is exercised separately.
  """

  use Backend.DataCase, async: true

  alias Backend.Companies.Company
  alias Backend.Comments
  alias Backend.Repo
  alias Backend.Vendors
  alias Backend.Accounts.User

  setup do
    company = insert_company!()
    other_company = insert_company!("Other Co")

    author = insert_user!(company.id, "author@vitamanufacture.co.uk", ["vendors.edit"])
    editor = insert_user!(company.id, "editor@vitamanufacture.co.uk", ["vendors.edit"])
    viewer = insert_user!(company.id, "viewer@vitamanufacture.co.uk", ["vendors.view"])
    admin = insert_user!(company.id, "admin@vitamanufacture.co.uk", [], is_admin: true)
    other_co_user = insert_user!(other_company.id, "outsider@vitamanufacture.co.uk", ["vendors.edit"])

    {:ok, vendor} =
      Vendors.create(author, company.id, %{name: "Acme Supplements", currency_code: "GBP"})

    %{
      company: company,
      other_company: other_company,
      author: author,
      editor: editor,
      viewer: viewer,
      admin: admin,
      other_co_user: other_co_user,
      vendor: vendor
    }
  end

  describe "can_comment_on?/2" do
    test "editor can post on vendor", %{editor: editor} do
      assert Comments.can_comment_on?(editor, "vendor")
    end

    test "viewer cannot post on vendor", %{viewer: viewer} do
      refute Comments.can_comment_on?(viewer, "vendor")
    end

    test "admin can post on any supported entity", %{admin: admin} do
      assert Comments.can_comment_on?(admin, "vendor")
      assert Comments.can_comment_on?(admin, "purchase_order")
      assert Comments.can_comment_on?(admin, "stock_lot")
    end

    test "unknown entity type fails closed", %{editor: editor} do
      refute Comments.can_comment_on?(editor, "spec_sheet")
    end
  end

  describe "create_comment/4" do
    test "writes a row with author + body", %{author: author, vendor: vendor} do
      {:ok, c} =
        Comments.create_comment(author, "vendor", vendor.id, %{body: "Approved batch 12 today."})

      assert c.entity_type == "vendor"
      assert c.entity_id == vendor.id
      assert c.body == "Approved batch 12 today."
      assert c.author_id == author.id
      assert c.company_id == author.company_id
      assert c.visibility == "internal"
    end

    test "rejects empty body", %{author: author, vendor: vendor} do
      assert {:error, %Ecto.Changeset{}} =
               Comments.create_comment(author, "vendor", vendor.id, %{body: "   "})
    end

    test "rejects oversized body", %{author: author, vendor: vendor} do
      huge = String.duplicate("a", 4_001)

      assert {:error, %Ecto.Changeset{}} =
               Comments.create_comment(author, "vendor", vendor.id, %{body: huge})
    end

    test "rejects unknown entity type", %{author: author} do
      assert {:error, :unknown_entity_type} =
               Comments.create_comment(author, "spec_sheet", 1, %{body: "Hi"})
    end
  end

  describe "list_for/4" do
    test "returns the timeline scoped to the entity", %{
      author: author,
      vendor: vendor,
      company: company
    } do
      {:ok, _} = Comments.create_comment(author, "vendor", vendor.id, %{body: "First"})
      {:ok, _} = Comments.create_comment(author, "vendor", vendor.id, %{body: "Second"})

      items = Comments.list_for(company.id, "vendor", vendor.id)
      assert length(items) == 2
      assert Enum.map(items, & &1.body) == ["First", "Second"]
    end

    test "cross-tenant query returns nothing", %{
      author: author,
      vendor: vendor,
      other_company: other_company
    } do
      {:ok, _} = Comments.create_comment(author, "vendor", vendor.id, %{body: "Secret"})

      assert Comments.list_for(other_company.id, "vendor", vendor.id) == []
    end

    test "preloads the author", %{author: author, vendor: vendor, company: company} do
      {:ok, _} = Comments.create_comment(author, "vendor", vendor.id, %{body: "hi"})
      [item] = Comments.list_for(company.id, "vendor", vendor.id)
      assert %User{} = item.author
      assert item.author.id == author.id
    end
  end

  describe "update_comment/3" do
    test "author can edit + stamps edited_at", %{author: author, vendor: vendor} do
      {:ok, c} = Comments.create_comment(author, "vendor", vendor.id, %{body: "original"})

      {:ok, updated} = Comments.update_comment(author, c, %{body: "revised"})

      assert updated.body == "revised"
      assert updated.edited_at
    end

    test "non-author refused", %{author: author, editor: editor, vendor: vendor} do
      {:ok, c} = Comments.create_comment(author, "vendor", vendor.id, %{body: "mine"})

      assert {:error, :forbidden} =
               Comments.update_comment(editor, c, %{body: "vandalism"})
    end

    test "no stamp when body unchanged", %{author: author, vendor: vendor} do
      {:ok, c} = Comments.create_comment(author, "vendor", vendor.id, %{body: "same"})

      {:ok, updated} = Comments.update_comment(author, c, %{body: "same"})

      refute updated.edited_at
    end
  end

  describe "delete_comment/2" do
    test "author can delete — body becomes marker, row stays", %{
      author: author,
      vendor: vendor,
      company: company
    } do
      {:ok, c} = Comments.create_comment(author, "vendor", vendor.id, %{body: "draft"})

      {:ok, deleted} = Comments.delete_comment(author, c)

      assert deleted.body == "[deleted]"
      assert Repo.get(Backend.Comments.Comment, c.id)

      items = Comments.list_for(company.id, "vendor", vendor.id)
      assert length(items) == 1
      assert hd(items).body == "[deleted]"
      # Authorship is preserved so the audit trail stays readable.
      assert hd(items).author_id == author.id
    end

    test "admin can delete someone else's comment", %{
      author: author,
      admin: admin,
      vendor: vendor
    } do
      {:ok, c} = Comments.create_comment(author, "vendor", vendor.id, %{body: "report"})

      assert {:ok, deleted} = Comments.delete_comment(admin, c)
      assert deleted.body == "[deleted]"
    end

    test "non-author non-admin refused", %{
      author: author,
      editor: editor,
      vendor: vendor
    } do
      {:ok, c} = Comments.create_comment(author, "vendor", vendor.id, %{body: "report"})

      assert {:error, :forbidden} = Comments.delete_comment(editor, c)
    end
  end

  describe "get_for_company/2" do
    test "scope blocks cross-tenant lookup", %{
      author: author,
      vendor: vendor,
      other_company: other_company
    } do
      {:ok, c} = Comments.create_comment(author, "vendor", vendor.id, %{body: "x"})

      assert Comments.get_for_company(other_company.id, c.uuid) == nil
      assert %Backend.Comments.Comment{} = Comments.get_for_company(author.company_id, c.uuid)
    end
  end

  # ----- helpers --------------------------------------------------

  defp insert_company!(name \\ "Test Co") do
    {:ok, c} =
      %Company{}
      |> Company.bootstrap_changeset(%{name: name})
      |> Repo.insert()

    c
  end

  defp insert_user!(company_id, email, permissions, opts \\ []) do
    is_admin = Keyword.get(opts, :is_admin, false)

    attrs = %{
      "email" => email,
      "name" => email,
      "password" => "correct-horse-battery-staple"
    }

    {:ok, user} =
      %User{}
      |> User.registration_changeset(attrs)
      |> Ecto.Changeset.put_change(:company_id, company_id)
      |> Ecto.Changeset.put_change(:permissions, permissions)
      |> Ecto.Changeset.put_change(:is_admin, is_admin)
      |> Repo.insert()

    user
  end
end
