defmodule Backend.Warehouses.ReturnPickup do
  @moduledoc """
  Warehouse-side return pickup — Phase C of the production lifecycle.
  After production closeout (`Backend.Production.closeout_*`) parks
  lots at production-side dispatch cells, a warehouse worker walks
  those cells, scans each lot onto a trolley, then places every lot
  back into warehouse storage on a scanned target rack.

  No movements are emitted at pick-to-trolley time — the lot stays
  logically at the dispatch cell until the worker scans the target
  warehouse cell. The trolley state is held in
  `Backend.Warehouses.ReturnPick` rows so it survives reloads and the
  partial unique index stops two workers claiming the same lot.

  Endpoints driving this:
    * `GET /api/m/return-pickup-queue` → `list_queue/1`
    * `GET /api/m/return-pickup/:mo_uuid` → `get_detail/2`
    * `POST /api/m/return-pickup/lots/:lot_uuid/pick` → `pick_to_trolley/3`
    * `POST /api/m/return-pickup/picks/:pick_uuid/place` → `place_from_trolley/3`
    * `POST /api/m/return-pickup/picks/:pick_uuid/abort` → `abort_pick/2`
  """

  import Ecto.Query
  alias Backend.Accounts.User
  alias Backend.Production.{ManufacturingOrder, ManufacturingOrderBooking}
  alias Backend.Repo
  alias Backend.Stock
  alias Backend.Stock.{Lot, Placement}
  alias Backend.Warehouses.{ReturnPick, StorageCell}

  # ----- Queue + detail loaders --------------------------------

  # Production-side cells the return-pickup flow pulls lots OUT of.
  # `dispatch` is the leftover-after-consume handoff target;
  # `production_feed` is where the picker walked stock TO for an
  # active run, and any lot stranded there after the run aborted /
  # regressed is also a return-pickup candidate.
  @return_pickup_purposes ~w(dispatch production_feed)

  @doc """
  Mobile queue. Lists every MO that has at least one lot sitting at
  a production-side dispatch or production-feed cell and not already
  claimed by an open trolley pick. Sorted by oldest closeout finish
  first so the most stale handoff bubbles to the top.
  """
  def list_queue(company_id) when is_integer(company_id) do
    open_picks_subq =
      from(rp in ReturnPick,
        where: rp.company_id == ^company_id and is_nil(rp.placed_at),
        select: rp.stock_lot_id
      )

    # MOs that still owe booking closeout (the per-booking consume +
    # leftover routing step). Return-pickup MUST wait for these to
    # finish — otherwise the warehouse picker walks back only the
    # produced outputs and leaves the dispatch pile orphaned on the
    # production side. Both stages can't be "active" on the same MO.
    mos_with_pending_closeout =
      from(b in ManufacturingOrderBooking,
        where:
          b.company_id == ^company_id and
            b.status == "requested" and
            is_nil(b.consumed_at),
        distinct: true,
        select: b.manufacturing_order_id
      )

    # MOs whose produced output (source_kind=manufacturing_order)
    # still sits at a production-side cell.
    output_mos =
      from(p in Placement,
        join: l in Lot,
        on: l.id == p.stock_lot_id,
        join: c in StorageCell,
        on: c.id == p.storage_cell_id,
        join: m in ManufacturingOrder,
        on: fragment("?::text", m.uuid) == l.source_ref,
        where:
          l.company_id == ^company_id and
            l.source_kind == "manufacturing_order" and
            l.status == "available" and
            p.qty > 0 and
            c.purpose in @return_pickup_purposes and
            l.id not in subquery(open_picks_subq) and
            m.id not in subquery(mos_with_pending_closeout),
        distinct: true,
        select: m.id
      )

    # MOs whose booked ingredient lots (raw_material / packaging)
    # have leftover qty sitting at a production-side cell after
    # closeout's partial-consume hand-off. The booking row gives us
    # the MO back-link even though the lot's own source_kind points
    # at the original PO / manual receive.
    ingredient_mos =
      from(b in ManufacturingOrderBooking,
        join: p in Placement,
        on: p.stock_lot_id == b.stock_lot_id,
        join: c in StorageCell,
        on: c.id == p.storage_cell_id,
        join: l in Lot,
        on: l.id == p.stock_lot_id,
        where:
          b.company_id == ^company_id and
            not is_nil(b.consumed_at) and
            l.status == "available" and
            p.qty > 0 and
            c.purpose in @return_pickup_purposes and
            l.id not in subquery(open_picks_subq) and
            b.manufacturing_order_id not in subquery(mos_with_pending_closeout),
        distinct: true,
        select: b.manufacturing_order_id
      )

    from(mo in ManufacturingOrder,
      where:
        mo.company_id == ^company_id and
          mo.status == "completed" and
          mo.id not in subquery(mos_with_pending_closeout) and
          (mo.id in subquery(output_mos) or mo.id in subquery(ingredient_mos)),
      preload: [:item, :warehouse, :production_cell],
      order_by: [asc: mo.actual_finish, asc: mo.id]
    )
    |> Repo.all()
  end

  @doc """
  Lots sitting at a production-side cell (dispatch or production-feed)
  that aren't tied to a completed MO card. Two main shapes:

    * Leftover raw materials handed off after a partial consume on a
      completed MO — the consumed booking lives elsewhere so the lot
      ends up here instead of under that MO's card.
    * Lots stranded at production-feed by a picker walking them onto
      the line for a run that never started / was regressed. The
      booking is still `requested` (no consumed_at) so the per-MO
      card doesn't catch them; without this bucket they were
      invisible to the warehouse worker even though the schedule
      release-blocker correctly flagged them.
  """
  def list_loose_dispatch_lots(company_id) when is_integer(company_id) do
    open_picks_subq =
      from(rp in ReturnPick,
        where: rp.company_id == ^company_id and is_nil(rp.placed_at),
        select: rp.stock_lot_id
      )

    # Lots that are referenced by a consumed MO booking — those have
    # an MO home and surface under their MO card, not in the loose
    # bucket.
    booked_lot_ids_subq =
      from(b in ManufacturingOrderBooking,
        where:
          b.company_id == ^company_id and
            not is_nil(b.consumed_at),
        select: b.stock_lot_id
      )

    from(l in Lot,
      join: p in Placement,
      on: p.stock_lot_id == l.id,
      join: c in StorageCell,
      on: c.id == p.storage_cell_id,
      where:
        l.company_id == ^company_id and
          l.source_kind != "manufacturing_order" and
          l.status == "available" and
          p.qty > 0 and
          c.purpose in @return_pickup_purposes and
          l.id not in subquery(open_picks_subq) and
          l.id not in subquery(booked_lot_ids_subq),
      preload: [
        :item,
        :unit_of_measurement,
        placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
      ],
      distinct: true
    )
    |> Repo.all()
  end

  @doc """
  Per-MO detail. Returns the lots still at dispatch (un-claimed) plus
  the trolley rows belonging to the current actor. Other workers'
  trolley rows are filtered out so the UI shows a clean "your trolley"
  state.
  """
  def get_detail(%User{} = actor, mo_uuid) when is_binary(mo_uuid) do
    case Repo.get_by(ManufacturingOrder,
           company_id: actor.company_id,
           uuid: mo_uuid
         ) do
      nil ->
        nil

      mo ->
        open_picks_subq =
          from(rp in ReturnPick,
            where: rp.company_id == ^actor.company_id and is_nil(rp.placed_at),
            select: rp.stock_lot_id
          )

        # Lots tied to this MO that are sitting at a dispatch cell.
        # Two sources:
        #   1. Produced output — lots whose own source_ref == mo.uuid
        #   2. Ingredient remainders — lots referenced by an MO booking
        #      whose consumed_at is set (closeout already handed them off)
        ingredient_lot_ids =
          from(b in ManufacturingOrderBooking,
            where:
              b.manufacturing_order_id == ^mo.id and
                not is_nil(b.consumed_at),
            select: b.stock_lot_id
          )
          |> Repo.all()

        lots_at_dispatch =
          from(l in Lot,
            join: p in Placement,
            on: p.stock_lot_id == l.id,
            join: c in StorageCell,
            on: c.id == p.storage_cell_id,
            where:
              l.company_id == ^actor.company_id and
                l.status == "available" and
                p.qty > 0 and
                c.purpose in @return_pickup_purposes and
                l.id not in subquery(open_picks_subq) and
                ((l.source_kind == "manufacturing_order" and
                    l.source_ref == ^mo_uuid) or
                   l.id in ^ingredient_lot_ids),
            preload: [
              :item,
              :unit_of_measurement,
              placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]
            ],
            distinct: true
          )
          |> Repo.all()

        # All open trolley rows in the company — partitioned into
        # "yours" (actionable: place/abort) and "others" (read-only:
        # who else is moving stock right now, so the team can
        # coordinate without stepping on each other).
        all_trolley = list_open_trolley(actor.company_id)
        {mine, others} = Enum.split_with(all_trolley, &(&1.picked_by_id == actor.id))

        %{
          mo: mo,
          lots_at_dispatch: lots_at_dispatch,
          trolley: mine,
          trolley_others: others,
          last_photo_urls:
            last_photo_url_map(
              actor.company_id,
              lots_at_dispatch ++
                Enum.map(mine ++ others, & &1.stock_lot)
            )
        }
    end
  end

  defp list_open_trolley(company_id) do
    from(rp in ReturnPick,
      where: rp.company_id == ^company_id and is_nil(rp.placed_at),
      preload: [
        :picked_by,
        :picked_from_cell,
        stock_lot: [:item, :unit_of_measurement]
      ],
      order_by: [asc: rp.picked_at]
    )
    |> Repo.all()
  end

  @doc """
  Loose dispatch detail — same shape as `get_detail/2` but for the
  "no specific MO" bucket. mo is nil.
  """
  def get_loose_detail(%User{} = actor) do
    lots = list_loose_dispatch_lots(actor.company_id)
    all_trolley = list_open_trolley(actor.company_id)
    {mine, others} = Enum.split_with(all_trolley, &(&1.picked_by_id == actor.id))

    %{
      mo: nil,
      lots_at_dispatch: lots,
      trolley: mine,
      trolley_others: others,
      last_photo_urls:
        last_photo_url_map(
          actor.company_id,
          lots ++ Enum.map(mine ++ others, & &1.stock_lot)
        )
    }
  end

  defp last_photo_url_map(company_id, lots_or_nils) do
    ids =
      lots_or_nils
      |> Enum.flat_map(fn
        %Lot{id: id} -> [id]
        _ -> []
      end)
      |> Enum.uniq()

    Stock.last_photo_url_by_lot_ids(company_id, ids)
  end

  # ----- Actions ----------------------------------------------------

  @doc """
  Storage-cell recommendations for a trolley row's lot. Wraps
  `Backend.Stock.list_move_recommendations/3` — same tag-match +
  dimension-fit + consolidation scoring the PO/move flows use — so
  the warehouse worker isn't asked to remember which rack a lot
  belongs on. Filters out the dispatch cell the lot came from
  (it's already excluded by the source-cell filter inside the
  recommender, since the lot's open placement IS the dispatch cell).
  """
  def list_place_recommendations(%User{} = actor, pick_uuid, opts \\ [])
      when is_binary(pick_uuid) do
    with {:ok, pick} <- fetch_pick(pick_uuid),
         :ok <- ensure_actor_owns_pick(actor, pick),
         :ok <- ensure_not_placed(pick) do
      lot = Repo.get!(Lot, pick.stock_lot_id)
      {:ok, Backend.Stock.list_move_recommendations(actor.company_id, lot.uuid, opts)}
    end
  end

  @doc """
  Scan a lot off a dispatch cell onto the worker's trolley.

  Inputs:
    * `lot_uuid` — the lot being scanned
    * `attrs["scanned_cell_uuid"]` — the dispatch cell the worker scanned
    * `attrs["photo_url"]` — optional photo of the lot on the trolley

  Inserts a `warehouse_return_picks` row. No placement movement yet —
  the lot stays logically at the dispatch cell until placement.

  Error tuples: `:lot_not_found | :cell_not_found |
  :not_a_dispatch_cell | :lot_not_at_scanned_cell | :already_on_trolley |
  :lot_unavailable`.
  """
  def pick_to_trolley(%User{} = actor, lot_uuid, attrs)
      when is_binary(lot_uuid) and is_map(attrs) do
    with {:ok, lot} <- fetch_lot(actor.company_id, lot_uuid),
         :ok <- ensure_status_available(lot),
         {:ok, cell} <- fetch_cell(actor.company_id, attrs["scanned_cell_uuid"]),
         :ok <- ensure_dispatch_cell(cell),
         {:ok, placement} <- ensure_lot_on_cell(lot, cell),
         :ok <- ensure_no_open_pick(actor.company_id, lot.id) do
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      %ReturnPick{}
      |> ReturnPick.pick_changeset(%{
        company_id: actor.company_id,
        stock_lot_id: lot.id,
        picked_from_cell_id: cell.id,
        picked_by_id: actor.id,
        picked_at: now,
        picked_photo_url: attrs["photo_url"],
        qty: placement.qty
      })
      |> Repo.insert()
      |> case do
        {:ok, pick} ->
          {:ok, Repo.preload(pick, [
            :picked_from_cell,
            stock_lot: [:item, :unit_of_measurement]
          ])}

        {:error, %Ecto.Changeset{} = cs} ->
          {:error, cs}
      end
    end
  end

  @doc """
  Place a lot from the trolley into a scanned warehouse cell. Runs
  `Backend.Stock.move_placement/3` to emit the real placement
  movement carrying the photo, then stamps the pick row's `placed_*`
  fields.

  Inputs:
    * `pick_uuid` — the open trolley row
    * `attrs["scanned_cell_uuid"]` — the destination cell QR
    * `attrs["photo_url"]` — place-down photo (recommended)

  Error tuples: `:pick_not_found | :forbidden | :already_placed |
  :cell_not_found | :destination_invalid | :same_cell |
  {:move_failed, reason}`.
  """
  def place_from_trolley(%User{} = actor, pick_uuid, attrs)
      when is_binary(pick_uuid) and is_map(attrs) do
    with {:ok, pick} <- fetch_pick(pick_uuid),
         :ok <- ensure_actor_owns_pick(actor, pick),
         :ok <- ensure_not_placed(pick),
         {:ok, to_cell} <-
           fetch_cell(actor.company_id, attrs["scanned_cell_uuid"]),
         :ok <- ensure_placeable_cell(to_cell),
         :ok <- ensure_not_same_cell(pick.picked_from_cell_id, to_cell.id),
         {:ok, lot} <- fetch_lot_with_uuid(pick.stock_lot_id) do
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      Repo.transaction(fn ->
        case Stock.move_placement(actor, lot.uuid, %{
               "from_cell_uuid" => cell_uuid_for(pick.picked_from_cell_id),
               "to_cell_uuid" => to_cell.uuid,
               "qty" => Decimal.to_string(pick.qty),
               "photo_url" => attrs["photo_url"],
               "skip_photo_reason" => attrs["skip_photo_reason"]
             }) do
          {:ok, _lot} ->
            pick
            |> ReturnPick.place_changeset(%{
              placed_at: now,
              placed_by_id: actor.id,
              placed_to_cell_id: to_cell.id,
              placed_photo_url: attrs["photo_url"]
            })
            |> Repo.update()
            |> case do
              {:ok, updated} ->
                Repo.preload(updated, [
                  :picked_from_cell,
                  :placed_to_cell,
                  stock_lot: [:item, :unit_of_measurement]
                ])

              {:error, cs} ->
                Repo.rollback(cs)
            end

          {:error, %Ecto.Changeset{} = cs} ->
            Repo.rollback({:move_failed, cs})

          {:error, reason} ->
            Repo.rollback({:move_failed, reason})
        end
      end)
    end
  end

  @doc """
  Cancel a trolley row without placing the lot. The lot stays at the
  dispatch cell (no placement was ever moved) and another worker can
  claim it.
  """
  def abort_pick(%User{} = actor, pick_uuid) when is_binary(pick_uuid) do
    with {:ok, pick} <- fetch_pick(pick_uuid),
         :ok <- ensure_actor_owns_pick(actor, pick),
         :ok <- ensure_not_placed(pick) do
      Repo.delete(pick)
    end
  end

  # ----- Helpers ----------------------------------------------------

  defp fetch_lot(company_id, uuid) when is_binary(uuid) and uuid != "" do
    case Repo.get_by(Lot, company_id: company_id, uuid: uuid) do
      nil -> {:error, :lot_not_found}
      lot -> {:ok, lot}
    end
  end

  defp fetch_lot(_, _), do: {:error, :lot_not_found}

  defp fetch_lot_with_uuid(id) do
    case Repo.get(Lot, id) do
      nil -> {:error, :lot_not_found}
      lot -> {:ok, lot}
    end
  end

  defp fetch_cell(company_id, uuid) when is_binary(uuid) and uuid != "" do
    case Repo.get_by(StorageCell, company_id: company_id, uuid: uuid) do
      nil -> {:error, :cell_not_found}
      cell -> {:ok, cell}
    end
  end

  defp fetch_cell(_, _), do: {:error, :cell_not_found}

  defp fetch_pick(uuid) when is_binary(uuid) and uuid != "" do
    case Repo.get_by(ReturnPick, uuid: uuid) do
      nil -> {:error, :pick_not_found}
      pick -> {:ok, Repo.preload(pick, [:picked_from_cell, :stock_lot])}
    end
  end

  defp fetch_pick(_), do: {:error, :pick_not_found}

  defp ensure_status_available(%Lot{status: "available"}), do: :ok
  defp ensure_status_available(_), do: {:error, :lot_unavailable}

  defp ensure_dispatch_cell(%StorageCell{purpose: purpose})
       when purpose in @return_pickup_purposes,
       do: :ok

  defp ensure_dispatch_cell(_), do: {:error, :not_a_dispatch_cell}

  defp ensure_lot_on_cell(%Lot{id: lot_id}, %StorageCell{id: cell_id}) do
    case Repo.get_by(Placement, stock_lot_id: lot_id, storage_cell_id: cell_id) do
      nil ->
        {:error, :lot_not_at_scanned_cell}

      %Placement{qty: qty} = p ->
        if Decimal.compare(qty, Decimal.new(0)) == :gt do
          {:ok, p}
        else
          {:error, :lot_not_at_scanned_cell}
        end
    end
  end

  defp ensure_no_open_pick(company_id, lot_id) do
    exists? =
      Repo.exists?(
        from(rp in ReturnPick,
          where:
            rp.company_id == ^company_id and
              rp.stock_lot_id == ^lot_id and
              is_nil(rp.placed_at)
        )
      )

    if exists?, do: {:error, :already_on_trolley}, else: :ok
  end

  defp ensure_actor_owns_pick(%User{id: actor_id, company_id: cid}, %ReturnPick{
         picked_by_id: pid,
         company_id: pc
       }) do
    if actor_id == pid and cid == pc, do: :ok, else: {:error, :forbidden}
  end

  defp ensure_not_placed(%ReturnPick{placed_at: nil}), do: :ok
  defp ensure_not_placed(_), do: {:error, :already_placed}

  defp ensure_placeable_cell(%StorageCell{purpose: purpose})
       when purpose in ["regular", "quarantine"] do
    # Returned lots are already "available" — they came back from
    # production with status=available (QC passed). Routing them to
    # a regular cell is the default; a quarantine cell is also OK
    # when the warehouse wants to re-inspect on the way in.
    :ok
  end

  defp ensure_placeable_cell(_), do: {:error, :destination_invalid}

  defp ensure_not_same_cell(from_id, to_id) when from_id == to_id,
    do: {:error, :same_cell}

  defp ensure_not_same_cell(_, _), do: :ok

  defp cell_uuid_for(cell_id) do
    Repo.get!(StorageCell, cell_id).uuid
  end
end
