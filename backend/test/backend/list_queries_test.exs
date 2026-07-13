defmodule Backend.ListQueriesTest do
  @moduledoc """
  Covers the two code-aware helpers `apply_search/4` and
  `pop_code_column_filter/3`. The rest of `ListQueries` is exercised
  transitively via context tests, but these two are load-bearing for
  the DataTable UX (top search + Code column filter) and easy to get
  wrong.

  Uses `Item` as a sample entity because it has an established
  numbering format ("MA00001…") in the base migrations, so
  `Numbering.render/3` + `parse_search/3` round-trip without any
  additional setup.
  """

  use Backend.DataCase, async: false

  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.ListQueries
  alias Backend.Numbering
  alias Backend.Repo

  # ----- fixtures --------------------------------------------------

  defp company_fixture do
    # Seed a numbering format for `item` so `Numbering.render/3` +
    # `parse_search/3` round-trip. Without this the format lookup
    # returns nil and every code helper degrades to a no-op — which
    # would make the tests below pass vacuously.
    Repo.insert!(%Company{
      name: "ListQueries-Test Co",
      numbering_formats: %{"item" => %{"prefix" => "MA", "padding" => 5}}
    })
  end

  defp item_fixture(company, name \\ "Vitamin C powder") do
    Repo.insert!(%Item{
      company_id: company.id,
      name: name,
      item_type: "raw_material"
    })
  end

  # ----- apply_search/4 --------------------------------------------

  describe "apply_search/4 with code_key" do
    test "text-only OR chain still works when code_key is nil (old 3-arg call)" do
      c = company_fixture()
      hit = item_fixture(c, "Ascorbic Acid")
      _miss = item_fixture(c, "Sodium Chloride")

      results =
        Item
        |> Ecto.Query.where([i], i.company_id == ^c.id)
        |> ListQueries.apply_search("ascorbic", [:name])
        |> Repo.all()

      assert Enum.map(results, & &1.id) == [hit.id]
    end

    test "code_key extends the OR chain so a rendered code finds its row" do
      c = company_fixture()
      hit = item_fixture(c)
      _miss = item_fixture(c, "Unrelated")

      rendered_code = Numbering.render(hit.id, c, "item")
      # Sanity — if the numbering format changed and this returns nil
      # the assertion below would still pass vacuously. Fail loudly.
      assert is_binary(rendered_code)

      results =
        Item
        |> Ecto.Query.where([i], i.company_id == ^c.id)
        |> ListQueries.apply_search(rendered_code, [:name], {c.id, "item"})
        |> Repo.all()

      assert Enum.map(results, & &1.id) == [hit.id]
    end

    test "code_key falls through to text search when the term isn't a code" do
      c = company_fixture()
      hit = item_fixture(c, "Ascorbic Acid")
      _miss = item_fixture(c, "Unrelated")

      results =
        Item
        |> Ecto.Query.where([i], i.company_id == ^c.id)
        |> ListQueries.apply_search("ascorbic", [:name], {c.id, "item"})
        |> Repo.all()

      assert Enum.map(results, & &1.id) == [hit.id]
    end

    test "code_key with unknown company id is safe — no crash, no code branch" do
      c = company_fixture()
      hit = item_fixture(c, "Ascorbic")

      # Bogus company id → resolve_code_id returns nil, text search still
      # applies. The row is only returned via the name ILIKE.
      results =
        Item
        |> Ecto.Query.where([i], i.company_id == ^c.id)
        |> ListQueries.apply_search("ascorbic", [:name], {9_999_999, "item"})
        |> Repo.all()

      assert Enum.map(results, & &1.id) == [hit.id]
    end

    test "empty term is a no-op regardless of code_key" do
      c = company_fixture()
      a = item_fixture(c, "A")
      b = item_fixture(c, "B")

      results =
        Item
        |> Ecto.Query.where([i], i.company_id == ^c.id)
        |> ListQueries.apply_search("", [:name], {c.id, "item"})
        |> Repo.all()

      assert MapSet.new(Enum.map(results, & &1.id)) == MapSet.new([a.id, b.id])
    end

    test "empty fields list with code_key still enables code search" do
      c = company_fixture()
      hit = item_fixture(c)
      rendered = Numbering.render(hit.id, c, "item")

      results =
        Item
        |> Ecto.Query.where([i], i.company_id == ^c.id)
        |> ListQueries.apply_search(rendered, [], {c.id, "item"})
        |> Repo.all()

      assert Enum.map(results, & &1.id) == [hit.id]
    end
  end

  # ----- pop_code_column_filter/3 ---------------------------------

  describe "pop_code_column_filter/3" do
    test "resolves a rendered code to the underlying integer id" do
      c = company_fixture()
      hit = item_fixture(c)
      rendered = Numbering.render(hit.id, c, "item")

      filters = %{"code" => %{"op" => "contains", "value" => rendered}}
      assert {id, remaining} = ListQueries.pop_code_column_filter(filters, c.id, "item")
      assert id == hit.id
      assert remaining == %{}
    end

    test "unresolvable code returns :no_match so callers can zero the result set" do
      c = company_fixture()

      filters = %{"code" => %{"op" => "contains", "value" => "ZZ99999"}}
      assert {:no_match, remaining} =
               ListQueries.pop_code_column_filter(filters, c.id, "item")

      assert remaining == %{}
    end

    test "missing code key returns nil id and the original map" do
      c = company_fixture()
      other = %{"name" => %{"op" => "contains", "value" => "acid"}}

      assert {nil, ^other} =
               ListQueries.pop_code_column_filter(other, c.id, "item")
    end

    test "nil filters map returns {nil, nil}" do
      c = company_fixture()
      assert {nil, nil} = ListQueries.pop_code_column_filter(nil, c.id, "item")
    end

    test "empty string value is treated as no filter" do
      c = company_fixture()

      filters = %{"code" => %{"op" => "contains", "value" => "   "}}
      assert {nil, remaining} =
               ListQueries.pop_code_column_filter(filters, c.id, "item")

      assert remaining == %{}
    end

    test "unsupported op (range) is dropped — code is a text-shaped filter only" do
      c = company_fixture()

      filters = %{"code" => %{"op" => "range", "min" => 1, "max" => 10}}
      assert {nil, remaining} =
               ListQueries.pop_code_column_filter(filters, c.id, "item")

      assert remaining == %{}
    end

    test "preserves other column filters untouched" do
      c = company_fixture()
      hit = item_fixture(c)
      rendered = Numbering.render(hit.id, c, "item")

      filters = %{
        "code" => %{"op" => "contains", "value" => rendered},
        "name" => %{"op" => "contains", "value" => "vitamin"}
      }

      assert {id, remaining} =
               ListQueries.pop_code_column_filter(filters, c.id, "item")

      assert id == hit.id
      assert remaining == %{"name" => %{"op" => "contains", "value" => "vitamin"}}
    end
  end

  # ----- end-to-end context integration ---------------------------

  describe "Items.list_page/2 code search" do
    test "top search bar finds item by rendered code" do
      c = company_fixture()
      hit = item_fixture(c)
      _noise = item_fixture(c, "Something else")

      rendered = Numbering.render(hit.id, c, "item")
      {items, _} = Backend.Items.list_page(c.id, search: rendered)
      assert Enum.map(items, & &1.id) == [hit.id]
    end

    test "column_filter[code] narrows to a single item by rendered code" do
      c = company_fixture()
      hit = item_fixture(c)
      _noise = item_fixture(c, "Noise A")
      _noise2 = item_fixture(c, "Noise B")

      rendered = Numbering.render(hit.id, c, "item")

      {items, _} =
        Backend.Items.list_page(c.id,
          column_filter: %{"code" => %{"op" => "contains", "value" => rendered}}
        )

      assert Enum.map(items, & &1.id) == [hit.id]
    end

    test "column_filter[code] with garbage value returns zero rows (not the whole table)" do
      c = company_fixture()
      item_fixture(c, "A")
      item_fixture(c, "B")

      {items, _} =
        Backend.Items.list_page(c.id,
          column_filter: %{"code" => %{"op" => "contains", "value" => "ZZ99999"}}
        )

      assert items == []
    end
  end
end
