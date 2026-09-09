defmodule Backend.Repo.Migrations.AddNpdFinalSpecFormulationVersionToCustomerOrders do
  @moduledoc """
  Adds ``npd_final_spec_formulation_version_id`` (string) to
  ``customer_orders`` so PSP's MO Trust Card can honestly detect
  BOM/spec drift by comparing the formulation version the customer
  signed against with the version currently on the BOM.

  Prior state used a timestamp comparison (``bom.npd_synced_at >
  co.npd_final_spec_signed_at`` → drift). That false-positived
  every time NPD re-pushed the BOM for a reason unrelated to a
  recipe change — SPOU refresh, provenance metadata update,
  restored packaging line — leaving the card red even though the
  customer's signed spec still describes exactly what the BOM
  encodes.

  Version-based comparison is deterministic: the customer signed
  against ``formulation_version.version_number = N``; the BOM
  carries ``npd_formulation_version_id = M``; ``N == M`` ⇒
  same recipe ⇒ no drift, regardless of when the BOM was last
  re-pushed. ``N != M`` ⇒ the recipe was edited after the sign
  and the operator needs to know.

  Storage shape mirrors ``boms.npd_formulation_version_id``
  (``character varying(64)``) so both sides can be string-compared
  without type juggling. Nullable + no default — populated on the
  next proposal-merge sync from NPD; legacy rows stay null and
  the FE falls back to the old timestamp check for them.
  """

  use Ecto.Migration

  def up do
    alter table(:customer_orders) do
      add :npd_final_spec_formulation_version_id, :string, size: 64
    end
  end

  def down do
    alter table(:customer_orders) do
      remove :npd_final_spec_formulation_version_id
    end
  end
end
