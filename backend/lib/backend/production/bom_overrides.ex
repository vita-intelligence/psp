defmodule Backend.Production.BOMOverrides do
  @moduledoc """
  Per-MO BOM override service.

  The master BOM stays untouched; each override records a `remove`,
  `qty_change`, or `add` that layers on top when the effective BOM
  is projected for parts display, booking, and the release-time
  shortage gate.

  Statuses eligible for edits: `draft` and `prepared`. Once the MO
  is approved the deltas freeze so downstream planning + bookings
  can't shift under the operator's feet. A planner who needs to
  amend an approved MO takes it back to draft (existing flow) and
  edits from there.
  """

  import Ecto.Query, warn: false

  alias Backend.Audit
  alias Backend.Production
  alias Backend.Production.{BOMLine, ManufacturingOrder, MOBOMOverride}
  alias Backend.Repo

  @editable_statuses ~w(draft prepared)

  @doc """
  Every override attached to the given MO id. Loads the FK'd
  bom_line + part so the projection doesn't have to re-hit the DB.
  """
  def list_for_mo(mo_id) when is_integer(mo_id) do
    from(o in MOBOMOverride,
      where: o.manufacturing_order_id == ^mo_id,
      preload: [:bom_line, :part, :unit_of_measurement, :created_by],
      order_by: [asc: o.inserted_at, asc: o.id]
    )
    |> Repo.all()
  end

  @doc """
  True when the MO can accept new overrides (draft or prepared).
  Approved / scheduled / running / done MOs freeze their effective
  BOM so downstream bookings can't shift.
  """
  def editable?(%ManufacturingOrder{status: s}), do: s in @editable_statuses
  def editable?(_), do: false

  @doc """
  Apply an override. Dispatches on `attrs[:action]`.

    * `"removed"`      — needs `bom_line_id`, `reason` (non-blank).
    * `"qty_changed"`  — needs `bom_line_id`, `to_qty` (> 0).
    * `"added"`        — needs `item_id`, `to_qty`, optionally
      `unit_of_measurement_id` + `is_fixed`.

  Returns `{:ok, override}` on success, `{:error, :mo_locked}` when
  the MO is past editable status, or `{:error, changeset}` for
  validation failures. Idempotent on updates: an override already
  exists for the target line? we update it in place rather than
  raising a uniqueness error. That keeps repeated "nudge the qty"
  clicks well-behaved without asking the FE to disambiguate
  create-vs-update.
  """
  def apply_override(actor, %ManufacturingOrder{} = mo, attrs) do
    if editable?(mo) do
      normalised = normalise_attrs(attrs)

      # Same-txn rebook: the just-persisted override MUST propagate
      # to the bookings snapshot before pickup / preflight / closeout
      # can observe stale line items. Without this, `added` shows up
      # with zero bookings, `removed` still lists the dropped part,
      # and `qty_changed` picks the pre-edit qty.
      Repo.transaction(fn ->
        with {:ok, override} <- do_apply(actor, mo, normalised),
             {:ok, _} <- sync_bookings_for_override(actor, mo, override) do
          override
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    else
      {:error, :mo_locked}
    end
  end

  defp do_apply(actor, mo, %{"action" => "removed", "bom_line_id" => line_id} = attrs) do
    with {:ok, line} <- fetch_line(line_id, mo),
         base_attrs <- %{
           "company_id" => mo.company_id,
           "manufacturing_order_id" => mo.id,
           "bom_line_id" => line.id,
           "action" => "removed",
           "from_qty" => line.qty,
           "reason" => Map.get(attrs, "reason"),
           "created_by_id" => actor && actor.id
         } do
      upsert_by_line(actor, mo, line_id, base_attrs)
    end
  end

  defp do_apply(
         actor,
         mo,
         %{"action" => "qty_changed", "bom_line_id" => line_id, "to_qty" => new_qty} = _attrs
       ) do
    with {:ok, line} <- fetch_line(line_id, mo),
         base_attrs <- %{
           "company_id" => mo.company_id,
           "manufacturing_order_id" => mo.id,
           "bom_line_id" => line.id,
           "action" => "qty_changed",
           "from_qty" => line.qty,
           "to_qty" => new_qty,
           "created_by_id" => actor && actor.id
         } do
      upsert_by_line(actor, mo, line_id, base_attrs)
    end
  end

  defp do_apply(
         actor,
         mo,
         %{"action" => "added", "item_id" => item_id, "to_qty" => new_qty} = attrs
       ) do
    base_attrs = %{
      "company_id" => mo.company_id,
      "manufacturing_order_id" => mo.id,
      "item_id" => item_id,
      "action" => "added",
      "to_qty" => new_qty,
      "unit_of_measurement_id" => Map.get(attrs, "unit_of_measurement_id"),
      "is_fixed" => Map.get(attrs, "is_fixed", false),
      "created_by_id" => actor && actor.id
    }

    existing =
      from(o in MOBOMOverride,
        where:
          o.manufacturing_order_id == ^mo.id and
            is_nil(o.bom_line_id) and
            o.item_id == ^item_id
      )
      |> Repo.one()

    insert_or_update(actor, mo, existing, base_attrs)
  end

  defp do_apply(_actor, _mo, _attrs), do: {:error, :invalid_shape}

  defp fetch_line(line_id, %ManufacturingOrder{bom_id: bom_id, company_id: company_id})
       when is_integer(line_id) and is_integer(bom_id) do
    line =
      from(l in BOMLine,
        where: l.id == ^line_id and l.bom_id == ^bom_id and l.company_id == ^company_id
      )
      |> Repo.one()

    case line do
      nil -> {:error, :bom_line_not_found}
      %BOMLine{} = l -> {:ok, l}
    end
  end

  defp fetch_line(_, _), do: {:error, :bom_line_not_found}

  defp upsert_by_line(actor, mo, line_id, attrs) do
    existing =
      from(o in MOBOMOverride,
        where: o.manufacturing_order_id == ^mo.id and o.bom_line_id == ^line_id
      )
      |> Repo.one()

    insert_or_update(actor, mo, existing, attrs)
  end

  defp insert_or_update(actor, _mo, nil, attrs) do
    changeset = MOBOMOverride.changeset(%MOBOMOverride{}, attrs)

    case Repo.insert(changeset) do
      {:ok, ov} ->
        Audit.record_created(actor, "mo_bom_override", ov, audit_snapshot(ov))
        {:ok, ov}

      {:error, cs} ->
        {:error, cs}
    end
  end

  defp insert_or_update(actor, _mo, %MOBOMOverride{} = existing, attrs) do
    before_snap = audit_snapshot(existing)
    changeset = MOBOMOverride.changeset(existing, attrs)

    case Repo.update(changeset) do
      {:ok, ov} ->
        Audit.record_updated(actor, "mo_bom_override", ov, before_snap, audit_snapshot(ov))
        {:ok, ov}

      {:error, cs} ->
        {:error, cs}
    end
  end

  @doc """
  Hard-delete an override. Effective BOM immediately collapses back
  to the master row (for removed / qty_changed) or drops the extra
  part entirely (for added). Same editable-status gate as apply.
  """
  def revert(actor, %ManufacturingOrder{} = mo, override_uuid) when is_binary(override_uuid) do
    if editable?(mo) do
      case Repo.get_by(MOBOMOverride, uuid: override_uuid, manufacturing_order_id: mo.id) do
        nil ->
          {:error, :not_found}

        %MOBOMOverride{} = ov ->
          # Reverting an override collapses the effective BOM for the
          # affected part back to master. Bookings for that part need
          # to be re-synced in the SAME txn so pickup sees the master
          # line (removed comes back; qty_changed goes to master qty;
          # added disappears).
          Repo.transaction(fn ->
            with {:ok, deleted} <- do_delete(actor, ov),
                 {:ok, _} <- sync_bookings_for_override(actor, mo, deleted) do
              deleted
            else
              {:error, reason} -> Repo.rollback(reason)
            end
          end)
      end
    else
      {:error, :mo_locked}
    end
  end

  defp do_delete(actor, %MOBOMOverride{} = ov) do
    case Repo.delete(ov) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "mo_bom_override", deleted, audit_snapshot(deleted))
        {:ok, deleted}

      {:error, cs} ->
        {:error, cs}
    end
  end

  # Booking sync after an override is applied OR reverted. The
  # `item_id` (part) whose bookings need to be re-run is derived
  # from the override row itself:
  #
  #   * `added`      — `item_id` is on the override.
  #   * `removed` /
  #     `qty_changed` — `bom_line_id` is on the override; look up the
  #                     master line's `part_id`.
  #
  # `Production.sync_line_bookings/3` deletes existing `requested`
  # bookings for that part then re-runs FEFO booking against the
  # CURRENT effective BOM (which reflects the post-apply / post-revert
  # override set). Rebook results are ignored — the effective BOM +
  # picker screen already surface partial fulfilment.
  defp sync_bookings_for_override(actor, mo, %MOBOMOverride{action: "added", item_id: item_id})
       when is_integer(item_id) do
    Production.sync_line_bookings(actor, mo, item_id)
  end

  defp sync_bookings_for_override(actor, mo, %MOBOMOverride{bom_line_id: bom_line_id})
       when is_integer(bom_line_id) do
    case Repo.one(from l in BOMLine, where: l.id == ^bom_line_id, select: l.part_id) do
      nil -> {:ok, []}
      item_id -> Production.sync_line_bookings(actor, mo, item_id)
    end
  end

  defp sync_bookings_for_override(_actor, _mo, _override), do: {:ok, []}

  @doc """
  Apply the overrides to a preloaded list of master BOM lines +
  return the effective set the parts view / booking loop should use.

  Each returned line is either:

    * a raw `%BOMLine{}` (untouched), possibly with `:qty` replaced
      when a `qty_changed` override applies, plus virtual
      `:override_uuid`, `:override_action`, `:override_from_qty`, and
      `:override_reason` fields for the projection to render badges
      / dim rows.
    * a synthetic `%BOMLine{id: -override.id}` for `added` overrides
      — carries the same virtual override fields so the projection
      code can treat additions uniformly.

  Removed lines are simply dropped from the returned list. Master
  order (`sort_order`) is preserved for surviving lines; added
  lines land at the end in override insertion order.
  """
  def apply_to_lines(lines, overrides) when is_list(lines) and is_list(overrides) do
    by_line_id =
      overrides
      |> Enum.filter(& &1.bom_line_id)
      |> Map.new(&{&1.bom_line_id, &1})

    additions = Enum.filter(overrides, &is_nil(&1.bom_line_id))

    base =
      lines
      |> Enum.flat_map(fn line ->
        case Map.get(by_line_id, line.id) do
          nil ->
            [attach_override(line, nil)]

          %MOBOMOverride{action: "removed"} ->
            # Skip — the parts view will render this via the "removed"
            # overrides list separately (see :removed_overrides).
            []

          %MOBOMOverride{action: "qty_changed", to_qty: new_qty} = ov ->
            [attach_override(%{line | qty: new_qty}, ov)]
        end
      end)

    added_lines =
      additions
      |> Enum.map(&synthesise_added_line/1)

    base ++ added_lines
  end

  @doc """
  Every `removed` override on the MO, with its FK'd BOM line
  preloaded so the parts view can render "removed" ghost rows for
  transparency ("here's what the master says you'd normally book;
  {name} removed it because ...").
  """
  def removed_lines(overrides) when is_list(overrides) do
    Enum.filter(overrides, &(&1.action == "removed"))
  end

  # Virtual fields set on the line struct so the parts payload can
  # render override state without walking the overrides list again.
  defp attach_override(line, override) do
    line
    |> Map.put(:__override__, override)
  end

  defp synthesise_added_line(%MOBOMOverride{} = ov) do
    # Negative synthetic id so it never collides with real bom_lines
    # rows and the FE knows the row can't be edited-in-place through
    # the normal line endpoints.
    part =
      case ov.part do
        %Ecto.Association.NotLoaded{} -> nil
        p -> p
      end

    uom =
      case ov.unit_of_measurement do
        %Ecto.Association.NotLoaded{} -> nil
        u -> u
      end

    %BOMLine{
      id: -ov.id,
      uuid: ov.uuid,
      bom_id: nil,
      company_id: ov.company_id,
      part_id: ov.item_id,
      part: part,
      unit_of_measurement_id: ov.unit_of_measurement_id,
      unit_of_measurement: uom,
      qty: ov.to_qty,
      is_fixed: ov.is_fixed,
      sort_order: 10_000,
      notes: nil,
      inserted_at: ov.inserted_at,
      updated_at: ov.updated_at
    }
    |> Map.put(:__override__, ov)
  end

  defp audit_snapshot(%MOBOMOverride{} = ov) do
    %{
      uuid: ov.uuid,
      manufacturing_order_id: ov.manufacturing_order_id,
      bom_line_id: ov.bom_line_id,
      item_id: ov.item_id,
      action: ov.action,
      from_qty: ov.from_qty && Decimal.to_string(ov.from_qty),
      to_qty: ov.to_qty && Decimal.to_string(ov.to_qty),
      is_fixed: ov.is_fixed,
      reason: ov.reason
    }
  end

  defp normalise_attrs(attrs) when is_map(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} -> {k, v}
    end)
  end
end
