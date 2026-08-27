defmodule Backend.Repo.Migrations.WidenShipmentsStatusCheckForPartialPickup do
  @moduledoc """
  The multi-visit pickup migration (20260827160000) added the
  ``partially_picked`` status to the schema + application-level
  ``@statuses`` list, but the pre-existing ``shipments_status_check``
  CHECK constraint on the ``shipments`` table was locked to the
  original 5 statuses (draft / ready / picked_up / delivered /
  cancelled). Every ``log_pickup_event`` call that landed a
  ``partially_picked`` shipment therefore failed the constraint at
  commit time with:

      "shipments_status_check" (check_constraint)

  Widen the constraint to include ``partially_picked``. Kept as a
  drop + create so a rollback restores the previous 5-value shape.
  """

  use Ecto.Migration

  def up do
    execute """
    ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check;
    """

    execute """
    ALTER TABLE shipments
      ADD CONSTRAINT shipments_status_check
      CHECK (status IN ('draft', 'ready', 'partially_picked', 'picked_up', 'delivered', 'cancelled'));
    """
  end

  def down do
    execute """
    ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_status_check;
    """

    execute """
    ALTER TABLE shipments
      ADD CONSTRAINT shipments_status_check
      CHECK (status IN ('draft', 'ready', 'picked_up', 'delivered', 'cancelled'));
    """
  end
end
