defmodule BackendWeb.CommentsControllerTest do
  @moduledoc """
  HTTP-layer tests for the polymorphic comments controller. Exercises
  the vendor mount end-to-end; the PO + stock-lot mounts share the
  same controller so they're covered transitively (separate routes,
  identical logic).
  """

  use BackendWeb.ConnCase, async: true

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Repo
  alias Backend.Vendors

  setup %{conn: conn} do
    company = insert_company!("Test Co")
    editor = insert_user!(company.id, "editor@vitamanufacture.co.uk", ["vendors.view", "vendors.edit"])
    viewer = insert_user!(company.id, "viewer@vitamanufacture.co.uk", ["vendors.view"])

    {:ok, vendor} =
      Vendors.create(editor, company.id, %{name: "Acme Supplements", currency_code: "GBP"})

    %{
      conn: conn,
      company: company,
      editor: editor,
      viewer: viewer,
      vendor: vendor
    }
  end

  describe "GET /api/vendors/:uuid/comments" do
    test "viewer reads empty timeline", %{conn: conn, viewer: viewer, vendor: vendor} do
      conn =
        conn
        |> auth(viewer)
        |> get("/api/vendors/#{vendor.uuid}/comments")

      assert %{"items" => []} = json_response(conn, 200)
    end

    test "missing view perm → 403", %{conn: conn, company: company, vendor: vendor} do
      outsider = insert_user!(company.id, "outsider@vitamanufacture.co.uk", [])

      conn =
        conn
        |> auth(outsider)
        |> get("/api/vendors/#{vendor.uuid}/comments")

      assert json_response(conn, 403)["error"] == "missing_permission"
    end

    test "unknown vendor → 404", %{conn: conn, viewer: viewer} do
      conn =
        conn
        |> auth(viewer)
        |> get("/api/vendors/00000000-0000-0000-0000-000000000000/comments")

      assert json_response(conn, 404)
    end
  end

  describe "POST /api/vendors/:uuid/comments" do
    test "editor posts a comment", %{conn: conn, editor: editor, vendor: vendor} do
      conn =
        conn
        |> auth(editor)
        |> post("/api/vendors/#{vendor.uuid}/comments", %{body: "Approved batch 12 today."})

      assert %{"comment" => %{"body" => "Approved batch 12 today.", "author" => %{"id" => _}}} =
               json_response(conn, 201)
    end

    test "viewer (no vendors.edit) refused", %{conn: conn, viewer: viewer, vendor: vendor} do
      conn =
        conn
        |> auth(viewer)
        |> post("/api/vendors/#{vendor.uuid}/comments", %{body: "Trying to write."})

      assert json_response(conn, 403)["error"] == "missing_permission"
    end

    test "empty body → 422", %{conn: conn, editor: editor, vendor: vendor} do
      conn =
        conn
        |> auth(editor)
        |> post("/api/vendors/#{vendor.uuid}/comments", %{body: "  "})

      assert json_response(conn, 422)["error"] == "validation_failed"
    end
  end

  describe "PATCH /api/vendors/:uuid/comments/:comment_uuid" do
    test "author edits own comment", %{conn: conn, editor: editor, vendor: vendor} do
      conn =
        conn
        |> auth(editor)
        |> post("/api/vendors/#{vendor.uuid}/comments", %{body: "first"})

      %{"comment" => %{"uuid" => c_uuid}} = json_response(conn, 201)

      conn =
        conn
        |> recycle()
        |> auth(editor)
        |> patch("/api/vendors/#{vendor.uuid}/comments/#{c_uuid}", %{body: "revised"})

      assert %{"comment" => %{"body" => "revised", "edited_at" => edited}} =
               json_response(conn, 200)

      assert is_binary(edited)
    end

    test "non-author refused 403", %{
      conn: conn,
      editor: editor,
      company: company,
      vendor: vendor
    } do
      conn =
        conn
        |> auth(editor)
        |> post("/api/vendors/#{vendor.uuid}/comments", %{body: "mine"})

      %{"comment" => %{"uuid" => c_uuid}} = json_response(conn, 201)

      another =
        insert_user!(company.id, "second@vitamanufacture.co.uk", ["vendors.view", "vendors.edit"])

      conn =
        conn
        |> recycle()
        |> auth(another)
        |> patch("/api/vendors/#{vendor.uuid}/comments/#{c_uuid}", %{body: "edit"})

      assert json_response(conn, 403)["error"] == "comment_edit_forbidden"
    end
  end

  describe "DELETE /api/vendors/:uuid/comments/:comment_uuid" do
    test "author soft-deletes — row stays, body replaced", %{
      conn: conn,
      editor: editor,
      vendor: vendor
    } do
      conn =
        conn
        |> auth(editor)
        |> post("/api/vendors/#{vendor.uuid}/comments", %{body: "draft"})

      %{"comment" => %{"uuid" => c_uuid}} = json_response(conn, 201)

      conn =
        conn
        |> recycle()
        |> auth(editor)
        |> delete("/api/vendors/#{vendor.uuid}/comments/#{c_uuid}")

      assert %{"comment" => %{"body" => "[deleted]"}} = json_response(conn, 200)

      # Listing still shows the row so the audit trail stays readable.
      conn =
        conn
        |> recycle()
        |> auth(editor)
        |> get("/api/vendors/#{vendor.uuid}/comments")

      assert %{"items" => [%{"body" => "[deleted]"}]} = json_response(conn, 200)
    end
  end

  # ----- helpers --------------------------------------------------

  defp auth(conn, %User{} = user) do
    token = Phoenix.Token.sign(BackendWeb.Endpoint, "psp user auth", user.id)
    Plug.Conn.put_req_header(conn, "authorization", "Bearer " <> token)
  end

  defp insert_company!(name) do
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
