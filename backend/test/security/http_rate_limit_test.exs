defmodule Security.HttpRateLimitTest do
  @moduledoc """
  Unit-level test of the fixed-window rate limiter that guards the
  auth endpoints. Verifies the shape of the API and that the counter
  actually caps.

  Uses random scope + identifier per test so parallel runs never
  collide on the same key.
  """

  use ExUnit.Case, async: true

  alias Backend.HttpRateLimit

  setup do
    HttpRateLimit.init()
    :ok
  end

  test "accepts requests below the limit" do
    ident = "test-ip-#{System.unique_integer([:positive])}"

    for i <- 1..5 do
      assert {:ok, ^i} = HttpRateLimit.hit(:test_scope_low, ident, 10, 60)
    end
  end

  test "blocks once limit is reached" do
    ident = "test-ip-#{System.unique_integer([:positive])}"

    assert {:ok, 1} = HttpRateLimit.hit(:test_scope_cap, ident, 3, 60)
    assert {:ok, 2} = HttpRateLimit.hit(:test_scope_cap, ident, 3, 60)
    assert {:ok, 3} = HttpRateLimit.hit(:test_scope_cap, ident, 3, 60)

    assert {:limited, retry_after} = HttpRateLimit.hit(:test_scope_cap, ident, 3, 60)
    assert is_integer(retry_after)
    assert retry_after >= 0 and retry_after <= 60
  end

  test "different scopes don't share buckets" do
    ident = "shared-ident-#{System.unique_integer([:positive])}"

    assert {:ok, 1} = HttpRateLimit.hit(:test_scope_a, ident, 1, 60)
    # Same identifier under scope A is now over-limit.
    assert {:limited, _} = HttpRateLimit.hit(:test_scope_a, ident, 1, 60)
    # But scope B has never seen it.
    assert {:ok, 1} = HttpRateLimit.hit(:test_scope_b, ident, 1, 60)
  end

  test "different identifiers under the same scope don't share buckets" do
    ident_a = "ip-a-#{System.unique_integer([:positive])}"
    ident_b = "ip-b-#{System.unique_integer([:positive])}"

    assert {:ok, 1} = HttpRateLimit.hit(:test_scope_iso, ident_a, 1, 60)
    assert {:limited, _} = HttpRateLimit.hit(:test_scope_iso, ident_a, 1, 60)

    # Different IP → its own counter.
    assert {:ok, 1} = HttpRateLimit.hit(:test_scope_iso, ident_b, 1, 60)
  end

  test "1-second window rolls over quickly" do
    ident = "rollover-#{System.unique_integer([:positive])}"

    # Cap at 1 in a 1-second window. Second hit inside the same
    # second must fail; a hit after the window rolls must succeed.
    assert {:ok, 1} = HttpRateLimit.hit(:test_scope_rollover, ident, 1, 1)
    assert {:limited, _} = HttpRateLimit.hit(:test_scope_rollover, ident, 1, 1)

    # Sleep across a whole-second boundary. 1.2s picks the next
    # window regardless of when we started.
    Process.sleep(1_200)

    assert {:ok, 1} = HttpRateLimit.hit(:test_scope_rollover, ident, 1, 1)
  end
end
