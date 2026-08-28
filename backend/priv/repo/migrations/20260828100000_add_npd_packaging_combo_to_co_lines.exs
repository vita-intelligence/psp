defmodule Backend.Repo.Migrations.AddNpdPackagingComboToCoLines do
  @moduledoc """
  Persist the customer-picked packaging combo on the CO line so the
  MO created for that line inherits the customer's packaging choice.

  Context — RTG SKUs (created on vita-cff) expose N packaging combos
  the customer can pick from at checkout: e.g. "Bottle 60ct" or
  "Pouch". Each combo is a list of packaging items (bottle + lid +
  label, or a single pouch). Until this migration the combo was
  captured on the proposal + spec sheet clone on the NPD side, and
  shipped in the merge_from_proposal payload, but PSP silently
  dropped it — the CO line stored only ``qty_ordered`` + ``item_id``
  so the MO the wizard spawned for the line inherited the item's
  DEFAULT packaging BOM, not the customer's pick. Result: an order
  for "Pouch" spawned an MO with the bottle+lid+label BOM lines.

  This migration adds three columns to hold the combo overlay:

    * ``npd_packaging_combo_uuid``   — combo the customer picked
      (NPD ``PackagingCombo.id``). Nullable — Custom orders never
      set this; legacy RTG rows created before this ships stay nil
      and the wizard falls back to the default BOM.
    * ``npd_packaging_combo_name``   — human label kept for reads
      (kanban chip, receipt printout) so the FE doesn't have to
      call back to NPD to render "Pouch" vs a bare UUID.
    * ``npd_packaging_combo_items``  — JSONB list of the combo's
      items, each ``{npd_item_uuid, psp_item_uuid, name, quantity}``.
      Self-contained so ``customer_order_controller.create_mo_for_line``
      can resolve each item to a PSP ``item_id`` and pass the list
      through to ``Production.create_manufacturing_order`` as
      ``packaging_combo_items`` — the exact shape the MO overlay
      logic (``packaging_overlay_active?`` in production.ex) already
      knows how to overlay onto the finished-product BOM.

  No index needed — reads only happen through the CO line's own PK
  during MO create; there's no by-combo query pattern.
  """

  use Ecto.Migration

  def change do
    alter table(:customer_order_lines) do
      add :npd_packaging_combo_uuid, :uuid, null: true
      add :npd_packaging_combo_name, :string, null: true, size: 200
      add :npd_packaging_combo_items, {:array, :map}, null: true
    end
  end
end
