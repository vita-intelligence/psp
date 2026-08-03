defmodule Backend.Repo.Migrations.GrantMoWriteNpdScope do
  @moduledoc """
  Grants ``mo:write:npd`` to every existing integration token that
  already carries ``customer_order:sync:npd`` — that scope is the
  fingerprint of an NPD-issued token, and NPD is the sole intended
  caller of ``POST /api/integration/manufacturing-orders`` (create
  MO from a trial batch).

  Backstory: the create endpoint required bare ``mo:write``, but no
  token in the wild actually holds that scope — NPD tokens are minted
  with ``mo:write:session`` + ``mo:transition`` only. Result: every
  Create-MO click 403'd, which surfaced as a generic "PSP rejected
  the credentials" banner on NPD.

  Fix in code: endpoint switches to ``mo:write:npd``.
  Fix in data (this migration): backfill so already-minted tokens
  keep working without a re-mint.
  """

  use Ecto.Migration

  def up do
    execute("""
    UPDATE integration_tokens
    SET scopes = array_append(scopes, 'mo:write:npd')
    WHERE 'customer_order:sync:npd' = ANY(scopes)
      AND NOT ('mo:write:npd' = ANY(scopes));
    """)
  end

  def down do
    execute("""
    UPDATE integration_tokens
    SET scopes = array_remove(scopes, 'mo:write:npd');
    """)
  end
end
