defmodule BackendWeb.IntegrationStageWriteTest do
  @moduledoc """
  End-to-end tests for the write-side integration endpoints that
  enable NPD's multi-stage BOM push:

    * ``GET  /api/integration/workstation-groups`` — picker source
      for NPD's stage builder.
    * ``POST /api/integration/items``               — creates
      semi-finished / finished-product items idempotently by
      ``external_sku`` so NPD can safely re-push after a network
      blip.
    * ``PUT  /api/integration/items/:uuid/routing`` — upserts the
      routing (wholesale-replaces steps) for a BOMmable item.

  Coverage focuses on auth (401 / 403), the idempotency contracts,
  and cross-company scoping — the same shape as
  ``integration_read_items_test.exs``.
  """

  use BackendWeb.ConnCase, async: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.IntegrationTokens
  alias Backend.Items.Item
  alias Backend.Production.{Routing, WorkstationGroup}
  alias Backend.Repo

  defp seed_company(name, scopes) do
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

    {:ok, %{token: raw}} =
      IntegrationTokens.create(
        %{name: "npd-#{System.unique_integer([:positive])}", scopes: scopes},
        company.id,
        user.id
      )

    %{company: company, user: user, raw: raw}
  end

  defp insert_item(company, attrs) do
    default = %{
      company_id: company.id,
      name: "Item #{System.unique_integer([:positive])}",
      item_type: "finished_product",
      is_active: true,
      attributes: %{}
    }

    Repo.insert!(struct!(Item, Map.merge(default, attrs)))
  end

  defp insert_workstation_group(company, attrs) do
    default = %{
      company_id: company.id,
      name: "Group #{System.unique_integer([:positive])}",
      kind: "active_processing",
      is_active: true
    }

    Repo.insert!(struct!(WorkstationGroup, Map.merge(default, attrs)))
  end

  # ---------------------------------------------------------------------------
  # /workstation-groups — auth + scoping
  # ---------------------------------------------------------------------------

  describe "GET /workstation-groups" do
    test "401 without a token", %{conn: conn} do
      r =
        conn
        |> get(~p"/api/integration/workstation-groups")
        |> json_response(401)

      assert r["error"] == "missing_integration_token"
    end

    test "403 without workstation:read scope", %{conn: conn} do
      %{raw: raw} = seed_company("A", ["item:read"])

      r =
        conn
        |> put_req_header("x-integration-token", raw)
        |> get(~p"/api/integration/workstation-groups")
        |> json_response(403)

      assert r["error"] == "insufficient_scope"
    end

    test "returns only active groups scoped to caller's company", %{conn: conn} do
      %{company: mine, raw: raw} = seed_company("Mine", ["workstation:read"])
      %{company: other} = seed_company("Other", ["workstation:read"])

      insert_workstation_group(mine, %{name: "Blender A"})
      insert_workstation_group(mine, %{name: "Blender B"})
      insert_workstation_group(mine, %{name: "Retired", is_active: false})
      insert_workstation_group(other, %{name: "Not Mine"})

      r =
        conn
        |> put_req_header("x-integration-token", raw)
        |> get(~p"/api/integration/workstation-groups")
        |> json_response(200)

      names = Enum.map(r["items"], & &1["name"])
      assert Enum.sort(names) == ["Blender A", "Blender B"]

      # Kind + colour make it through so NPD's picker can render the
      # right chip / hint text.
      first = List.first(r["items"])
      assert first["kind"] == "active_processing"
    end
  end

  # ---------------------------------------------------------------------------
  # POST /items — semi-finished + finished-product upsert
  # ---------------------------------------------------------------------------

  describe "POST /items" do
    test "403 without item:write scope", %{conn: conn} do
      %{raw: raw} = seed_company("A", ["item:read"])

      r =
        conn
        |> put_req_header("x-integration-token", raw)
        |> post(~p"/api/integration/items", %{
          name: "x",
          item_type: "semi_finished",
          external_sku: "NPD-1"
        })
        |> json_response(403)

      assert r["error"] == "insufficient_scope"
    end

    test "creates a semi_finished item on first push", %{conn: conn} do
      %{company: mine, raw: raw} = seed_company("Mine", ["item:write"])

      r =
        conn
        |> put_req_header("x-integration-token", raw)
        |> post(~p"/api/integration/items", %{
          name: "Powder Blend — Vitamin C",
          item_type: "semi_finished",
          external_sku: "NPD-STAGE-abc-1"
        })
        |> json_response(201)

      assert r["item"]["created"] == true
      assert r["item"]["item_type"] == "semi_finished"
      assert r["item"]["external_sku"] == "NPD-STAGE-abc-1"

      # Round-trips through Repo.
      stored = Repo.get_by!(Item, external_sku: "NPD-STAGE-abc-1")
      assert stored.company_id == mine.id
    end

    test "second push with same external_sku returns the existing row (200)", %{conn: conn} do
      %{raw: raw} = seed_company("Mine", ["item:write"])

      first =
        conn
        |> put_req_header("x-integration-token", raw)
        |> post(~p"/api/integration/items", %{
          name: "Powder Blend",
          item_type: "semi_finished",
          external_sku: "NPD-DUP"
        })
        |> json_response(201)

      second =
        conn
        |> put_req_header("x-integration-token", raw)
        |> post(~p"/api/integration/items", %{
          name: "Powder Blend (renamed)",
          item_type: "semi_finished",
          external_sku: "NPD-DUP"
        })
        |> json_response(200)

      assert second["item"]["uuid"] == first["item"]["uuid"]
      assert second["item"]["created"] == false
    end

    test "rejects raw_material item_type", %{conn: conn} do
      %{raw: raw} = seed_company("A", ["item:write"])

      r =
        conn
        |> put_req_header("x-integration-token", raw)
        |> post(~p"/api/integration/items", %{
          name: "Ashwagandha",
          item_type: "raw_material",
          external_sku: "NPD-RM"
        })
        |> json_response(422)

      assert r["error"] == "item_type_not_allowed"
    end

    test "missing required fields → invalid_payload", %{conn: conn} do
      %{raw: raw} = seed_company("A", ["item:write"])

      r =
        conn
        |> put_req_header("x-integration-token", raw)
        |> post(~p"/api/integration/items", %{item_type: "semi_finished"})
        |> json_response(422)

      assert r["error"] == "invalid_payload"
    end
  end

  # ---------------------------------------------------------------------------
  # PUT /items/:uuid/routing — upsert routing + steps
  # ---------------------------------------------------------------------------

  describe "PUT /items/:uuid/routing" do
    test "403 without routing:write scope", %{conn: conn} do
      %{company: mine, raw: raw} = seed_company("A", ["item:write"])
      item = insert_item(mine, %{item_type: "finished_product"})

      r =
        conn
        |> put_req_header("x-integration-token", raw)
        |> put(~p"/api/integration/items/#{item.uuid}/routing", %{steps: []})
        |> json_response(403)

      assert r["error"] == "insufficient_scope"
    end

    test "404-shape for unknown item", %{conn: conn} do
      %{raw: raw} = seed_company("A", ["routing:write"])

      r =
        conn
        |> put_req_header("x-integration-token", raw)
        |> put(
          ~p"/api/integration/items/00000000-0000-0000-0000-000000000000/routing",
          %{steps: []}
        )
        |> json_response(422)

      assert r["error"] == "item_not_found"
    end

    test "rejects raw_material items", %{conn: conn} do
      %{company: mine, raw: raw} = seed_company("A", ["routing:write"])
      rm = insert_item(mine, %{item_type: "raw_material"})

      r =
        conn
        |> put_req_header("x-integration-token", raw)
        |> put(~p"/api/integration/items/#{rm.uuid}/routing", %{steps: []})
        |> json_response(422)

      assert r["error"] == "bom_not_allowed_for_item_type"
    end

    test "creates a routing with steps + updates in place on re-push", %{conn: conn} do
      %{company: mine, raw: raw} = seed_company("Mine", ["routing:write"])
      item = insert_item(mine, %{item_type: "semi_finished"})
      blender = insert_workstation_group(mine, %{name: "Blender"})
      encapsulator = insert_workstation_group(mine, %{name: "Encapsulator"})

      first =
        conn
        |> put_req_header("x-integration-token", raw)
        |> put(~p"/api/integration/items/#{item.uuid}/routing", %{
          name: "Stage 1 Routing",
          steps: [
            %{
              workstation_group_uuid: blender.uuid,
              operation_description: "Blend actives + excipients",
              setup_time_min: "5",
              cycle_time_min: "45"
            }
          ]
        })
        |> json_response(200)

      routing_uuid = first["routing"]["uuid"]
      assert first["routing"]["step_count"] == 1

      # Re-push with a two-step routing — steps are wholesale-replaced,
      # not appended.
      second =
        conn
        |> put_req_header("x-integration-token", raw)
        |> put(~p"/api/integration/items/#{item.uuid}/routing", %{
          name: "Stage 1 Routing",
          steps: [
            %{workstation_group_uuid: blender.uuid, sort_order: 0},
            %{workstation_group_uuid: encapsulator.uuid, sort_order: 1}
          ]
        })
        |> json_response(200)

      assert second["routing"]["uuid"] == routing_uuid
      assert second["routing"]["step_count"] == 2

      routing = Repo.get!(Routing, Repo.get_by!(Routing, uuid: routing_uuid).id)
      assert routing.company_id == mine.id
    end

    test "step referencing an unknown workstation_group → invalid_step", %{conn: conn} do
      %{company: mine, raw: raw} = seed_company("A", ["routing:write"])
      item = insert_item(mine, %{item_type: "semi_finished"})

      r =
        conn
        |> put_req_header("x-integration-token", raw)
        |> put(~p"/api/integration/items/#{item.uuid}/routing", %{
          steps: [
            %{workstation_group_uuid: "00000000-0000-0000-0000-000000000000"}
          ]
        })
        |> json_response(422)

      assert r["error"] == "invalid_step"
    end
  end
end
