defmodule Backend.Stock.LifecycleTest do
  @moduledoc """
  Lifecycle state machine tests. We're proving three things:

    1. Every allowed (from-status, event-kind) pair in the matrix
       succeeds, inserts the event row, and updates the lot status
       via the projection.
    2. Every (from-status, event-kind) pair NOT in the matrix is
       rejected with `{:error, :illegal_transition, info}` — the
       compliance guarantee that workers can't smuggle in an event
       the procedure doesn't allow.
    3. The projection rules in `project_status/1` produce the correct
       status for each interesting event chain.
  """

  use Backend.DataCase, async: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Items.Item
  alias Backend.Repo
  alias Backend.Stock.{Lifecycle, Lot, LotEvent}
  alias Backend.Units.UnitOfMeasurement

  # ----- fixtures --------------------------------------------------

  defp company_fixture do
    Repo.insert!(%Company{name: "Lifecycle Co"})
  end

  defp user_fixture(company) do
    Repo.insert!(%User{
      company_id: company.id,
      email: "lifecycle-#{System.unique_integer([:positive])}@example.com",
      name: "Lifecycle Worker",
      hashed_password: "$pbkdf2-sha512$test$placeholder",
      is_active: true
    })
  end

  defp uom_fixture(company) do
    Repo.insert!(%UnitOfMeasurement{
      company_id: company.id,
      name: "Kilogram",
      symbol: "kg",
      dimension: "mass",
      factor_to_base: Decimal.new("1"),
      is_base: true,
      is_active: true
    })
  end

  defp item_fixture(company, uom) do
    Repo.insert!(%Item{
      company_id: company.id,
      name: "Sodium Citrate",
      item_type: "raw_material",
      stock_uom_id: uom.id
    })
  end

  # Insert a lot directly at the requested status, bypassing the
  # service-level transitions. Used to fabricate test fixtures for
  # each from-status — production code never sets status this way.
  defp lot_at_status(company, item, uom, status) do
    Repo.insert!(%Lot{
      company_id: company.id,
      item_id: item.id,
      unit_of_measurement_id: uom.id,
      status: status,
      qty_received: Decimal.new("10"),
      source_kind: "manual",
      package_length_mm: 100,
      package_width_mm: 100,
      package_height_mm: 100,
      package_weight_kg: Decimal.new("1"),
      units_per_package: 1,
      stack_factor: 1
    })
  end

  defp setup_world(_ctx) do
    company = company_fixture()
    user = user_fixture(company)
    uom = uom_fixture(company)
    item = item_fixture(company, uom)

    {:ok, company: company, user: user, uom: uom, item: item}
  end

  # ----- pure projection ------------------------------------------

  describe "project_status/1" do
    test "empty event log → expected" do
      assert Lifecycle.project_status([]) == "expected"
    end

    test "received only → received" do
      assert Lifecycle.project_status([event("received")]) == "received"
    end

    test "received + qc_passed → available" do
      assert Lifecycle.project_status([
               event("received", at: 1),
               event("qc_passed", at: 2)
             ]) == "available"
    end

    test "qc_failed wins regardless of later events of other kinds" do
      assert Lifecycle.project_status([
               event("received", at: 1),
               event("qc_failed", at: 2)
             ]) == "rejected"
    end

    test "held after qc_passed → on_hold" do
      assert Lifecycle.project_status([
               event("received", at: 1),
               event("qc_passed", at: 2),
               event("held", at: 3)
             ]) == "on_hold"
    end

    test "released after held → available" do
      assert Lifecycle.project_status([
               event("received", at: 1),
               event("qc_passed", at: 2),
               event("held", at: 3),
               event("released", at: 4)
             ]) == "available"
    end

    test "held wins when it occurs after release" do
      assert Lifecycle.project_status([
               event("received", at: 1),
               event("qc_passed", at: 2),
               event("held", at: 3),
               event("released", at: 4),
               event("held", at: 5)
             ]) == "on_hold"
    end

    test "routed_to_quarantine with no QC verdict → quarantine" do
      assert Lifecycle.project_status([
               event("received", at: 1),
               event("routed_to_quarantine", at: 2)
             ]) == "quarantine"
    end

    test "qc_passed after quarantine → available" do
      assert Lifecycle.project_status([
               event("received", at: 1),
               event("routed_to_quarantine", at: 2),
               event("qc_passed", at: 3)
             ]) == "available"
    end

    test "disposed beats everything except canceled" do
      assert Lifecycle.project_status([
               event("received", at: 1),
               event("qc_passed", at: 2),
               event("disposed", at: 3)
             ]) == "disposed"
    end

    test "canceled beats every other terminal" do
      assert Lifecycle.project_status([
               event("expected", at: 1),
               event("canceled", at: 2)
             ]) == "canceled"
    end

    test "consumed_to_zero → depleted" do
      assert Lifecycle.project_status([
               event("received", at: 1),
               event("qc_passed", at: 2),
               event("consumed_to_zero", at: 3)
             ]) == "depleted"
    end

    test "requested precedes received in the timeline" do
      assert Lifecycle.project_status([event("requested", at: 1)]) == "requested"
    end

    test "expected alone → expected" do
      assert Lifecycle.project_status([event("expected", at: 1)]) == "expected"
    end
  end

  # ----- state machine matrix --------------------------------------

  describe "record_event/3 — allowed transitions" do
    setup :setup_world

    test "expected → received via received event", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "expected")

      assert {:ok, %{lot: updated, event: event, status: "received"}} =
               Lifecycle.record_event(lot, "received", actor_attrs(ctx.user))

      assert updated.status == "received"
      assert event.kind == "received"
      assert event.actor_id == ctx.user.id
    end

    test "expected → canceled via canceled event", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "expected")

      assert {:ok, %{status: "canceled"}} =
               Lifecycle.record_event(lot, "canceled", actor_attrs(ctx.user, reason: "vendor pulled out"))
    end

    test "received → quarantine via routed_to_quarantine", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "received")

      assert {:ok, %{status: "quarantine"}} =
               Lifecycle.record_event(lot, "routed_to_quarantine", actor_attrs(ctx.user))
    end

    test "received → available via qc_passed", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "received")

      assert {:ok, %{status: "available"}} =
               Lifecycle.record_event(lot, "qc_passed", actor_attrs(ctx.user))
    end

    test "available → on_hold via held", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "received")
      {:ok, _} = Lifecycle.record_event(lot, "qc_passed", actor_attrs(ctx.user))
      lot = Repo.reload!(lot)

      assert {:ok, %{status: "on_hold"}} =
               Lifecycle.record_event(lot, "held", actor_attrs(ctx.user, reason: "vendor recall"))
    end

    test "on_hold → available via released", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "received")
      {:ok, _} = Lifecycle.record_event(lot, "qc_passed", actor_attrs(ctx.user))
      lot = Repo.reload!(lot)
      {:ok, _} = Lifecycle.record_event(lot, "held", actor_attrs(ctx.user, reason: "vendor recall"))
      lot = Repo.reload!(lot)

      assert {:ok, %{status: "available"}} =
               Lifecycle.record_event(lot, "released", actor_attrs(ctx.user, reason: "false alarm"))
    end

    test "received → rejected via qc_failed", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "received")

      assert {:ok, %{status: "rejected"}} =
               Lifecycle.record_event(lot, "qc_failed", actor_attrs(ctx.user, reason: "Salmonella detected"))
    end

    test "rejected → disposed", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "rejected")

      assert {:ok, %{status: "disposed"}} =
               Lifecycle.record_event(lot, "disposed", actor_attrs(ctx.user, reason: "incinerated"))
    end

    test "available → depleted via consumed_to_zero", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "available")

      assert {:ok, %{status: "depleted"}} =
               Lifecycle.record_event(lot, "consumed_to_zero", actor_attrs(ctx.user))
    end
  end

  describe "record_event/3 — illegal transitions" do
    setup :setup_world

    test "rejected → qc_passed is forbidden (no un-fail)", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "rejected")

      assert {:error, :illegal_transition, info} =
               Lifecycle.record_event(lot, "qc_passed", actor_attrs(ctx.user))

      assert info.from == "rejected"
      assert info.kind == "qc_passed"
      assert "disposed" in info.allowed
      refute "qc_passed" in info.allowed
    end

    test "disposed accepts no further events", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "disposed")

      assert {:error, :illegal_transition, %{allowed: []}} =
               Lifecycle.record_event(lot, "received", actor_attrs(ctx.user))
    end

    test "canceled accepts no further events", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "canceled")

      assert {:error, :illegal_transition, %{allowed: []}} =
               Lifecycle.record_event(lot, "qc_passed", actor_attrs(ctx.user))
    end

    test "depleted accepts no further events", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "depleted")

      assert {:error, :illegal_transition, %{allowed: []}} =
               Lifecycle.record_event(lot, "qc_passed", actor_attrs(ctx.user))
    end

    test "available → received is forbidden (you can't re-receive)", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "available")

      assert {:error, :illegal_transition, _} =
               Lifecycle.record_event(lot, "received", actor_attrs(ctx.user))
    end

    test "quarantine → received is forbidden", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "quarantine")

      assert {:error, :illegal_transition, _} =
               Lifecycle.record_event(lot, "received", actor_attrs(ctx.user))
    end

    test "available → released is a no-op (it's already available)", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "available")

      assert {:error, :illegal_transition, info} =
               Lifecycle.record_event(lot, "released", actor_attrs(ctx.user))

      refute "released" in info.allowed
    end
  end

  describe "record_event/3 — full matrix coverage" do
    setup :setup_world

    # Walk every (from, kind) cell in the matrix. Allowed pairs must
    # succeed; disallowed pairs must reject with the structured error.
    @all_statuses ~w(expected requested received quarantine available
                     on_hold depleted disposed rejected canceled)
    @all_kinds ~w(expected requested received routed_to_quarantine qc_passed
                  qc_failed held released disposed consumed_to_zero canceled)

    test "every cell behaves per the matrix", ctx do
      allowed = Lifecycle.allowed_transitions()

      for from <- @all_statuses, kind <- @all_kinds do
        lot = lot_at_status(ctx.company, ctx.item, ctx.uom, from)
        expected_allowed = kind in Map.get(allowed, from, [])

        result = Lifecycle.record_event(lot, kind, actor_attrs(ctx.user))

        if expected_allowed do
          assert match?({:ok, %{event: %LotEvent{}}}, result),
                 "expected (#{from} + #{kind}) to succeed, got #{inspect(result)}"
        else
          assert match?({:error, :illegal_transition, _}, result),
                 "expected (#{from} + #{kind}) to be rejected, got #{inspect(result)}"
        end
      end
    end
  end

  # ----- event log invariants -------------------------------------

  describe "event log integrity" do
    setup :setup_world

    test "every allowed event inserts exactly one row", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "received")

      before = Repo.aggregate(LotEvent, :count, :id)
      {:ok, _} = Lifecycle.record_event(lot, "qc_passed", actor_attrs(ctx.user))
      assert Repo.aggregate(LotEvent, :count, :id) == before + 1
    end

    test "illegal transitions write no event row", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "disposed")

      before = Repo.aggregate(LotEvent, :count, :id)
      assert {:error, :illegal_transition, _} =
               Lifecycle.record_event(lot, "received", actor_attrs(ctx.user))
      assert Repo.aggregate(LotEvent, :count, :id) == before
    end

    test "user-recorded events require an actor", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "received")

      assert {:error, %Ecto.Changeset{} = cs} =
               Lifecycle.record_event(lot, "qc_passed", %{actor_kind: "user"})

      assert "is required for user-recorded events" in errors_on(cs).actor_id
    end

    test "system events don't require an actor", ctx do
      lot = lot_at_status(ctx.company, ctx.item, ctx.uom, "expected")

      assert {:ok, %{event: %LotEvent{actor_id: nil, actor_kind: "system"}}} =
               Lifecycle.record_event(lot, "received", %{actor_kind: "system"})
    end
  end

  # ----- helpers ---------------------------------------------------

  defp event(kind, opts \\ []) do
    %LotEvent{
      kind: kind,
      occurred_at:
        case Keyword.get(opts, :at) do
          nil -> DateTime.utc_now()
          n when is_integer(n) ->
            DateTime.utc_now() |> DateTime.add(n, :second)
        end,
      inserted_at: DateTime.utc_now(),
      id: System.unique_integer([:positive])
    }
  end

  defp actor_attrs(user, opts \\ []) do
    %{
      actor: user,
      actor_kind: "user",
      reason: Keyword.get(opts, :reason),
      metadata: Keyword.get(opts, :metadata, %{})
    }
  end
end
