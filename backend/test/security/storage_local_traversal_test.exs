defmodule Security.StorageLocalTraversalTest do
  @moduledoc """
  Defence-in-depth: `Backend.Storage.Local.absolute_path/1` must
  refuse any key that resolves outside the storage root, even though
  no live caller passes user input. If a future caller regresses,
  we prefer a raised exception over a silent read of `/etc/passwd`.
  """

  use ExUnit.Case, async: false

  alias Backend.Storage.Local

  setup do
    # Point the adapter at a test-owned tmp dir for the duration of
    # this test so we don't stomp on `priv/uploads/` and can spot the
    # exact root value in error messages.
    tmp = System.tmp_dir!() |> Path.join("psp-storage-test-#{System.unique_integer([:positive])}")
    File.mkdir_p!(tmp)

    prior = Application.get_env(:backend, Backend.Storage)
    Application.put_env(:backend, Backend.Storage, root: tmp)

    on_exit(fn ->
      if prior, do: Application.put_env(:backend, Backend.Storage, prior),
      else: Application.delete_env(:backend, Backend.Storage)

      File.rm_rf!(tmp)
    end)

    %{root: tmp}
  end

  test "a plain key resolves under the root", %{root: root} do
    assert Local.absolute_path("items/foo.jpg") == Path.join(root, "items/foo.jpg")
  end

  test "a nested key still resolves under the root", %{root: root} do
    assert Local.absolute_path("a/b/c/d.pdf") == Path.join(root, "a/b/c/d.pdf")
  end

  test "`..` segments that stay inside the root are allowed if they resolve above" do
    # Not a real attack — `a/b/../c` collapses to `a/c` inside root.
    # Sanity-check the expansion behaves as Path.expand does.
    root = Application.get_env(:backend, Backend.Storage)[:root]
    assert Local.absolute_path("a/b/../c.txt") == Path.join(root, "a/c.txt")
  end

  test "`..` traversal that escapes the root raises" do
    assert_raise ArgumentError, ~r/refused to leave root/, fn ->
      Local.absolute_path("../etc/passwd")
    end
  end

  test "deep `../..` traversal raises" do
    assert_raise ArgumentError, ~r/refused to leave root/, fn ->
      Local.absolute_path("a/../../etc/passwd")
    end
  end

  test "absolute-looking input is coerced under root, not escaped" do
    # `Path.join(root, "/etc/passwd")` in Elixir strips the leading
    # slash and treats the input as relative. The result stays
    # inside root — no filesystem traversal is possible via an
    # absolute-looking key. Documented here so a future refactor
    # doesn't quietly swap in a different join primitive.
    root = Application.get_env(:backend, Backend.Storage)[:root]
    result = Local.absolute_path("/etc/passwd")

    assert result == Path.join(root, "etc/passwd")
    assert String.starts_with?(result, root <> "/")
  end

  test "sibling root traversal is refused" do
    # `<root>-neighbour/x` shares a prefix with root without being
    # underneath it — must be rejected.
    root = Application.get_env(:backend, Backend.Storage)[:root]

    assert_raise ArgumentError, ~r/refused to leave root/, fn ->
      # This is what would happen if a caller assembled a path badly
      # and it happened to expand to a sibling of root.
      Local.absolute_path("../#{Path.basename(root)}-neighbour/x")
    end
  end
end
