defmodule Backend.Purchasing do
  @moduledoc """
  Boundary for purchase orders, lines, and the two-tier ESIGN
  approval workflow.

  State machine:

      draft
        ↓ submit  (creator clicks "Submit for approval", lines must exist
        |          + vendor must be approved + each line.item must be on
        |          the vendor's approved-supplier list)
      pending_approver
        ↓ sign_approver
      pending_director
        ↓ sign_director  (signer must differ from the approver tier —
        |                 segregation of duties)
      approved
        ↓ mark_ordered  (operator confirms the PO has been sent to the
        |                vendor; ordered_at + ordered_by stamped)
      ordered
        ↓ receive_against_po (each receipt updates qty_received per
        |                     line; transitions partially_received →
        |                     received when fully fulfilled — done in
        |                     Purchasing.Receive)

      Any non-terminal state → cancelled  (with a reason)

  Lines + totals: line writes bubble up into the header `subtotal`,
  `tax_amount`, `total_amount` columns so the FE renders the footer
  without a per-render aggregation.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.ListQueries
  alias Backend.Purchasing.{
    PurchaseOrder,
    PurchaseOrderApproval,
    PurchaseOrderLine,
    VendorPrices
  }
  alias Backend.Repo
  alias Backend.Vendors

  @po_audit_fields ~w(status vendor_id currency_code subtotal tax_amount
                      total_amount expected_delivery_date delivery_address
                      notes submitted_at ordered_at received_at cancelled_at
                      cancellation_reason)a
  @po_sortable ~w(id status total_amount expected_delivery_date inserted_at submitted_at ordered_at)a
  @po_search ~w(delivery_address notes cancellation_reason)a
  @po_default_sort {:id, :desc}

  # ----- list / get ------------------------------------------------

  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = normalise_sort(Keyword.get(opts, :sort, @po_default_sort))

    base =
      PurchaseOrder
      |> where([p], p.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @po_search)
      |> maybe_status_filter(opts[:status])
      |> maybe_vendor_filter(opts[:vendor_id])
      |> ListQueries.apply_sort(sort, @po_sortable, @po_default_sort)
      |> preload([:vendor, :created_by, :submitted_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  defp maybe_status_filter(query, nil), do: query
  defp maybe_status_filter(query, ""), do: query

  defp maybe_status_filter(query, status) when is_binary(status) do
    where(query, [p], p.status == ^status)
  end

  defp maybe_vendor_filter(query, nil), do: query

  defp maybe_vendor_filter(query, vendor_id) when is_integer(vendor_id) do
    where(query, [p], p.vendor_id == ^vendor_id)
  end

  defp maybe_vendor_filter(query, raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> where(query, [p], p.vendor_id == ^n)
      _ -> query
    end
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(p in PurchaseOrder,
            where: p.company_id == ^company_id and p.uuid == ^cast,
            preload: [
              :vendor,
              :created_by,
              :updated_by,
              :submitted_by,
              :ordered_by,
              :cancelled_by,
              lines: [:item],
              approvals: [:signed_by]
            ]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  # ----- create / update header ------------------------------------

  def create(%User{} = actor, company_id, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %PurchaseOrder{}
    |> PurchaseOrder.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, po} ->
        Audit.record_created(actor, "purchase_order", po, snapshot(po))
        {:ok, preload(po)}

      other ->
        other
    end
  end

  @doc """
  Edit identity columns. Only allowed in `draft` — once submitted the
  header is locked behind the approval workflow.
  """
  def update_header(%User{} = actor, %PurchaseOrder{} = po, attrs) do
    if po.status != "draft" do
      {:error, :not_editable}
    else
      before_state = snapshot(po)

      po
      |> PurchaseOrder.changeset(
        attrs |> stringify_keys() |> Map.put("updated_by_id", actor.id)
      )
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          Audit.record_updated(actor, "purchase_order", updated, before_state, snapshot(updated))
          {:ok, preload(updated)}

        other ->
          other
      end
    end
  end

  def delete(%User{} = actor, %PurchaseOrder{} = po) do
    if po.status != "draft" do
      {:error, :not_deletable}
    else
      before_state = snapshot(po)

      case Repo.delete(po) do
        {:ok, deleted} ->
          Audit.record_deleted(actor, "purchase_order", po, before_state)
          {:ok, deleted}

        other ->
          other
      end
    end
  end

  # ----- lines -----------------------------------------------------

  def add_line(%User{} = actor, %PurchaseOrder{} = po, attrs) do
    if po.status not in ["draft"] do
      {:error, :not_editable}
    else
      attrs =
        attrs
        |> stringify_keys()
        |> Map.merge(%{
          "purchase_order_id" => po.id,
          "company_id" => po.company_id
        })
        |> compute_line_subtotal()

      Repo.transaction(fn ->
        with {:ok, line} <-
               %PurchaseOrderLine{}
               |> PurchaseOrderLine.changeset(attrs)
               |> Repo.insert(),
             {:ok, _po} <- refresh_totals(po) do
          Audit.record_created(actor, "purchase_order_line", line, %{
            item_id: line.item_id,
            qty_ordered: line.qty_ordered,
            unit_price: line.unit_price
          })

          Repo.preload(line, :item)
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  def update_line(%User{} = actor, %PurchaseOrderLine{} = line, attrs) do
    po = Repo.get!(PurchaseOrder, line.purchase_order_id)

    if po.status not in ["draft"] do
      {:error, :not_editable}
    else
      before_state = %{
        qty_ordered: line.qty_ordered,
        unit_price: line.unit_price,
        item_id: line.item_id
      }

      attrs = attrs |> stringify_keys() |> compute_line_subtotal()

      Repo.transaction(fn ->
        with {:ok, updated} <-
               line |> PurchaseOrderLine.changeset(attrs) |> Repo.update(),
             {:ok, _po} <- refresh_totals(po) do
          Audit.record_updated(actor, "purchase_order_line", updated, before_state, %{
            qty_ordered: updated.qty_ordered,
            unit_price: updated.unit_price,
            item_id: updated.item_id
          })

          Repo.preload(updated, :item)
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  def delete_line(%User{} = actor, %PurchaseOrderLine{} = line) do
    po = Repo.get!(PurchaseOrder, line.purchase_order_id)

    if po.status not in ["draft"] do
      {:error, :not_editable}
    else
      Repo.transaction(fn ->
        case Repo.delete(line) do
          {:ok, deleted} ->
            {:ok, _} = refresh_totals(po)

            Audit.record_deleted(actor, "purchase_order_line", line, %{
              item_id: line.item_id,
              qty_ordered: line.qty_ordered
            })

            deleted

          {:error, reason} ->
            Repo.rollback(reason)
        end
      end)
    end
  end

  def get_line(po_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} -> Repo.get_by(PurchaseOrderLine, purchase_order_id: po_id, uuid: cast)
      :error -> nil
    end
  end

  def get_line(_, _), do: nil

  defp compute_line_subtotal(%{"qty_ordered" => qty, "unit_price" => price} = attrs)
       when not is_nil(qty) and not is_nil(price) do
    qty_d = to_decimal(qty)
    price_d = to_decimal(price)

    if qty_d && price_d do
      Map.put(attrs, "line_subtotal", Decimal.mult(qty_d, price_d))
    else
      attrs
    end
  end

  defp compute_line_subtotal(attrs), do: attrs

  defp to_decimal(%Decimal{} = d), do: d
  defp to_decimal(n) when is_integer(n) or is_float(n), do: Decimal.new(to_string(n))

  defp to_decimal(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, ""} -> d
      _ -> nil
    end
  end

  defp to_decimal(_), do: nil

  defp refresh_totals(%PurchaseOrder{} = po) do
    sums =
      Repo.one(
        from(l in PurchaseOrderLine,
          where: l.purchase_order_id == ^po.id,
          select: %{subtotal: coalesce(sum(l.line_subtotal), 0)}
        )
      )

    subtotal = sums.subtotal || Decimal.new(0)
    # Tax is left as a manual header field for v1 — operators can
    # override under "Notes" or set it via a follow-up endpoint. The
    # `total = subtotal + tax_amount` math runs here so total stays
    # in step with whatever tax is on the header.
    tax = po.tax_amount || Decimal.new(0)
    total = Decimal.add(subtotal, tax)

    po
    |> PurchaseOrder.totals_changeset(%{
      "subtotal" => subtotal,
      "tax_amount" => tax,
      "total_amount" => total
    })
    |> Repo.update()
  end

  # ----- state machine ---------------------------------------------

  @doc """
  Submit a draft PO for approval. Validates:
    * PO has at least one line
    * Vendor is `approved` AND `is_active`
    * Every line.item is on the vendor's approved-supplier list
  """
  def submit(%User{} = actor, %PurchaseOrder{} = po) do
    cond do
      po.status != "draft" ->
        {:error, :bad_status}

      true ->
        po = preload(po)

        with :ok <- ensure_lines_present(po),
             :ok <- ensure_vendor_approved(po),
             :ok <- ensure_lines_approved_by_vendor(po) do
          now = DateTime.utc_now() |> DateTime.truncate(:second)

          attrs = %{
            "status" => "pending_approver",
            "submitted_at" => now,
            "submitted_by_id" => actor.id,
            "updated_by_id" => actor.id
          }

          transition(actor, po, attrs)
        end
    end
  end

  @doc """
  Approver-tier signature. Records a `purchase_order_approvals` row +
  flips status to `pending_director`.
  """
  def sign_approver(%User{} = actor, %PurchaseOrder{} = po, opts \\ %{}) do
    if po.status != "pending_approver" do
      {:error, :bad_status}
    else
      record_approval_and_advance(actor, po, "approver", "pending_director", opts)
    end
  end

  @doc """
  Director-tier signature. Must be a different user from the
  approver-tier signer.
  """
  def sign_director(%User{} = actor, %PurchaseOrder{} = po, opts \\ %{}) do
    if po.status != "pending_director" do
      {:error, :bad_status}
    else
      with :ok <- ensure_different_signer(po, actor) do
        record_approval_and_advance(actor, po, "director", "approved", opts)
      end
    end
  end

  defp record_approval_and_advance(actor, po, kind, next_status, opts) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    Repo.transaction(fn ->
      with {:ok, approval} <-
             %PurchaseOrderApproval{}
             |> PurchaseOrderApproval.changeset(%{
               "purchase_order_id" => po.id,
               "company_id" => po.company_id,
               "signed_by_id" => actor.id,
               "kind" => kind,
               "signed_at" => now,
               "notes" => Map.get(opts, "notes") || Map.get(opts, :notes),
               "signature_image" =>
                 Map.get(opts, "signature_image") || Map.get(opts, :signature_image)
             })
             |> Repo.insert(),
           {:ok, updated} <-
             transition_db(actor, po, %{
               "status" => next_status,
               "updated_by_id" => actor.id
             }) do
        Audit.record_created(actor, "purchase_order_approval", approval, %{
          purchase_order_id: approval.purchase_order_id,
          kind: approval.kind,
          signed_by_id: approval.signed_by_id
        })

        preload(updated)
      else
        {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  defp ensure_different_signer(po, %User{} = actor) do
    po = preload(po)

    case Enum.find(po.approvals, fn a -> a.kind == "approver" end) do
      nil -> :ok
      %{signed_by_id: id} when id == actor.id -> {:error, :same_signer}
      _ -> :ok
    end
  end

  @doc """
  Operator stamps the PO as sent to the vendor. As a side effect,
  every PO line gets a planned `expected` stock lot — qty_received 0,
  status `expected`, an `expected` lifecycle event recorded. The
  "X arriving" dashboard reads off those rows so buyers see committed
  arrivals before any physical receipt.
  """
  def mark_ordered(%User{} = actor, %PurchaseOrder{} = po) do
    if po.status != "approved" do
      {:error, :bad_status}
    else
      now = DateTime.utc_now() |> DateTime.truncate(:second)
      po = preload(po)

      Repo.transaction(fn ->
        with {:ok, updated} <-
               transition_db(actor, po, %{
                 "status" => "ordered",
                 "ordered_at" => now,
                 "ordered_by_id" => actor.id,
                 "updated_by_id" => actor.id
               }),
             :ok <- create_expected_lots_for_po(actor, po) do
          preload(updated)
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  # Walk every PO line and emit one `expected` lot + its lifecycle
  # event. Best-effort with respect to compliance: if a line already
  # has its expected lot (idempotency for re-runs after partial
  # failure) we skip it.
  defp create_expected_lots_for_po(actor, %PurchaseOrder{} = po) do
    source_ref = render_po_code(po)

    Enum.reduce_while(po.lines, :ok, fn line, :ok ->
      case create_expected_lot_for_line(actor, po, line, source_ref) do
        {:ok, _lot} -> {:cont, :ok}
        :skip -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp create_expected_lot_for_line(actor, %PurchaseOrder{} = po, %PurchaseOrderLine{} = line, source_ref) do
    item =
      case line.item do
        %Backend.Items.Item{} = i -> i
        _ -> Repo.get(Backend.Items.Item, line.item_id)
      end

    cond do
      is_nil(item) ->
        {:error, {:item_not_found, line.item_id}}

      expected_lot_exists?(po, line) ->
        :skip

      true ->
        attrs = %{
          "company_id" => po.company_id,
          "item_id" => line.item_id,
          "unit_of_measurement_id" => item.stock_uom_id,
          "qty_received" => Decimal.new(0),
          "status" => "expected",
          "source_kind" => "purchase_order",
          "source_ref" => source_ref,
          "unit_cost" => line.unit_price,
          "currency" => po.currency_code,
          "created_by_id" => actor.id,
          "updated_by_id" => actor.id
        }

        with {:ok, lot} <-
               %Backend.Stock.Lot{}
               |> Backend.Stock.Lot.expected_changeset(attrs)
               |> Repo.insert(),
             {:ok, _result} <-
               Backend.Stock.Lifecycle.record_event_in_transaction(
                 lot,
                 "expected",
                 %{
                   actor: actor,
                   actor_kind: "user",
                   reason: "PO ordered",
                   metadata: %{
                     "po_line_id" => line.id,
                     "po_id" => po.id,
                     "source_ref" => source_ref
                   }
                 }
               ) do
          Backend.Audit.record_created(actor, "stock_lot", lot, %{
            status: lot.status,
            source_kind: lot.source_kind,
            source_ref: lot.source_ref,
            qty_received: lot.qty_received
          })

          {:ok, lot}
        end
    end
  end

  # An "expected" lot for this line is identified by source_kind =
  # "purchase_order" + source_ref = PO.code + qty_received = 0 + the
  # event log carrying our po_line_id. Cheap presence check via the
  # event log avoids a duplicate when mark_ordered retries.
  defp expected_lot_exists?(%PurchaseOrder{} = po, %PurchaseOrderLine{id: line_id}) do
    Repo.exists?(
      from e in Backend.Stock.LotEvent,
        join: l in Backend.Stock.Lot,
        on: l.id == e.stock_lot_id,
        where:
          e.kind == "expected" and
            e.company_id == ^po.company_id and
            fragment("?->>'po_line_id' = ?", e.metadata, ^Integer.to_string(line_id))
    )
  end

  defp render_po_code(%PurchaseOrder{} = po) do
    company =
      case po.company do
        %Backend.Companies.Company{} = c -> c
        _ -> Repo.get(Backend.Companies.Company, po.company_id)
      end

    Backend.Numbering.render(po.id, company, "purchase_order") || "PO##{po.id}"
  end

  @doc """
  Cancel a PO. Allowed in any non-terminal state.
  """
  def cancel(%User{} = actor, %PurchaseOrder{} = po, reason)
      when is_binary(reason) do
    if po.status in ~w(received cancelled) do
      {:error, :bad_status}
    else
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      transition(actor, po, %{
        "status" => "cancelled",
        "cancelled_at" => now,
        "cancelled_by_id" => actor.id,
        "cancellation_reason" => reason,
        "updated_by_id" => actor.id
      })
    end
  end

  defp transition(actor, %PurchaseOrder{} = po, attrs) do
    Repo.transaction(fn ->
      case transition_db(actor, po, attrs) do
        {:ok, updated} -> preload(updated)
        {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  defp transition_db(actor, %PurchaseOrder{} = po, attrs) do
    before_state = snapshot(po)

    po
    |> PurchaseOrder.transition_status_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(actor, "purchase_order", updated, before_state, snapshot(updated))
        {:ok, updated}

      other ->
        other
    end
  end

  defp ensure_lines_present(%PurchaseOrder{lines: lines}) when is_list(lines) and lines != [],
    do: :ok

  defp ensure_lines_present(_), do: {:error, :no_lines}

  defp ensure_vendor_approved(%PurchaseOrder{vendor: %{approval_status: "approved", is_active: true}}),
    do: :ok

  defp ensure_vendor_approved(_), do: {:error, :vendor_not_approved}

  defp ensure_lines_approved_by_vendor(%PurchaseOrder{vendor_id: vid, lines: lines}) do
    not_approved =
      Enum.filter(lines, fn l -> not Vendors.vendor_can_supply?(vid, l.item_id) end)

    case not_approved do
      [] -> :ok
      [first | _] -> {:error, {:item_not_approved, first.item_id}}
    end
  end

  # ----- receive against PO ---------------------------------------

  @doc """
  Record a receipt against an open PO. Creates a lot per line via
  `Stock.receive_lot/3`, bumps the PO line `qty_received`, and flips
  the PO status to `partially_received` or `received` accordingly.

  `attrs` shape:

      %{
        "warehouse_id" => 2,                    # required — lot lands at this site
        "supplier_batch_no" => "BATCH-AA-42",   # optional, applied to every lot
        "received_at"      => "2026-06-11T09:00:00Z",   # optional
        "lines" => [
          %{
            "line_uuid"          => "…",        # which PO line
            "qty"                => "25",       # how much arrived
            "package_length_mm"  => 400,
            "package_width_mm"   => 400,
            "package_height_mm"  => 600,
            "package_weight_kg"  => "25",
            "units_per_package"  => 1,
            "stack_factor"       => 1
          },
          …
        ]
      }

  Each lot is stamped with `source_kind: "purchase_order"` and
  `source_ref: <PO.code>` so the lot detail page can trace back.
  """
  def receive_against_po(%Backend.Accounts.User{} = actor, %PurchaseOrder{} = po, attrs) do
    cond do
      po.status not in ["ordered", "partially_received"] ->
        {:error, :bad_status}

      true ->
        po = preload(po)
        attrs = stringify_keys(attrs)
        line_inputs = Map.get(attrs, "lines") || []

        case validate_receive_lines(po, line_inputs) do
          {:error, reason} ->
            {:error, reason}

          {:ok, normalised} ->
            Repo.transaction(fn ->
              Enum.each(normalised, fn {%PurchaseOrderLine{} = line, input} ->
                lot_attrs = build_lot_attrs(po, line, attrs, input)

                case Backend.Stock.receive_lot(actor, po.company_id, lot_attrs) do
                  {:ok, _lot} -> :ok
                  {:error, reason} -> Repo.rollback({:lot_failed, line.uuid, reason})
                end

                new_received = Decimal.add(line.qty_received || Decimal.new(0), input.qty)

                updated_line =
                  line
                  |> PurchaseOrderLine.changeset(%{"qty_received" => new_received})
                  |> Repo.update!()

                # Refresh the last-paid cache so the next PO line for
                # this (vendor, item, currency) can pre-fill and warn
                # on ±20% deviation. Cache failures don't roll back
                # the receipt — the lot is already created and the
                # cache is rebuildable from PO history.
                _ = VendorPrices.upsert_from_receipt(po, updated_line)
              end)

              # Recompute PO status from line aggregates.
              refreshed = Repo.get!(PurchaseOrder, po.id) |> Repo.preload(:lines)
              new_status = compute_po_status_from_lines(refreshed)

              if new_status != po.status do
                {:ok, _} =
                  transition_db(actor, refreshed, %{
                    "status" => new_status,
                    "received_at" => if(new_status == "received", do: DateTime.utc_now() |> DateTime.truncate(:second)),
                    "updated_by_id" => actor.id
                  })
              end

              preload(refreshed)
            end)
        end
    end
  end

  defp validate_receive_lines(_po, []), do: {:error, :no_lines}

  defp validate_receive_lines(po, inputs) when is_list(inputs) do
    Enum.reduce_while(inputs, {:ok, []}, fn raw, {:ok, acc} ->
      input = stringify_keys(raw)
      line_uuid = input["line_uuid"]
      qty_raw = input["qty"]

      with %PurchaseOrderLine{} = line <- Enum.find(po.lines, fn l -> l.uuid == line_uuid end),
           {:ok, qty} <- parse_positive(qty_raw),
           :ok <- ensure_within_remaining(line, qty) do
        {:cont, {:ok, [{line, Map.put(input, :qty, qty)} | acc]}}
      else
        nil -> {:halt, {:error, {:line_not_found, line_uuid}}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, list} -> {:ok, Enum.reverse(list)}
      other -> other
    end
  end

  defp parse_positive(nil), do: {:error, :bad_qty}
  defp parse_positive(""), do: {:error, :bad_qty}

  defp parse_positive(raw) when is_binary(raw) do
    case Decimal.parse(String.trim(raw)) do
      {%Decimal{} = d, ""} ->
        if Decimal.gt?(d, 0), do: {:ok, d}, else: {:error, :bad_qty}

      _ ->
        {:error, :bad_qty}
    end
  end

  defp parse_positive(n) when is_number(n) and n > 0, do: {:ok, Decimal.new(to_string(n))}
  defp parse_positive(_), do: {:error, :bad_qty}

  defp ensure_within_remaining(%PurchaseOrderLine{qty_ordered: ordered, qty_received: received}, qty) do
    remaining = Decimal.sub(ordered || Decimal.new(0), received || Decimal.new(0))

    if Decimal.gt?(qty, remaining) do
      {:error, :over_receipt}
    else
      :ok
    end
  end

  defp build_lot_attrs(%PurchaseOrder{} = po, %PurchaseOrderLine{} = line, header_attrs, input) do
    %{
      "item_id" => line.item_id,
      "warehouse_id" => header_attrs["warehouse_id"],
      "qty_received" => Decimal.to_string(input.qty),
      "unit_cost" => line.unit_price && Decimal.to_string(line.unit_price),
      "currency" => po.currency_code,
      "supplier_batch_no" => header_attrs["supplier_batch_no"],
      "received_at" => header_attrs["received_at"],
      # The service-layer hand-off — `Stock.receive_lot/3` strips
      # user-supplied `source_kind` and reads ours from here. Keeps the
      # compliance rule honest (workers can't smuggle a kind) while
      # still letting the procurement boundary declare provenance.
      "__service_source_kind__" => "purchase_order",
      "__po_line_id__" => line.id,
      "source_ref" => Backend.Numbering.render(po.id, Repo.preload(po, :company).company, "purchase_order") || "PO##{po.id}",
      "package_length_mm" => input["package_length_mm"],
      "package_width_mm" => input["package_width_mm"],
      "package_height_mm" => input["package_height_mm"],
      "package_weight_kg" => input["package_weight_kg"],
      "units_per_package" => input["units_per_package"] || 1,
      "stack_factor" => input["stack_factor"] || 1,
      "status" => "received"
    }
  end

  defp compute_po_status_from_lines(%PurchaseOrder{lines: lines}) do
    cond do
      Enum.all?(lines, fn l ->
        Decimal.gte?(l.qty_received || Decimal.new(0), l.qty_ordered || Decimal.new(0))
      end) ->
        "received"

      Enum.any?(lines, fn l ->
        Decimal.gt?(l.qty_received || Decimal.new(0), Decimal.new(0))
      end) ->
        "partially_received"

      true ->
        "ordered"
    end
  end

  # ----- helpers ----------------------------------------------------

  defp preload(%PurchaseOrder{} = po) do
    Repo.preload(
      po,
      [
        :vendor,
        :created_by,
        :updated_by,
        :submitted_by,
        :ordered_by,
        :cancelled_by,
        lines: [:item],
        approvals: [:signed_by]
      ],
      force: true
    )
  end

  defp snapshot(%PurchaseOrder{} = po),
    do: Map.new(@po_audit_fields, fn k -> {k, Map.get(po, k)} end)

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
