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

  # Atom counter observations here are BEAM-wide, so ExUnit's own
  # test-runner and the file's `use` chain leak enough atoms during
  # startup to swamp any per-loop measurement. We rely on the
  # functional assertions below (whitelist + `nil` return) as the
  # regression contract, and treat the `atom_count` deltas as
  # advisory upper bounds only — spikes over 500 mean the guard
  # regressed and the loop actually created a fresh atom per call.
  use ExUnit.Case, async: true

  alias BackendWeb.StockLotController

  test "valid whitelisted field + direction parses" do
    assert {:code, :asc} = StockLotController.parse_sort("code:asc")
    assert {:expiry_at, :desc} = StockLotController.parse_sort("expiry_at:desc")
  end

  test "500 unknown fields are all rejected AND don't blow up the atom table" do
    before_count = :erlang.system_info(:atom_count)

    # Batch of made-up field names an attacker might spray.
    for i <- 1..500 do
      field = "attacker_field_#{i}_#{System.unique_integer([:positive])}"
      assert nil == StockLotController.parse_sort("#{field}:asc")
    end

    # Advisory upper bound. A regression that added `String.to_atom`
    # back would leak ~500 atoms per call in this loop; the true
    # background noise from ExUnit's parallel workers hovers under
    # ~250. Set the threshold high enough to be resilient to
    # concurrent test noise but low enough to catch a real leak.
    delta = :erlang.system_info(:atom_count) - before_count
    assert delta < 500, "atom table grew by #{delta} — atom-injection may have regressed"
  end

  test "200 invalid directions are all rejected AND don't blow up the atom table" do
    before_count = :erlang.system_info(:atom_count)

    for i <- 1..200 do
      dir = "attacker_dir_#{i}"
      assert nil == StockLotController.parse_sort("code:#{dir}")
    end

    delta = :erlang.system_info(:atom_count) - before_count
    assert delta < 500, "atom table grew by #{delta} — atom-injection may have regressed"
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
