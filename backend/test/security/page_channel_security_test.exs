defmodule Security.PageChannelSecurityTest do
  @moduledoc """
  Cross-tenant `page:/<path>` join must be refused when the path
  addresses a detail record in another tenant (C5).

  Presence on `PageChannel` broadcasts names + avatars of everyone
  on the page. Before the gate, a user in tenant A subscribing to
  `page:/procurement/vendors/<uuid-from-tenant-B>` would receive
  the roster of every peer viewing that vendor detail — surfacing
  who works with the competitor.
  """

  use Backend.SecurityCase, async: false

  import Phoenix.ChannelTest

  alias BackendWeb.{PageChannel, UserSocket}

  @endpoint BackendWeb.Endpoint

  setup do
    tenant_a = insert_company!("Tenant A — page")
    tenant_b = insert_company!("Tenant B — page")

    user_a = insert_user!(tenant_a.id, "page-a@vitamanufacture.co.uk", ["vendors.edit"])
    user_b = insert_user!(tenant_b.id, "page-b@vitamanufacture.co.uk", ["vendors.edit"])

    vendor_a = insert_vendor!(tenant_a.id, user_a)
    vendor_b = insert_vendor!(tenant_b.id, user_b)

    %{
      user_a: user_a,
      vendor_a: vendor_a,
      vendor_b: vendor_b
    }
  end

  describe "detail page joins" do
    test "same-tenant vendor detail page is accepted",
         %{user_a: user, vendor_a: vendor} do
      topic = "page:" <> URI.encode("/procurement/vendors/#{vendor.uuid}")

      assert {:ok, _reply, _socket} =
               user
               |> socket_for()
               |> subscribe_and_join(PageChannel, topic)
    end

    test "cross-tenant vendor detail page is refused",
         %{user_a: user_a, vendor_b: foreign_vendor} do
      topic = "page:" <> URI.encode("/procurement/vendors/#{foreign_vendor.uuid}")

      assert {:error, %{reason: "forbidden"}} =
               user_a
               |> socket_for()
               |> subscribe_and_join(PageChannel, topic)
    end
  end

  describe "global surfaces" do
    test "home page is always joinable", %{user_a: user} do
      topic = "page:" <> URI.encode("/")

      assert {:ok, _reply, _socket} =
               user
               |> socket_for()
               |> subscribe_and_join(PageChannel, topic)
    end

    test "list pages don't embed cross-tenant uuids, so global-allow is correct",
         %{user_a: user} do
      topic = "page:" <> URI.encode("/procurement/vendors")

      assert {:ok, _reply, _socket} =
               user
               |> socket_for()
               |> subscribe_and_join(PageChannel, topic)
    end
  end

  describe "topic validation" do
    test "empty path is rejected", %{user_a: user} do
      assert {:error, %{reason: "bad_topic"}} =
               user
               |> socket_for()
               |> subscribe_and_join(PageChannel, "page:")
    end
  end

  # ----- helpers ---------------------------------------------------

  defp socket_for(user) do
    socket(UserSocket, "users_socket:#{user.id}", %{current_user: user})
  end
end
