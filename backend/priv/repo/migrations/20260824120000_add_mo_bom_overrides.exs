defmodule Backend.Repo.Migrations.AddMoBomOverrides do
  use Ecto.Migration

  # Per-MO deltas against the master BOM. The master row is never
  # mutated — we record what was changed, why, and by whom, then
  # apply the deltas on top when the BOM is projected for parts,
  # booking, and the release-time shortage gate.
  #
  # Three actions per row:
  #
  #   * ``removed``      — hide an existing BOM line from this MO
  #                        (nothing gets booked for it, nothing shows
  #                        on the parts table). Reason required.
  #   * ``qty_changed``  — override the master line's per-output qty
  #                        for this MO only. ``from_qty`` snapshots
  #                        the master at the time of the override so
  #                        the audit shows what the recipe said vs
  #                        what the run planned.
  #   * ``added``        — inject a one-off part into this MO's BOM
  #                        (no matching ``bom_line_id`` since it isn't
  #                        on the master). Books like a real BOM line.
  #
  # Application-level gate: only allowed while MO is ``draft`` or
  # ``prepared`` (see ``Backend.Production.can_override_bom?/1``).
  # Once the MO is approved the deltas freeze — later edits require a
  # bump back to draft or a fresh MO revision.
  def change do
    create table(:mo_bom_overrides) do
      add :uuid, :uuid, null: false

      add :manufacturing_order_id,
          references(:manufacturing_orders, on_delete: :delete_all),
          null: false

      add :bom_line_id,
          references(:bom_lines, on_delete: :nilify_all),
          null: true

      add :item_id,
          references(:items, on_delete: :restrict),
          null: true

      add :unit_of_measurement_id,
          references(:units_of_measurement, on_delete: :restrict),
          null: true

      add :action, :string, null: false
      add :from_qty, :decimal, precision: 20, scale: 10, null: true
      add :to_qty, :decimal, precision: 20, scale: 10, null: true
      add :is_fixed, :boolean, null: false, default: false
      add :reason, :text, null: true

      add :company_id,
          references(:companies, on_delete: :restrict),
          null: false

      add :created_by_id,
          references(:users, on_delete: :nilify_all),
          null: true

      timestamps(type: :utc_datetime)
    end

    create unique_index(:mo_bom_overrides, [:uuid])
    create index(:mo_bom_overrides, [:manufacturing_order_id])
    create index(:mo_bom_overrides, [:bom_line_id])

    # At most one override per (MO, master line). Covers removed +
    # qty_changed. Added rows carry bom_line_id = NULL so they sit
    # outside the partial index.
    create unique_index(
             :mo_bom_overrides,
             [:manufacturing_order_id, :bom_line_id],
             where: "bom_line_id IS NOT NULL",
             name: :mo_bom_overrides_per_line_unique
           )

    # An added part can only be injected once per MO — bump the qty
    # on the existing row instead of stacking duplicates.
    create unique_index(
             :mo_bom_overrides,
             [:manufacturing_order_id, :item_id],
             where: "bom_line_id IS NULL AND item_id IS NOT NULL",
             name: :mo_bom_overrides_added_item_unique
           )

    create constraint(
             :mo_bom_overrides,
             :action_is_valid,
             check: "action IN ('removed', 'qty_changed', 'added')"
           )

    # Edits/removes MUST reference a master line; adds MUST reference
    # an item. Enforce so the service never has to guess.
    create constraint(
             :mo_bom_overrides,
             :edit_shape_matches_action,
             check: """
             (action = 'added'      AND bom_line_id IS NULL AND item_id IS NOT NULL AND to_qty IS NOT NULL) OR
             (action = 'qty_changed' AND bom_line_id IS NOT NULL AND to_qty IS NOT NULL) OR
             (action = 'removed'    AND bom_line_id IS NOT NULL)
             """
           )
  end
end
