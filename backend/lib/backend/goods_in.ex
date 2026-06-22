defmodule Backend.GoodsIn do
  @moduledoc """
  Boundary for the Goods-In Inspection workflow.

  Workflow:

      draft
        ↓ sign_operator  (goods-in operator fills 8 sections + signs)
      submitted
        ↓ sign_quality_approver
      approved | hold | rejected   (terminal)

  Quality approver MUST differ from the goods-in operator (segregation
  of duties). On `sign_quality_approver` with decision = approved, the
  service walks every lot tagged with this inspection's id and emits a
  per-lot lifecycle event:

    * Inspection-level `approved` AND per-line `accept`  → qc_passed
    * Inspection-level `approved` AND per-line `hold`    → stays in quarantine; the inspection_item.material_decision_reason IS the hold reason
    * Inspection-level `approved` AND per-line `reject`  → qc_failed
    * Inspection-level `hold`                            → no events (lots stay in quarantine)
    * Inspection-level `rejected`                        → qc_failed on every linked lot

  Compliance reference: BRCGS Issue 9 § 3.5.1 + FSSC 22000 § 7.1.6.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.GoodsIn.{Inspection, InspectionFile, InspectionItem}
  alias Backend.ListQueries
  alias Backend.Purchasing.{PurchaseOrder, PurchaseOrderLine}
  alias Backend.Repo
  alias Backend.Stock
  alias Backend.Stock.Lifecycle
  alias Backend.Storage

  @section_keys ~w(vehicle_inspection documentation_verification physical_inspection food_safety_checks storage_verification)a

  @file_uploadable_statuses ~w(draft submitted)
  @allowed_file_mimes ~w(application/pdf image/jpeg image/png image/webp image/heic)
  @max_file_bytes 20 * 1024 * 1024

  @inspection_sortable ~w(id delivery_date status inserted_at)a
  @inspection_search ~w(transport_company vehicle_registration seal_number)a
  @inspection_default_sort {:delivery_date, :desc}

  @inspection_statuses ~w(draft submitted approved hold rejected)

  # ----- list / get ------------------------------------------------

  def get(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(i in Inspection,
            where: i.company_id == ^company_id and i.uuid == ^cast,
            preload: [
              :purchase_order,
              :goods_in_operator,
              :quality_approver,
              :created_by,
              :updated_by,
              items: [:purchase_order_line],
              files: [:uploaded_by]
            ]
          )
        )

      :error ->
        nil
    end
  end

  def get(_, _), do: nil

  def list_for_po(company_id, po_id) when is_integer(po_id) do
    Repo.all(
      from(i in Inspection,
        where: i.company_id == ^company_id and i.purchase_order_id == ^po_id,
        order_by: [desc: i.delivery_date, desc: i.id],
        preload: [:goods_in_operator, :quality_approver]
      )
    )
  end

  @doc """
  Global "Inspections ledger" — paginated list of every inspection
  for the company, with PO, operator, and approver preloaded so the
  desktop ledger renders the row without a per-row fetch.

  Options:

    * `:cursor`, `:limit`, `:sort` — `ListQueries` standard
    * `:search` — substring against transport company / vehicle reg /
      seal number
    * `:status` — exact `draft | submitted | approved | hold | rejected`
    * `:purchase_order_id` — narrow to one PO (FK, not uuid)
    * `:from_date`, `:to_date` — `delivery_date` range
  """
  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = Keyword.get(opts, :sort, @inspection_default_sort)

    base =
      Inspection
      |> where([i], i.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @inspection_search)
      |> maybe_status_filter(opts[:status])
      |> maybe_po_filter(opts[:purchase_order_id])
      |> maybe_warehouse_filter(opts[:warehouse_id])
      |> maybe_date_range(opts[:from_date], opts[:to_date])
      |> maybe_actor_filter(opts[:actor_id])
      |> ListQueries.apply_sort(sort, @inspection_sortable, @inspection_default_sort)
      |> preload([:goods_in_operator, :quality_approver, purchase_order: :vendor])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_status_filter(query, nil), do: query
  defp maybe_status_filter(query, ""), do: query

  defp maybe_status_filter(query, status)
       when is_binary(status) and status in @inspection_statuses do
    where(query, [i], i.status == ^status)
  end

  defp maybe_status_filter(query, _), do: query

  defp maybe_po_filter(query, nil), do: query

  defp maybe_po_filter(query, po_id) when is_integer(po_id),
    do: where(query, [i], i.purchase_order_id == ^po_id)

  # Warehouse scope — inspections inherit the PO's
  # `default_warehouse_id`. QC and warehouse managers covering one
  # unit filter the global ledger down to their own deliveries.
  defp maybe_warehouse_filter(query, nil), do: query
  defp maybe_warehouse_filter(query, ""), do: query

  defp maybe_warehouse_filter(query, warehouse_id) when is_integer(warehouse_id) do
    from i in query,
      join: po in Backend.Purchasing.PurchaseOrder,
      on: po.id == i.purchase_order_id,
      where: po.default_warehouse_id == ^warehouse_id
  end

  defp maybe_warehouse_filter(query, _), do: query

  defp maybe_date_range(query, nil, nil), do: query

  defp maybe_date_range(query, from, nil),
    do: where(query, [i], i.delivery_date >= ^from)

  defp maybe_date_range(query, nil, to),
    do: where(query, [i], i.delivery_date <= ^to)

  defp maybe_date_range(query, from, to) do
    where(query, [i], i.delivery_date >= ^from and i.delivery_date <= ^to)
  end

  # "Mine" filter — rows where the given user is either the goods-in
  # operator or the quality approver. Powers the "Mine" chip on the
  # mobile inspections list + the desktop ledger so a user can see
  # everything they've personally touched without scrolling.
  defp maybe_actor_filter(query, nil), do: query
  defp maybe_actor_filter(query, ""), do: query

  defp maybe_actor_filter(query, actor_id) when is_integer(actor_id) do
    where(query, [i], i.goods_in_operator_id == ^actor_id or i.quality_approver_id == ^actor_id)
  end

  defp maybe_actor_filter(query, _), do: query

  # ----- create draft ---------------------------------------------

  @doc """
  Create a draft inspection scoped to the PO. `attrs` carries section
  1 (delivery info) at minimum. Returns the inserted, preloaded
  inspection.
  """
  def create_draft(%User{} = actor, %PurchaseOrder{} = po, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => po.company_id,
        "purchase_order_id" => po.id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %Inspection{}
    |> Inspection.create_changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, inspection} ->
        Audit.record_created(actor, "goods_in_inspection", inspection, snapshot(inspection))
        {:ok, reload(inspection)}

      other ->
        other
    end
  end

  # ----- section + delivery info patches --------------------------

  def update_delivery_info(%User{} = actor, %Inspection{status: "draft"} = i, attrs) do
    attrs = attrs |> stringify_keys() |> Map.put("updated_by_id", actor.id)
    do_patch(actor, i, &Inspection.delivery_info_changeset(&1, attrs))
  end

  def update_delivery_info(_, %Inspection{}, _), do: {:error, :not_editable}

  def update_section(%User{} = actor, %Inspection{status: "draft"} = i, section, value)
      when section in @section_keys and is_map(value) do
    do_patch(actor, i, &Inspection.section_changeset(&1, section, value, actor.id))
  end

  def update_section(_, %Inspection{}, _, _), do: {:error, :not_editable}

  defp do_patch(actor, %Inspection{} = i, build_cs) do
    before_snap = snapshot(i)

    i
    |> build_cs.()
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(actor, "goods_in_inspection", updated, before_snap, snapshot(updated))
        {:ok, reload(updated)}

      other ->
        other
    end
  end

  # ----- per-line decisions ---------------------------------------

  @doc """
  Upsert the per-line decision (`accept`, `hold`, `reject`) on a draft
  inspection. Idempotent on (inspection_id, po_line_id).
  """
  def upsert_item_decision(
        %User{} = actor,
        %Inspection{status: "draft"} = i,
        %PurchaseOrderLine{} = line,
        attrs
      ) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => i.company_id,
        "goods_in_inspection_id" => i.id,
        "purchase_order_line_id" => line.id
      })
      |> reconcile_qty_from_packs()

    existing =
      Repo.one(
        from(it in InspectionItem,
          where:
            it.goods_in_inspection_id == ^i.id and
              it.purchase_order_line_id == ^line.id
        )
      )

    case existing do
      nil ->
        %InspectionItem{}
        |> InspectionItem.changeset(attrs)
        |> Repo.insert()
        |> after_item_write(actor, "created")

      %InspectionItem{} = item ->
        item
        |> InspectionItem.changeset(attrs)
        |> Repo.update()
        |> after_item_write(actor, "updated")
    end
  end

  def upsert_item_decision(_, %Inspection{}, _, _), do: {:error, :not_editable}

  defp after_item_write({:ok, item}, actor, "created") do
    Audit.record_created(actor, "goods_in_inspection_item", item, %{
      material_decision: item.material_decision,
      qty_received: item.qty_received
    })

    {:ok, item}
  end

  defp after_item_write({:ok, item}, actor, "updated") do
    Audit.record_updated(actor, "goods_in_inspection_item", item, %{}, %{
      material_decision: item.material_decision,
      qty_received: item.qty_received
    })

    {:ok, item}
  end

  defp after_item_write(other, _actor, _kind), do: other

  # When the FE sends a non-empty `packs` list we own the qty_received
  # number — sum the packs and overwrite whatever the client claimed.
  # Keeps the two columns from drifting and stops the FE from having
  # to compute the total twice (once for display, once for the wire).
  defp reconcile_qty_from_packs(%{"packs" => packs} = attrs) when is_list(packs) and packs != [] do
    sum =
      Enum.reduce(packs, Decimal.new(0), fn pack, acc ->
        case pack_qty(pack) do
          {:ok, dec} -> Decimal.add(acc, dec)
          :error -> acc
        end
      end)

    Map.put(attrs, "qty_received", Decimal.to_string(sum))
  end

  defp reconcile_qty_from_packs(attrs), do: attrs

  defp pack_qty(pack) do
    raw = pack["qty"] || pack[:qty]

    cond do
      is_nil(raw) ->
        :error

      is_binary(raw) ->
        case Decimal.parse(String.trim(raw)) do
          {dec, ""} -> {:ok, dec}
          _ -> :error
        end

      is_integer(raw) or is_float(raw) ->
        {:ok, Decimal.new(to_string(raw))}

      true ->
        :error
    end
  end

  # ----- ESIGN signatures -----------------------------------------

  @doc """
  Operator signs as goods-in operator — flips draft → submitted.
  Requires:
    * a goods_in_inspection_items row for every PO line on the linked PO
      (the operator can't sign without recording each line decision)
    * at least one check populated in every section JSONB

  Returns `{:error, :not_editable}` if status != draft.
  """
  def sign_operator(%User{} = actor, %Inspection{status: "draft"} = i, attrs) do
    with :ok <- ensure_all_lines_decided(i),
         :ok <- ensure_all_sections_touched(i) do
      attrs =
        attrs
        |> stringify_keys()
        |> Map.merge(%{
          "goods_in_operator_id" => actor.id,
          "goods_in_operator_signed_at" =>
            DateTime.utc_now() |> DateTime.truncate(:second),
          "updated_by_id" => actor.id
        })

      # Wrap the sign + receive in one transaction so a failed
      # auto-receive (warehouse not configured for quarantine, etc.)
      # rolls the operator's signature back. Either both happen, or
      # neither does.
      Repo.transaction(fn ->
        with {:ok, updated} <-
               i
               |> Inspection.operator_sign_changeset(attrs)
               |> Repo.update(),
             {:ok, _} <- maybe_auto_receive_po(actor, updated) do
          Audit.record_updated(actor, "goods_in_inspection", updated, %{status: "draft"}, %{
            status: updated.status,
            goods_in_operator_signed_at: updated.goods_in_operator_signed_at
          })

          reload(updated)
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  def sign_operator(_, %Inspection{}, _), do: {:error, :not_editable}

  # When the operator signs off, the inspection IS the receiving
  # event: walk every per-line pack the operator captured, build the
  # `receive_against_po` payload, and run the receive in-line. Lots
  # land in quarantine status, placed in the warehouse's quarantine
  # cell, tagged with this inspection's id so the approver's later
  # sign-off can fan out `qc_passed` / `qc_failed` events on exactly
  # the right rows.
  #
  # No-ops when:
  #   * The PO is already `received` (subsequent inspection on a
  #     fully-received PO — defensive; the FE shouldn't surface that).
  #   * Every inspection item has zero packs (legacy / nothing-arrived
  #     scenario — the inspection is signed but no goods land).
  defp maybe_auto_receive_po(%User{} = actor, %Inspection{} = inspection) do
    inspection =
      Repo.preload(inspection, [
        :purchase_order,
        items: [:purchase_order_line]
      ])

    case inspection.purchase_order do
      nil ->
        {:ok, nil}

      %Backend.Purchasing.PurchaseOrder{status: status} = po
      when status in ["ordered", "partially_received"] ->
        case build_receive_attrs(inspection, po) do
          {:ok, []} ->
            {:ok, po}

          {:ok, line_attrs} ->
            attrs = %{
              "warehouse_id" => po.default_warehouse_id,
              "goods_in_inspection_id" => inspection.id,
              "lines" => line_attrs
            }

            Backend.Purchasing.receive_against_po(actor, po, attrs)

          {:error, reason} ->
            {:error, reason}
        end

      %Backend.Purchasing.PurchaseOrder{} = po ->
        # Already received / cancelled — nothing to do. The inspection
        # still signs (multi-inspection on a partially-received PO is
        # a legitimate flow).
        {:ok, po}
    end
  end

  # Flatten inspection items + their pack arrays into the wire shape
  # `receive_against_po/3` expects. Items with empty `packs` are
  # silently skipped — `validate_receive_lines` would 422 on an empty
  # `packs` list otherwise, and "nothing arrived for this line" is a
  # legitimate per-line state.
  #
  # The mobile pack editor is deliberately tight (operators capture
  # qty + L/W/H + weight + units-per-pack only — `stack_factor` is a
  # warehouse-safety setting, not a dock concern). The receive flow
  # validates stack_factor as a positive integer though, so default
  # missing values to 1 (= no vertical stacking) on the way out.
  defp build_receive_attrs(%Inspection{} = inspection, _po) do
    line_attrs =
      inspection.items
      |> Enum.flat_map(fn item ->
        packs = if is_list(item.packs), do: item.packs, else: []
        line_uuid = item.purchase_order_line && item.purchase_order_line.uuid

        cond do
          packs == [] ->
            []

          is_nil(line_uuid) ->
            []

          true ->
            packs_with_defaults = Enum.map(packs, &normalise_pack_for_receive/1)
            [%{"line_uuid" => line_uuid, "packs" => packs_with_defaults}]
        end
      end)

    {:ok, line_attrs}
  end

  # Stamp the wire defaults `receive_against_po` insists on but the
  # inspection wizard doesn't surface:
  #
  #   * `stack_factor` — warehouse-safety cap; defaults to 1 (no
  #     vertical stacking).
  #   * `units_per_package` — when one wizard row represents one
  #     physical pack (the operator's mental model), the per-pack
  #     UoM content equals the row's `qty`. Falling back to a hard
  #     `1` makes the schema's `packages = qty / units_per_package`
  #     compute N packs for a single-drum receive, then disqualifies
  #     every cell on weight. Mirror qty so packages = 1 per row.
  defp normalise_pack_for_receive(pack) when is_map(pack) do
    qty = pack["qty"] || pack[:qty]

    pack
    |> Map.put_new("stack_factor", 1)
    |> ensure_units_per_package(qty)
  end

  defp normalise_pack_for_receive(other), do: other

  defp ensure_units_per_package(pack, qty) do
    case pack["units_per_package"] || pack[:units_per_package] do
      nil ->
        Map.put(pack, "units_per_package", coerce_numeric(qty) || 1)

      "" ->
        Map.put(pack, "units_per_package", coerce_numeric(qty) || 1)

      0 ->
        Map.put(pack, "units_per_package", coerce_numeric(qty) || 1)

      "0" ->
        Map.put(pack, "units_per_package", coerce_numeric(qty) || 1)

      _ ->
        pack
    end
  end

  # Preserve fractional values — `units_per_package` is decimal now,
  # so a 4.4 kg-per-bag row must round-trip without truncation.
  defp coerce_numeric(nil), do: nil

  defp coerce_numeric(n) when is_integer(n) and n > 0, do: n
  defp coerce_numeric(n) when is_float(n) and n > 0, do: Decimal.from_float(n)

  defp coerce_numeric(%Decimal{} = d) do
    case Decimal.compare(d, Decimal.new(0)) do
      :gt -> d
      _ -> nil
    end
  end

  defp coerce_numeric(s) when is_binary(s) do
    case Decimal.parse(String.trim(s)) do
      {dec, ""} -> coerce_numeric(dec)
      _ -> nil
    end
  end

  defp coerce_numeric(_), do: nil

  @doc """
  Quality approver signs — flips submitted → approved | hold | rejected.
  The approver may be the same person who signed as operator — the
  regulatory framework we follow allows a single qualified user to
  carry both roles (the audit trail still records the dual signature
  + decision rationale separately).

  Inside one transaction:
    * Stamp the approver's signature + quality_decision + reason
    * For every lot tagged with this inspection's id, emit a per-lot
      lifecycle event matching the per-line material_decision (see
      moduledoc for the matrix)

  Returns `{:error, :not_submitted}` if status != submitted.
  """
  def sign_quality_approver(
        %User{} = actor,
        %Inspection{status: "submitted"} = i,
        %{} = attrs
      ) do
    decision = attrs[:quality_decision] || attrs["quality_decision"]
    reason = attrs[:quality_decision_reason] || attrs["quality_decision_reason"]
    sig = attrs[:signature_image] || attrs["signature_image"]

    attrs_to_cast = %{
      "quality_approver_id" => actor.id,
      "quality_approver_signature_image" => sig,
      "quality_approver_signed_at" =>
        DateTime.utc_now() |> DateTime.truncate(:second),
      "quality_decision" => decision,
      "quality_decision_reason" => reason,
      "status" => decision,
      "updated_by_id" => actor.id
    }

    Repo.transaction(fn ->
      with {:ok, updated} <-
             i
             |> Inspection.approver_sign_changeset(attrs_to_cast)
             |> Repo.update(),
           :ok <- fan_out_lot_events(actor, updated) do
        Audit.record_updated(
          actor,
          "goods_in_inspection",
          updated,
          %{status: "submitted"},
          %{
            status: updated.status,
            quality_decision: updated.quality_decision,
            quality_approver_signed_at: updated.quality_approver_signed_at
          }
        )

        reload(updated)
      else
        {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  def sign_quality_approver(_, %Inspection{}, _), do: {:error, :not_submitted}

  # ----- helpers --------------------------------------------------

  defp ensure_all_lines_decided(%Inspection{} = i) do
    po_line_ids =
      Repo.all(
        from(l in PurchaseOrderLine,
          where: l.purchase_order_id == ^i.purchase_order_id,
          select: l.id
        )
      )
      |> MapSet.new()

    decided_ids =
      Repo.all(
        from(it in InspectionItem,
          where: it.goods_in_inspection_id == ^i.id,
          select: it.purchase_order_line_id
        )
      )
      |> MapSet.new()

    if MapSet.equal?(po_line_ids, decided_ids) do
      :ok
    else
      missing = MapSet.difference(po_line_ids, decided_ids) |> MapSet.to_list()
      {:error, {:lines_undecided, missing}}
    end
  end

  defp ensure_all_sections_touched(%Inspection{} = i) do
    missing =
      Enum.filter(@section_keys, fn key ->
        case Map.get(i, key) do
          nil -> true
          map when is_map(map) -> map_size(map) == 0
          _ -> true
        end
      end)

    case missing do
      [] -> :ok
      _ -> {:error, {:sections_incomplete, missing}}
    end
  end

  # Walk every lot the receive call stamped with this inspection's id
  # and emit the per-lot lifecycle event matching the inspection-level
  # decision + per-line decision. Inside the parent transaction.
  defp fan_out_lot_events(_actor, %Inspection{quality_decision: "hold"}), do: :ok

  defp fan_out_lot_events(actor, %Inspection{} = i) do
    items =
      Repo.all(
        from(it in InspectionItem,
          where: it.goods_in_inspection_id == ^i.id
        )
      )

    decision_by_line =
      Map.new(items, &{&1.purchase_order_line_id, &1.material_decision})

    lots = Stock.list_lots_for_inspection(i.id)

    Enum.reduce_while(lots, :ok, fn lot, _acc ->
      kind = lot_event_kind(i.quality_decision, decision_by_line, lot)

      case kind do
        nil ->
          {:cont, :ok}

        event_kind ->
          case Lifecycle.record_event_in_transaction(lot, event_kind, %{
                 actor: actor,
                 actor_kind: "user",
                 reason: "Goods-In Inspection sign-off — decision=#{i.quality_decision}",
                 metadata: %{"inspection_id" => i.id}
               }) do
            {:ok, _} -> {:cont, :ok}
            {:error, :illegal_transition, info} -> {:halt, {:error, {:illegal_transition, info}}}
            {:error, reason} -> {:halt, {:error, reason}}
          end
      end
    end)
  end

  # Inspection-level rejected always fails every lot.
  defp lot_event_kind("rejected", _decisions_by_line, _lot), do: "qc_failed"

  defp lot_event_kind("approved", decisions_by_line, lot) do
    case lot_po_line_id(lot) do
      nil ->
        "qc_passed"

      po_line_id ->
        case Map.get(decisions_by_line, po_line_id, "accept") do
          "accept" -> "qc_passed"
          "reject" -> "qc_failed"
          # `hold` keeps the lot in quarantine — no event emitted.
          "hold" -> nil
          _ -> "qc_passed"
        end
    end
  end

  defp lot_event_kind(_decision, _decisions_by_line, _lot), do: nil

  # Stock.Lot doesn't carry a direct PO line FK — pull it from the
  # `received` event's metadata that the PO-receive flow stamped.
  defp lot_po_line_id(lot) do
    Repo.one(
      from(e in Backend.Stock.LotEvent,
        where: e.stock_lot_id == ^lot.id and e.kind == "received",
        order_by: [asc: e.id],
        limit: 1,
        select: e.metadata
      )
    )
    |> case do
      %{"po_line_id" => id} when is_integer(id) -> id
      _ -> nil
    end
  end

  defp reload(%Inspection{} = i) do
    Repo.preload(
      i,
      [
        :purchase_order,
        :goods_in_operator,
        :quality_approver,
        :created_by,
        :updated_by,
        items: [:purchase_order_line],
        files: [:uploaded_by]
      ],
      force: true
    )
  end

  # ----- file attachments -----------------------------------------

  @doc "Allowed file MIME types for inspection attachments (photos + COA PDFs)."
  def allowed_file_mimes, do: @allowed_file_mimes

  @doc "Max byte size for an inspection file attachment."
  def max_file_bytes, do: @max_file_bytes

  @doc """
  Persist a file attachment on an inspection. Operator photos /
  supplier COAs / other supporting evidence. Allowed only while the
  inspection is still mutable (status ∈ draft | submitted) so the
  approver can attach more evidence at sign-off time before the
  record is locked.
  """
  def upload_file(%User{} = actor, %Inspection{} = inspection, kind, %Plug.Upload{} = upload) do
    cond do
      inspection.status not in @file_uploadable_statuses ->
        {:error, :not_editable}

      true ->
        with :ok <- validate_mime(upload.content_type),
             {:ok, bytes} <- read_upload(upload),
             :ok <- validate_size(bytes) do
          attrs = %{
            "company_id" => inspection.company_id,
            "goods_in_inspection_id" => inspection.id,
            "kind" => kind || "photo",
            "filename" => upload.filename || "upload",
            "mime" => upload.content_type || "application/octet-stream",
            "byte_size" => byte_size(bytes),
            "uploaded_by_id" => actor.id
          }

          key = build_file_storage_key(inspection, attrs)

          case Storage.put(key, bytes, content_type: attrs["mime"]) do
            {:ok, blob_path} ->
              attrs = Map.put(attrs, "blob_path", blob_path)

              %InspectionFile{}
              |> InspectionFile.changeset(attrs)
              |> Repo.insert()
              |> case do
                {:ok, file} ->
                  Audit.record_created(actor, "goods_in_inspection_file", file, %{
                    goods_in_inspection_id: file.goods_in_inspection_id,
                    kind: file.kind,
                    filename: file.filename
                  })

                  {:ok, Repo.preload(file, :uploaded_by)}

                {:error, cs} ->
                  _ = Storage.delete(blob_path)
                  {:error, cs}
              end

            {:error, reason} ->
              {:error, {:storage_failed, reason}}
          end
        end
    end
  end

  @doc """
  Remove an inspection file. Hard-delete: row + blob. Allowed only
  while the inspection is mutable.
  """
  def delete_file(%User{} = actor, %Inspection{} = inspection, file_uuid) do
    cond do
      inspection.status not in @file_uploadable_statuses ->
        {:error, :not_editable}

      true ->
        case get_file(inspection.company_id, inspection.uuid, file_uuid) do
          nil ->
            {:error, :not_found}

          %InspectionFile{} = file ->
            Repo.transaction(fn ->
              case Repo.delete(file) do
                {:ok, deleted} ->
                  _ = Storage.delete(file.blob_path)

                  Audit.record_deleted(actor, "goods_in_inspection_file", file, %{
                    goods_in_inspection_id: file.goods_in_inspection_id,
                    kind: file.kind,
                    filename: file.filename
                  })

                  deleted

                {:error, reason} ->
                  Repo.rollback(reason)
              end
            end)
        end
    end
  end

  @doc """
  Look up a file row scoped to the inspection uuid + file uuid, all
  inside the given company. Returns `nil` on miss / bad uuid.
  """
  def get_file(company_id, inspection_uuid, file_uuid)
      when is_binary(inspection_uuid) and is_binary(file_uuid) do
    with {:ok, insp_cast} <- Ecto.UUID.cast(inspection_uuid),
         {:ok, file_cast} <- Ecto.UUID.cast(file_uuid) do
      Repo.one(
        from(f in InspectionFile,
          join: i in Inspection,
          on: i.id == f.goods_in_inspection_id,
          where:
            f.company_id == ^company_id and
              f.uuid == ^file_cast and
              i.uuid == ^insp_cast,
          preload: [:uploaded_by]
        )
      )
    else
      _ -> nil
    end
  end

  def get_file(_, _, _), do: nil

  defp validate_mime(mime) when mime in @allowed_file_mimes, do: :ok

  defp validate_mime(mime) do
    {:error,
     {:invalid_mime,
      "Unsupported file type (#{mime || "unknown"}). Allowed: PDF, JPEG, PNG, WebP, HEIC."}}
  end

  defp validate_size(bytes) when byte_size(bytes) > @max_file_bytes do
    {:error, {:too_large, byte_size(bytes)}}
  end

  defp validate_size(_), do: :ok

  defp read_upload(%Plug.Upload{path: path}) do
    case File.read(path) do
      {:ok, bytes} -> {:ok, bytes}
      {:error, reason} -> {:error, {:read_failed, reason}}
    end
  end

  defp build_file_storage_key(%Inspection{} = inspection, attrs) do
    kind = attrs["kind"] || "photo"
    filename = attrs["filename"] || "upload"

    "goods_in_files/" <>
      inspection.uuid <>
      "/" <>
      kind <>
      "_" <>
      Ecto.UUID.generate() <>
      file_extension(filename)
  end

  defp file_extension(filename) when is_binary(filename) do
    case Path.extname(filename) do
      "" -> ""
      ext -> String.downcase(ext)
    end
  end

  defp file_extension(_), do: ""

  defp snapshot(%Inspection{} = i) do
    Map.take(i, [
      :status,
      :delivery_date,
      :transport_company,
      :vehicle_registration,
      :seal_number,
      :quality_decision,
      :goods_in_operator_signed_at,
      :quality_approver_signed_at
    ])
  end

  defp stringify_keys(map) when is_map(map) do
    Map.new(map, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} -> {k, v}
    end)
  end

  defp stringify_keys(other), do: other
end
