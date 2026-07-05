defmodule Security.StockLotSortTest do
  @moduledoc """
  Regression for C3 — atom-table DoS on the `?sort=` query param.

  The old code did `String.to_atom(field)` on the raw client string.
  The BEAM's atom table is capped (~1M) and never garbage-collected,
  so an attacker hammering the endpoint with random unique field
  names would eventually crash the node. The fix constrains inputs
  to a whitelist and uses `String.to_existing_atom/1`.

  Belt + braces: this test hammers the parser with 500 random field
  names and asserts the atom count didn't budge.
  """

  use ExUnit.Case, async: true

  alias BackendWeb.StockLotController

  test "valid whitelisted field + direction parses" do
    assert {:code, :asc} = StockLotController.parse_sort("code:asc")
    assert {:expiry_at, :desc} = StockLotController.parse_sort("expiry_at:desc")
  end

  test "unknown field is dropped, no new atom is created" do
    before_count = :erlang.system_info(:atom_count)

    # Batch of made-up field names an attacker might spray.
    for i <- 1..500 do
      field = "attacker_field_#{i}_#{System.unique_integer([:positive])}"
      assert nil == StockLotController.parse_sort("#{field}:asc")
    end

    after_count = :erlang.system_info(:atom_count)

    # Some background compilation / logging may add a handful; a
    # regression of the vulnerability would add ~500 in this loop.
    delta = after_count - before_count
    assert delta < 50, "atom table grew by #{delta} — atom-injection may have regressed"
  end

  test "invalid direction is rejected without creating an atom" do
    before_count = :erlang.system_info(:atom_count)

    for i <- 1..200 do
      dir = "attacker_dir_#{i}"
      assert nil == StockLotController.parse_sort("code:#{dir}")
    end

    delta = :erlang.system_info(:atom_count) - before_count
    assert delta < 50
  end

  test "malformed spec is rejected" do
    assert nil == StockLotController.parse_sort("just-a-string")
    assert nil == StockLotController.parse_sort("")
    assert nil == StockLotController.parse_sort(nil)
    assert nil == StockLotController.parse_sort(42)
    assert nil == StockLotController.parse_sort(%{})
  end

  test "empty field / empty direction is rejected" do
    assert nil == StockLotController.parse_sort(":asc")
    assert nil == StockLotController.parse_sort("code:")
    assert nil == StockLotController.parse_sort(":")
  end
end
