defmodule Backend.Stock.LifecycleBackfillTest do
  @moduledoc """
  Idempotency check for the lot-events backfill. Running the
  synthesised inserts twice must not double-write event rows for the
  same lot.

  We mirror the SQL the migration runs (a guarded INSERT ... WHERE NOT
  EXISTS pattern) and verify the second pass adds nothing.
  """

  use Backend.DataCase, async: false

  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Repo
  alias Backend.Stock.{Lot, LotEvent}
  alias Backend.Units.UnitOfMeasurement

  defp setup_world(_ctx) do
    company = Repo.insert!(%Company{name: "Backfill Co"})

    uom =
      Repo.insert!(%UnitOfMeasurement{
        company_id: company.id,
        name: "Kilogram",
        symbol: "kg",
        dimension: "mass",
        factor_to_base: Decimal.new("1"),
        is_base: true,
        is_active: true
      })

    item =
      Repo.insert!(%Item{
        company_id: company.id,
        name: "Test Material",
        item_type: "raw_material",
        stock_uom_id: uom.id
      })

    legacy_lot =
      Repo.insert!(%Lot{
        company_id: company.id,
        item_id: item.id,
        unit_of_measurement_id: uom.id,
        status: "received",
        qty_received: Decimal.new("5"),
        source_kind: "manual",
        received_at: DateTime.utc_now() |> DateTime.truncate(:second),
        package_length_mm: 100,
        package_width_mm: 100,
        package_height_mm: 100,
        package_weight_kg: Decimal.new("1"),
        units_per_package: 1,
        stack_factor: 1
      })

    {:ok, company: company, lot: legacy_lot}
  end

  describe "backfill SQL" do
    setup :setup_world

    test "synthesises a received event for a legacy lot", ctx do
      assert Repo.aggregate(LotEvent, :count, :id) == 0

      run_backfill_sql()

      events =
        Repo.all(
          from(e in LotEvent, where: e.stock_lot_id == ^ctx.lot.id)
        )

      assert length(events) == 1
      [event] = events
      assert event.kind == "received"
      assert event.actor_kind == "system"
      assert event.reason == "lifecycle backfill"
    end

    test "is idempotent — second pass writes no new rows", ctx do
      run_backfill_sql()
      count_after_first = Repo.aggregate(LotEvent, :count, :id, where: [stock_lot_id: ctx.lot.id])

      run_backfill_sql()
      count_after_second = Repo.aggregate(LotEvent, :count, :id, where: [stock_lot_id: ctx.lot.id])

      assert count_after_first == count_after_second
    end

    test "lots that already have any event are skipped", ctx do
      # Pretend a real event already exists (e.g. lot was created
      # post-migration via the new lifecycle flow).
      Repo.insert!(%LotEvent{
        company_id: ctx.lot.company_id,
        stock_lot_id: ctx.lot.id,
        kind: "received",
        actor_kind: "user",
        reason: "real receive",
        occurred_at: DateTime.utc_now(),
        metadata: %{}
      })

      run_backfill_sql()

      events =
        Repo.all(
          from(e in LotEvent, where: e.stock_lot_id == ^ctx.lot.id)
        )

      # Only the real event — backfill did not synthesise a duplicate.
      assert length(events) == 1
      assert hd(events).reason == "real receive"
    end
  end

  # Mirrors the first pass of the migration's INSERT. Idempotency is
  # the LEFT JOIN guard: rows already covered by any lot_events row
  # are skipped.
  defp run_backfill_sql do
    Ecto.Adapters.SQL.query!(Repo, """
    INSERT INTO lot_events (
      uuid, company_id, stock_lot_id, kind, actor_kind, reason,
      metadata, occurred_at, inserted_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      l.company_id,
      l.id,
      'received',
      'system',
      'lifecycle backfill',
      '{}'::jsonb,
      COALESCE(l.received_at, l.inserted_at),
      now(),
      now()
    FROM stock_lots l
    LEFT JOIN lot_events e ON e.stock_lot_id = l.id
    WHERE e.id IS NULL
    """)
  end
end
