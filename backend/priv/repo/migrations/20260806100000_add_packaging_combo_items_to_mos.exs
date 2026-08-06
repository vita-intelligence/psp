defmodule Backend.Repo.Migrations.AddPackagingComboItemsToMos do
  @moduledoc """
  ``manufacturing_orders.packaging_combo_items`` — optional packaging
  overlay for R&D sample MOs from NPD.

  NPD (vita-cff) lets a scientist pick a ``PackagingCombo`` when
  planning a ``sample``-kind trial batch. The combo is a bag of
  packaging SKUs meant to override the finished-product item's
  default packaging BOM lines (bottle + label + lid + carton…).

  Non-nil array = overlay is active. The auto-booking pass in
  ``Backend.Production.book_all_for_mo`` skips packaging-typed BOM
  lines and books these instead (see
  ``apply_packaging_overlay?/2`` + ``book_packaging_overlay/3``).

  ``NULL`` = no overlay. The MO consumes whatever packaging the
  finished product's default BOM defines (this is the pre-existing
  behaviour for every MO created before this migration + every
  ``trial``-kind trial batch + every non-NPD-driven MO).

  Row shape when non-nil:
      [
        %{"item_id" => 42, "quantity" => "1.0"},
        %{"item_id" => 43, "quantity" => "1.0"},
        ...
      ]

  ``item_id`` is resolved from ``item_uuid`` by the integration
  controller before insert, so the booking loop never has to hit
  ``items`` by uuid — it can call ``allocate_for_item`` directly.
  ``quantity`` is a decimal string ("1.0") for JSON portability
  (Postgres jsonb → Ecto :map has no native Decimal type).
  """

  use Ecto.Migration

  def change do
    alter table(:manufacturing_orders) do
      add :packaging_combo_items, :map
    end
  end
end
