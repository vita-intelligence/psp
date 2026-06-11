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
  alias Backend.GoodsIn.{Inspection, InspectionItem}
  alias Backend.Purchasing.{PurchaseOrder, PurchaseOrderLine}
  alias Backend.Repo
  alias Backend.Stock
  alias Backend.Stock.Lifecycle

  @section_keys ~w(vehicle_inspection documentation_verification physical_inspection food_safety_checks storage_verification)a

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
              items: [:purchase_order_line]
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

      i
      |> Inspection.operator_sign_changeset(attrs)
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          Audit.record_updated(actor, "goods_in_inspection", updated, %{status: "draft"}, %{
            status: updated.status,
            goods_in_operator_signed_at: updated.goods_in_operator_signed_at
          })

          {:ok, reload(updated)}

        other ->
          other
      end
    end
  end

  def sign_operator(_, %Inspection{}, _), do: {:error, :not_editable}

  @doc """
  Quality approver signs — flips submitted → approved | hold | rejected.
  Approver MUST differ from goods-in operator (segregation of duties).

  Inside one transaction:
    * Stamp the approver's signature + quality_decision + reason
    * For every lot tagged with this inspection's id, emit a per-lot
      lifecycle event matching the per-line material_decision (see
      moduledoc for the matrix)

  Returns `{:error, :not_submitted}` if status != submitted, or
  `{:error, :same_signer_as_operator}` if actor == operator.
  """
  def sign_quality_approver(
        %User{} = actor,
        %Inspection{status: "submitted"} = i,
        %{} = attrs
      ) do
    cond do
      actor.id == i.goods_in_operator_id ->
        {:error, :same_signer_as_operator}

      true ->
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
        items: [:purchase_order_line]
      ],
      force: true
    )
  end

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
