defmodule Security.TenancyTest do
  @moduledoc """
  Verifies the tenant-scope oracle that gates realtime channels (C4,
  C5). Every clause of `Backend.Tenancy.resource_in_tenant?/3` gets
  exercised twice — once with a same-tenant record (must accept),
  once with a foreign-tenant record (must refuse).

  Adding a new resource to `form:` topics? Add its clause + this
  test pair. That's the enforcement.
  """

  use Backend.SecurityCase, async: true

  alias Backend.Tenancy

  setup do
    tenant_a = insert_company!("Tenant A")
    tenant_b = insert_company!("Tenant B")

    user_a = insert_user!(tenant_a.id, "actor-a@vitamanufacture.co.uk", ["vendors.edit"])

    %{tenant_a: tenant_a, tenant_b: tenant_b, user_a: user_a}
  end

  describe "resource_in_tenant?/3 — draft short-circuit" do
    test "`new` is always allowed regardless of resource", %{user_a: user} do
      assert Tenancy.resource_in_tenant?(user, "vendor", "new")
      assert Tenancy.resource_in_tenant?(user, "customer", "new")
      assert Tenancy.resource_in_tenant?(user, "purchase-order", "new")
      # Even a nonsense resource passes on `new` — the RBAC gate in
      # `FormChannel.can_edit_resource?/2` catches the resource type.
      assert Tenancy.resource_in_tenant?(user, "anything", "new")
    end
  end

  describe "resource_in_tenant?/3 — vendor" do
    test "same-tenant vendor uuid is accepted", %{user_a: user, tenant_a: tenant_a} do
      vendor = insert_vendor!(tenant_a.id, user, "Home Vendor")

      assert Tenancy.resource_in_tenant?(user, "vendor", vendor.uuid)
    end

    test "cross-tenant vendor uuid is refused", %{user_a: user, tenant_b: tenant_b} do
      # Seed a vendor in tenant B with a tenant-B actor.
      user_b = insert_user!(tenant_b.id, "actor-b@vitamanufacture.co.uk", ["vendors.edit"])
      foreign_vendor = insert_vendor!(tenant_b.id, user_b, "Foreign Vendor")

      refute Tenancy.resource_in_tenant?(user, "vendor", foreign_vendor.uuid)
    end

    test "made-up uuid is refused", %{user_a: user} do
      refute Tenancy.resource_in_tenant?(user, "vendor", Ecto.UUID.generate())
    end

    test "malformed uuid is refused", %{user_a: user} do
      refute Tenancy.resource_in_tenant?(user, "vendor", "not-a-uuid")
    end
  end

  describe "resource_in_tenant?/3 — company singleton" do
    test "own company id passes", %{user_a: user} do
      assert Tenancy.resource_in_tenant?(user, "company", to_string(user.company_id))
    end

    test "own company id + sub-form suffix passes", %{user_a: user} do
      # Frontend spawns `company:1:identity`, `company:1:locale`, etc.
      # parse_topic gives id = "1:locale"; only the numeric prefix is
      # authoritative.
      for suffix <- ["identity", "locale", "security", "holidays", "three-pl-rate"] do
        assert Tenancy.resource_in_tenant?(
                 user,
                 "company",
                 "#{user.company_id}:#{suffix}"
               ),
               "expected #{suffix} sub-form to pass"
      end
    end

    test "someone else's company id fails", %{user_a: user, tenant_b: tenant_b} do
      refute Tenancy.resource_in_tenant?(user, "company", to_string(tenant_b.id))
    end

    test "someone else's company id with sub-form still fails",
         %{user_a: user, tenant_b: tenant_b} do
      refute Tenancy.resource_in_tenant?(
               user,
               "company",
               "#{tenant_b.id}:identity"
             )
    end
  end

  describe "resource_in_tenant?/3 — user-access" do
    test "same-tenant user uuid passes", %{user_a: user, tenant_a: tenant_a} do
      peer = insert_user!(tenant_a.id, "peer@vitamanufacture.co.uk")

      assert Tenancy.resource_in_tenant?(user, "user-access", peer.uuid)
    end

    test "cross-tenant user uuid fails", %{user_a: user, tenant_b: tenant_b} do
      foreign_user = insert_user!(tenant_b.id, "foreign@vitamanufacture.co.uk")

      refute Tenancy.resource_in_tenant?(user, "user-access", foreign_user.uuid)
    end
  end

  describe "resource_in_tenant?/3 — unknown resource" do
    test "unregistered resource type denies by default", %{user_a: user} do
      # This is the security-critical default. New resources added
      # to `FormChannel` MUST also be added to `Tenancy` — otherwise
      # the room silently rejects every real join.
      refute Tenancy.resource_in_tenant?(user, "made-up-resource", "some-id")
    end
  end

  describe "classify_path/1" do
    test "vendor detail page classifies to a vendor entity" do
      assert {:entity, "vendor", "abc-uuid"} =
               Tenancy.classify_path("/procurement/vendors/abc-uuid")
    end

    test "vendor list page classifies as global" do
      assert :global = Tenancy.classify_path("/procurement/vendors")
    end

    test "home / dashboards are global" do
      assert :global = Tenancy.classify_path("/")
      assert :global = Tenancy.classify_path("/queues/reviews-due")
    end

    test "trailing segments after the uuid still resolve to the entity" do
      assert {:entity, "purchase-order", "po-uuid"} =
               Tenancy.classify_path("/procurement/purchase-orders/po-uuid/receive")
    end

    test "customer detail classifies correctly" do
      assert {:entity, "customer", "cust-uuid"} =
               Tenancy.classify_path("/sales/customers/cust-uuid")
    end

    test "stock lot detail classifies correctly" do
      assert {:entity, "stock-lot", "lot-uuid"} =
               Tenancy.classify_path("/stock/lots/lot-uuid")
    end
  end
end
