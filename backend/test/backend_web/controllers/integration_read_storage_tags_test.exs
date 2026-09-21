defmodule BackendWeb.IntegrationReadStorageTagsTest do
  @moduledoc """
  Regression cover for `GET /api/integration/storage-tags`. NPD's
  Setup tab is a live consumer — a schema/wire drift here breaks
  the storage-tag chip picker silently (the FE swallows the error
  and shows "No storage tags in PSP's catalog yet"), so we assert
  the wire shape explicitly.

  The bug this test guards against: an earlier revision filtered
  `where: t.is_active == true` in the query. `StorageTag` never had
  an `is_active` column, so the endpoint 500'd `Ecto.QueryError` on
  every hit — silent from NPD's perspective, broken for operators.
  """

  use BackendWeb.ConnCase, async: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.IntegrationTokens
  alias Backend.Repo
  alias Backend.Warehouses.StorageTag

  defp seed_company(name, scopes \\ ["item:read"]) do
    company = Repo.insert!(%Company{name: name})

    user =
      Repo.insert!(%User{
        company_id: company.id,
        email: "tags-#{System.unique_integer([:positive])}@example.com",
        name: "Ops",
        hashed_password: "$2b$12$placeholder",
        is_active: true,
        confirmed_at: DateTime.utc_now() |> DateTime.truncate(:second)
      })

    {:ok, %{token: raw}} =
      IntegrationTokens.create(
        %{name: "npd-storage-tags", scopes: scopes},
        company.id,
        user.id
      )

    %{company: company, user: user, raw: raw}
  end

  defp insert_tag(company, attrs) do
    Repo.insert!(
      struct!(StorageTag, Map.merge(%{company_id: company.id}, attrs))
    )
  end

  test "401 without an integration token", %{conn: conn} do
    result =
      conn
      |> get(~p"/api/integration/storage-tags")
      |> json_response(401)

    assert result["error"] == "missing_integration_token"
  end

  test "403 when the token lacks item:read scope", %{conn: conn} do
    %{raw: raw} = seed_company("NoScope Tags Co", ["mo:read"])

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/storage-tags")
      |> json_response(403)

    assert result["error"] == "insufficient_scope"
  end

  test "200 returns tags scoped to the caller's company, sorted by label",
       %{conn: conn} do
    %{company: mine, raw: raw} = seed_company("Mine Tags Co")
    %{company: other} = seed_company("Other Tags Co")

    insert_tag(mine, %{key: "cold-zone", label: "Cold zone", kind: "cell"})
    insert_tag(mine, %{key: "ambient", label: "Ambient", kind: "both"})
    insert_tag(other, %{key: "cold-zone", label: "Cold zone", kind: "cell"})

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/storage-tags")
      |> json_response(200)

    labels = Enum.map(result["items"], & &1["label"])
    assert labels == ["Ambient", "Cold zone"]
  end

  test "wire shape carries the fields NPD's Setup tab reads", %{conn: conn} do
    %{company: mine, raw: raw} = seed_company("Wire Shape Co")

    insert_tag(mine, %{key: "fragile", label: "Fragile", kind: "both"})

    result =
      conn
      |> put_req_header("x-integration-token", raw)
      |> get(~p"/api/integration/storage-tags")
      |> json_response(200)

    [row] = result["items"]

    # Legacy fields NPD's FE still reads. If we ever drop these,
    # coordinate the wire cut with vita-cff's storage-tag picker.
    assert Map.has_key?(row, "uuid")
    assert row["name"] == "Fragile"
    assert row["color"] == nil

    # New fields the current PSP schema exposes.
    assert row["key"] == "fragile"
    assert row["label"] == "Fragile"
    assert row["kind"] == "both"
  end
end
