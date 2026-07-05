defmodule Security.FormChannelSecurityTest do
  @moduledoc """
  Cross-tenant `form:<resource>:<uuid>` join must be refused (C4).

  Before the Tenancy gate, holding `vendors.edit` in tenant A was
  enough to join `form:vendor:<uuid-from-tenant-B>` and watch every
  `field:change` broadcast — an operator's keystrokes leaking to a
  competitor. This suite drives the vulnerable path and confirms
  the channel now refuses.
  """

  use Backend.SecurityCase, async: false

  import Phoenix.ChannelTest

  alias BackendWeb.{FormChannel, UserSocket}

  @endpoint BackendWeb.Endpoint

  setup do
    tenant_a = insert_company!("Tenant A — form-channel")
    tenant_b = insert_company!("Tenant B — form-channel")

    user_a = insert_user!(tenant_a.id, "form-a@vitamanufacture.co.uk", ["vendors.edit"])
    user_b = insert_user!(tenant_b.id, "form-b@vitamanufacture.co.uk", ["vendors.edit"])

    vendor_a = insert_vendor!(tenant_a.id, user_a, "Home Co")
    vendor_b = insert_vendor!(tenant_b.id, user_b, "Foreign Co")

    %{
      user_a: user_a,
      user_b: user_b,
      vendor_a: vendor_a,
      vendor_b: vendor_b
    }
  end

  describe "form:vendor:<uuid> join" do
    test "same-tenant editor is accepted", %{user_a: user, vendor_a: vendor} do
      {:ok, _reply, socket} =
        user
        |> socket_for()
        |> subscribe_and_join(FormChannel, "form:vendor:#{vendor.uuid}")

      assert socket.assigns.form_resource == "vendor"
    end

    test "cross-tenant editor is refused with `forbidden`", %{
      user_a: user_a,
      vendor_b: foreign_vendor
    } do
      assert {:error, %{reason: "forbidden"}} =
               user_a
               |> socket_for()
               |> subscribe_and_join(FormChannel, "form:vendor:#{foreign_vendor.uuid}")
    end

    test "draft (`new`) room is accepted for any editor", %{user_a: user} do
      {:ok, _reply, socket} =
        user
        |> socket_for()
        |> subscribe_and_join(FormChannel, "form:vendor:new")

      assert socket.assigns.form_resource == "vendor"
    end

    test "made-up vendor uuid is refused as `forbidden` (not `bad_topic`)",
         %{user_a: user} do
      # The topic itself parses fine — the failure mode is the
      # tenant check, not the topic shape. Assert the specific
      # error so the two failure classes stay distinguishable.
      random_uuid = Ecto.UUID.generate()

      assert {:error, %{reason: "forbidden"}} =
               user
               |> socket_for()
               |> subscribe_and_join(FormChannel, "form:vendor:#{random_uuid}")
    end

    test "malformed topic returns `bad_topic`, not `forbidden`", %{user_a: user} do
      assert {:error, %{reason: "bad_topic"}} =
               user
               |> socket_for()
               |> subscribe_and_join(FormChannel, "form:vendor")
    end

    test "unknown resource type is refused via `can_edit_resource?`",
         %{user_a: user} do
      # Not the tenant gate — this is the RBAC allowlist. Included
      # so a rename in `can_edit_resource?/2` doesn't silently open
      # a new topic namespace.
      assert {:error, %{reason: "forbidden"}} =
               user
               |> socket_for()
               |> subscribe_and_join(FormChannel, "form:not-a-real-thing:new")
    end
  end

  describe "form:company:<id> join" do
    test "own company singleton is accepted", %{user_a: user} do
      # `company.edit` isn't granted to this test user — grant on
      # the fly so the RBAC gate passes and only the tenant gate is
      # under test.
      user = grant_permission(user, "company.edit")

      assert {:ok, _reply, _socket} =
               user
               |> socket_for()
               |> subscribe_and_join(FormChannel, "form:company:#{user.company_id}")
    end

    test "another tenant's company id is refused", %{user_a: user_a, user_b: user_b} do
      user_a = grant_permission(user_a, "company.edit")

      assert {:error, %{reason: "forbidden"}} =
               user_a
               |> socket_for()
               |> subscribe_and_join(FormChannel, "form:company:#{user_b.company_id}")
    end
  end

  # ----- helpers ---------------------------------------------------

  defp socket_for(user) do
    socket(UserSocket, "users_socket:#{user.id}", %{current_user: user})
  end

  defp grant_permission(user, perm) do
    updated =
      user
      |> Ecto.Changeset.change(permissions: (user.permissions || []) ++ [perm])
      |> Backend.Repo.update!()

    updated
  end
end
