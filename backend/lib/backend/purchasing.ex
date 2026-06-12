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
    PurchaseOrderFile,
    PurchaseOrderLine,
    VendorPrices
  }
  alias Backend.Repo
  alias Backend.Storage
  alias Backend.Vendors

  @po_audit_fields ~w(status vendor_id currency_code subtotal discount_pct
                      discount_amount tax_rate tax_amount shipping_fees
                      additional_fees grand_total total_amount
                      default_warehouse_id expected_delivery_date
                      delivery_address notes submitted_at ordered_at
                      received_at cancelled_at cancellation_reason)a
  @po_sortable ~w(id status grand_total total_amount expected_delivery_date inserted_at submitted_at ordered_at)a
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
      |> preload([:vendor, :created_by, :submitted_by, :default_warehouse, :lines])

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
              :default_warehouse,
              # `:stock_uom` on `item` so the mobile pre-receive
              # checklist + any other "qty + uom" renderer can show
              # the symbol without a second fetch.
              lines: [item: :stock_uom, warehouse: []],
              approvals: [:signed_by],
              files: [:uploaded_by]
            ]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  # ----- create / update header ------------------------------------

  @doc """
  Create a draft PO. If `attrs` omits `tax_rate` or `currency_code` and
  the vendor has a standing value, we pre-fill from the vendor — buyers
  shouldn't have to retype something already on the supplier record,
  and a stray omission shouldn't silently zero out the VAT.
  """
  def create(%User{} = actor, company_id, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })
      |> apply_vendor_defaults()

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
  Create a draft PO + its initial lines in one transaction, then run
  totals once at the end. Used by the single-page create form so the
  buyer presses Save once and gets a fully-shaped PO back instead of
  juggling three round-trips.

  Rolls back the whole thing if any line fails to validate — a half-
  inserted PO with no lines is worse than a fresh attempt.
  """
  def create_with_lines(%User{} = actor, attrs, lines_attrs)
      when is_list(lines_attrs) do
    company_id = attrs[:company_id] || attrs["company_id"] || actor.company_id

    Repo.transaction(fn ->
      with {:ok, po} <- create(actor, company_id, attrs),
           {:ok, _lines} <- insert_lines_for(actor, po, lines_attrs),
           {:ok, recomputed} <- recompute_totals(po) do
        preload(recomputed)
      else
        {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  defp insert_lines_for(_actor, _po, []), do: {:ok, []}

  defp insert_lines_for(%User{} = actor, %PurchaseOrder{} = po, lines_attrs) do
    Enum.reduce_while(lines_attrs, {:ok, []}, fn line_attrs, {:ok, acc} ->
      # We're already inside a Repo.transaction; insert directly so a
      # bad line bubbles a real changeset back up the with-chain rather
      # than nesting a transaction-in-transaction.
      attrs =
        line_attrs
        |> stringify_keys()
        |> Map.merge(%{
          "purchase_order_id" => po.id,
          "company_id" => po.company_id
        })
        |> compute_line_subtotal()

      case %PurchaseOrderLine{}
           |> PurchaseOrderLine.changeset(attrs)
           |> Repo.insert() do
        {:ok, line} ->
          Audit.record_created(actor, "purchase_order_line", line, %{
            item_id: line.item_id,
            qty_ordered: line.qty_ordered,
            unit_price: line.unit_price
          })

          {:cont, {:ok, [line | acc]}}

        {:error, cs} ->
          {:halt, {:error, cs}}
      end
    end)
    |> case do
      {:ok, lines} -> {:ok, Enum.reverse(lines)}
      other -> other
    end
  end

  # Pull vendor's standing tax_rate + currency onto the create attrs
  # when the caller didn't supply them. Worker-typed values win, then
  # vendor-row values, then company-wide defaults from
  # `/settings/company`.
  defp apply_vendor_defaults(attrs) do
    vendor_id = attrs["vendor_id"] || attrs[:vendor_id]
    company = Backend.Companies.current()

    attrs =
      case fetch_vendor(vendor_id) do
        nil ->
          attrs

        vendor ->
          attrs
          |> default_attr("tax_rate", vendor.tax_rate)
          |> default_attr("currency_code", vendor.currency_code)
      end

    attrs
    |> default_attr("tax_rate", company && company.tax_rate)
    |> default_attr("currency_code", company && company.currency_code)
  end

  defp fetch_vendor(nil), do: nil
  defp fetch_vendor(""), do: nil

  defp fetch_vendor(id) when is_integer(id), do: Repo.get(Backend.Vendors.Vendor, id)

  defp fetch_vendor(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> Repo.get(Backend.Vendors.Vendor, n)
      _ -> nil
    end
  end

  defp fetch_vendor(_), do: nil

  defp default_attr(attrs, _key, nil), do: attrs

  defp default_attr(attrs, key, value) do
    case Map.get(attrs, key) do
      nil -> Map.put(attrs, key, value)
      "" -> Map.put(attrs, key, value)
      _ -> attrs
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
      cast_attrs = attrs |> stringify_keys() |> Map.put("updated_by_id", actor.id)

      Repo.transaction(fn ->
        with {:ok, updated} <-
               po |> PurchaseOrder.changeset(cast_attrs) |> Repo.update(),
             # Any change to discount_pct / tax_rate / shipping_fees /
             # additional_fees needs to flow back into the denormalised
             # totals — easier to just recompute every header update than
             # to diff which money column moved.
             {:ok, recomputed} <- recompute_totals(updated) do
          Audit.record_updated(actor, "purchase_order", recomputed, before_state, snapshot(recomputed))
          preload(recomputed)
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
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
             {:ok, _po} <- recompute_totals(po) do
          Audit.record_created(actor, "purchase_order_line", line, %{
            item_id: line.item_id,
            qty_ordered: line.qty_ordered,
            unit_price: line.unit_price
          })

          Repo.preload(line, [:item, :warehouse])
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
             {:ok, _po} <- recompute_totals(po) do
          Audit.record_updated(actor, "purchase_order_line", updated, before_state, %{
            qty_ordered: updated.qty_ordered,
            unit_price: updated.unit_price,
            item_id: updated.item_id
          })

          Repo.preload(updated, [:item, :warehouse])
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
            {:ok, _} = recompute_totals(po)

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

  @doc """
  Re-derive the four computed money columns on a PO from the lines
  + the user-typed rates / fees on the header. The contract:

      subtotal        = Σ line.line_subtotal
      discount_amount = subtotal × discount_pct / 100
      tax_amount      = (subtotal − discount_amount) × tax_rate / 100
      grand_total     = subtotal − discount_amount
                        + tax_amount
                        + shipping_fees
                        + additional_fees

  Every component is rounded to 2dp because that's how money renders
  in the UI and what the supplier sees on the printed PO. We round
  each leg (discount_amount, tax_amount) before folding into
  grand_total so the displayed footer always re-adds to grand_total
  exactly — no off-by-one-penny mismatch between the row and the
  total.

  The legacy `total_amount` column is kept in step with `grand_total`
  for backwards compatibility with any v1 caller that hasn't migrated.
  """
  def recompute_totals(%PurchaseOrder{} = po) do
    # Reload from DB so the latest line_subtotals are summed — callers
    # often hold a stale `po` struct from before they mutated lines.
    po = Repo.get!(PurchaseOrder, po.id)
    lines = Repo.all(from l in PurchaseOrderLine, where: l.purchase_order_id == ^po.id)

    subtotal =
      Enum.reduce(lines, Decimal.new(0), fn line, acc ->
        Decimal.add(acc, line.line_subtotal || Decimal.new(0))
      end)
      |> Decimal.round(2)

    discount_pct = po.discount_pct || Decimal.new(0)
    tax_rate = po.tax_rate || Decimal.new(0)
    shipping = po.shipping_fees || Decimal.new(0)
    additional = po.additional_fees || Decimal.new(0)

    discount_amount =
      subtotal
      |> Decimal.mult(discount_pct)
      |> Decimal.div(100)
      |> Decimal.round(2)

    taxable = Decimal.sub(subtotal, discount_amount)

    tax_amount =
      taxable
      |> Decimal.mult(tax_rate)
      |> Decimal.div(100)
      |> Decimal.round(2)

    grand_total =
      subtotal
      |> Decimal.sub(discount_amount)
      |> Decimal.add(tax_amount)
      |> Decimal.add(shipping)
      |> Decimal.add(additional)
      |> Decimal.round(2)

    po
    |> PurchaseOrder.totals_changeset(%{
      "subtotal" => subtotal,
      "discount_amount" => discount_amount,
      "tax_amount" => tax_amount,
      "grand_total" => grand_total,
      "total_amount" => grand_total
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
             :ok <- ensure_lines_approved_by_vendor(po),
             :ok <- ensure_lines_items_ready(po) do
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

  # PO lines can only reference items whose compliance file has been
  # signed off (`compliance_status = "ready_for_use"`). Items still in
  # `draft` are missing fields that auditors will score against — they
  # don't get a PO line. Surfaced as a `:item_not_ready` error with the
  # offending item_id so the FE can name the SKU in the message.
  defp ensure_lines_items_ready(%PurchaseOrder{lines: lines}) do
    item_ids = Enum.map(lines, & &1.item_id) |> Enum.uniq()

    draft_ids =
      from(i in Backend.Items.Item,
        where: i.id in ^item_ids and i.compliance_status != "ready_for_use",
        select: i.id
      )
      |> Repo.all()

    case draft_ids do
      [] -> :ok
      [first | _] -> {:error, {:item_not_ready, first}}
    end
  end

  # ----- receive against PO ---------------------------------------

  @doc """
  Record a receipt against an open PO with heterogeneous packaging.
  One PO line can land as N independent packs (e.g. 4×25kg drums + 1
  dented drum on a different batch); each pack becomes its own
  `stock_lot` row so QC, traceability and put-away can act on them
  independently.

  Wire format (string keys, mirrors the controller body):

      %{
        "warehouse_id" => 2,                      # required — every lot lands here
        "supplier_batch_no_default" => "BA-...",  # optional fallback for packs that don't override
        "received_at" => "2026-06-11T09:00:00Z",  # optional
        "lines" => [
          %{
            "line_uuid" => "...",
            "packs" => [
              %{
                # Required per-pack
                "qty" => "100",
                "package_length_mm" => 400,
                "package_width_mm" => 300,
                "package_height_mm" => 250,
                "package_weight_kg" => "25.000",
                "units_per_package" => 4,
                "stack_factor" => 1,
                # Optional per-pack overrides
                "supplier_batch_no" => "BA-...",
                "manufactured_at" => "2026-05-15",
                "expiry_at" => "2027-05-15",
                "country_of_origin" => "IT",
                "revision" => "V01",
                "route_to_quarantine" => false
              },
              ...
            ]
          },
          ...
        ]
      }

  Rules:
    * A line entry with `packs: []` is a no-op (worker is skipping it).
    * `sum(pack.qty)` across a single line must be ≤ the line's
      remaining qty — over-receipt rolls back the whole transaction.
    * Every pack creates one `stock_lot` via `Stock.receive_lot/3`.
    * `route_to_quarantine: true` emits a follow-up
      `routed_to_quarantine` lifecycle event after the `received` event.

  The legacy `lines: [{line_uuid, qty}]` shape is **rejected** with
  `{:error, :legacy_shape_unsupported}` — the FE rewrite is happening
  in parallel and we want a clean break rather than a silent
  translation that hides drift.
  """
  def receive_against_po(%Backend.Accounts.User{} = actor, %PurchaseOrder{} = po, attrs) do
    cond do
      po.status not in ["ordered", "partially_received"] ->
        {:error, :bad_status}

      true ->
        po = preload(po)
        attrs = stringify_keys(attrs)
        line_inputs = Map.get(attrs, "lines") || []
        batch_default = attrs["supplier_batch_no_default"]
        source_ref = render_po_code(po)

        warehouse_id = parse_warehouse_id(attrs["warehouse_id"])

        # Optional: the FE starts a draft goods-in inspection FIRST,
        # then includes its integer id on the receive call. Every lot
        # this call creates gets stamped with that id, so the
        # approver's sign transaction can find all of them with a
        # single FK lookup. Absence = legacy / manual path; lots stay
        # null and route through the existing quarantine-by-default
        # → expedite-release flow.
        goods_in_inspection_id =
          parse_inspection_id(attrs["goods_in_inspection_id"])

        with :ok <- ensure_not_legacy_shape(line_inputs),
             :ok <- ensure_warehouse_id(warehouse_id),
             :ok <- ensure_warehouse_ready_for_receive(warehouse_id),
             {:ok, normalised} <- validate_receive_lines(po, line_inputs) do
          Repo.transaction(fn ->
            Enum.each(normalised, fn {%PurchaseOrderLine{} = line, packs} ->
              receive_packs_for_line(
                actor,
                po,
                line,
                packs,
                batch_default,
                source_ref,
                warehouse_id,
                goods_in_inspection_id
              )
            end)

            # Recompute PO status from line aggregates after every line
            # has been touched. A zero-pack line is a no-op — the
            # status only flips when at least one pack landed somewhere.
            refreshed = Repo.get!(PurchaseOrder, po.id) |> Repo.preload(:lines)
            new_status = compute_po_status_from_lines(refreshed)

            settled =
              if new_status != po.status do
                {:ok, transitioned} =
                  transition_db(actor, refreshed, %{
                    "status" => new_status,
                    "received_at" =>
                      if(new_status == "received",
                        do: DateTime.utc_now() |> DateTime.truncate(:second)
                      ),
                    "updated_by_id" => actor.id
                  })

                transitioned
              else
                refreshed
              end

            preload(settled)
          end)
        end
    end
  end

  # The old wire format keyed each line by a single `qty`. We refuse
  # to translate silently — heterogeneous packaging needs explicit
  # packs from the caller, and accepting both shapes hides FE drift.
  defp ensure_not_legacy_shape(inputs) when is_list(inputs) do
    legacy? =
      Enum.any?(inputs, fn raw ->
        m = stringify_keys(raw)
        Map.has_key?(m, "qty") and not Map.has_key?(m, "packs")
      end)

    if legacy?, do: {:error, :legacy_shape_unsupported}, else: :ok
  end

  defp ensure_not_legacy_shape(_), do: :ok

  defp parse_warehouse_id(nil), do: nil
  defp parse_warehouse_id(n) when is_integer(n) and n > 0, do: n

  defp parse_warehouse_id(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} when n > 0 -> n
      _ -> nil
    end
  end

  defp parse_warehouse_id(_), do: nil

  defp ensure_warehouse_id(nil), do: {:error, :warehouse_required}
  defp ensure_warehouse_id(_), do: :ok

  # Refuse receive on warehouses missing the regulatory-mandated
  # quarantine / hold / rejected segregation cells. Each blocker
  # carries its own auditor-facing reason so the controller can
  # surface a useful error instead of "warehouse_not_ready".
  defp ensure_warehouse_ready_for_receive(warehouse_id) do
    case Backend.Warehouses.Readiness.check(warehouse_id) do
      %{ready?: true} -> :ok
      %{blockers: blockers} -> {:error, {:warehouse_not_ready, blockers}}
    end
  end

  defp receive_packs_for_line(_actor, _po, _line, [], _batch_default, _source_ref, _warehouse_id, _gi_id), do: :ok

  defp receive_packs_for_line(actor, %PurchaseOrder{} = po, %PurchaseOrderLine{} = line, packs, batch_default, source_ref, warehouse_id, goods_in_inspection_id) do
    {final_line, _} =
      Enum.reduce(packs, {line, 0}, fn pack, {acc_line, idx} ->
        lot_attrs =
          build_lot_attrs(
            po,
            acc_line,
            pack,
            batch_default,
            source_ref,
            warehouse_id,
            goods_in_inspection_id
          )

        lot =
          case Backend.Stock.receive_lot(actor, po.company_id, lot_attrs) do
            {:ok, lot} -> lot
            {:error, reason} -> Repo.rollback({:lot_create_failed, acc_line.uuid, idx, reason})
          end

        # COMPLIANCE: every received lot routes to quarantine. The
        # Goods-In Inspection (D.3b) is the only path to `qc_passed`;
        # receivers don't get a skip switch. Per BRCGS 3.5.1 / FSSC
        # 22000 / GFSI standards + psp/CLAUDE.md ("incoming inspection
        # is the default"). The legacy `route_to_quarantine` payload
        # flag is now ignored — quarantine is unconditional.
        case Backend.Stock.Lifecycle.record_event_in_transaction(
               lot,
               "routed_to_quarantine",
               %{
                 actor: actor,
                 actor_kind: "system",
                 reason: "Incoming inspection — quarantine by default",
                 metadata: %{
                   "po_line_id" => acc_line.id,
                   "po_id" => po.id,
                   "source_ref" => source_ref
                 }
               }
             ) do
          {:ok, _} ->
            :ok

          {:error, :illegal_transition, info} ->
            Repo.rollback({:lot_create_failed, acc_line.uuid, idx, {:illegal_transition, info}})

          {:error, reason} ->
            Repo.rollback({:lot_create_failed, acc_line.uuid, idx, reason})
        end

        new_received = Decimal.add(acc_line.qty_received || Decimal.new(0), pack[:qty])

        updated_line =
          acc_line
          |> PurchaseOrderLine.changeset(%{"qty_received" => new_received})
          |> Repo.update!()

        # Refresh the last-paid cache so the next PO line for this
        # (vendor, item, currency) can pre-fill and warn on ±20%
        # deviation. Cache failures don't roll back the receipt — the
        # lot is already created and the cache is rebuildable from PO
        # history.
        _ = VendorPrices.upsert_from_receipt(po, updated_line)

        {updated_line, idx + 1}
      end)

    final_line
  end

  defp validate_receive_lines(_po, []), do: {:error, :no_lines}

  defp validate_receive_lines(po, inputs) when is_list(inputs) do
    Enum.reduce_while(inputs, {:ok, []}, fn raw, {:ok, acc} ->
      input = stringify_keys(raw)
      line_uuid = input["line_uuid"]
      packs_raw = input["packs"] || []

      with %PurchaseOrderLine{} = line <- find_open_line(po, line_uuid),
           :ok <- ensure_line_open(line),
           {:ok, packs} <- validate_packs(packs_raw),
           :ok <- ensure_sum_within_remaining(line, packs) do
        {:cont, {:ok, [{line, packs} | acc]}}
      else
        :line_not_found -> {:halt, {:error, {:bad_line_uuid, line_uuid}}}
        :line_locked -> {:halt, {:error, {:line_locked, line_uuid}}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, list} -> {:ok, Enum.reverse(list)}
      other -> other
    end
  end

  defp validate_receive_lines(_po, _), do: {:error, :no_lines}

  defp find_open_line(%PurchaseOrder{lines: lines}, line_uuid) when is_binary(line_uuid) do
    case Enum.find(lines, fn l -> l.uuid == line_uuid end) do
      nil -> :line_not_found
      %PurchaseOrderLine{} = line -> line
    end
  end

  defp find_open_line(_, _), do: :line_not_found

  # PO lines have no per-row lifecycle column today — "locked" really
  # means the parent PO is in a terminal state. We've already gated
  # that at the entry point; this hook is here so a future per-line
  # cancel flag can plug in without changing the validation skeleton.
  defp ensure_line_open(%PurchaseOrderLine{}), do: :ok

  defp validate_packs(packs) when is_list(packs) do
    packs
    |> Enum.with_index()
    |> Enum.reduce_while({:ok, []}, fn {raw, idx}, {:ok, acc} ->
      case validate_pack(stringify_keys(raw), idx) do
        {:ok, pack} -> {:cont, {:ok, [pack | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, list} -> {:ok, Enum.reverse(list)}
      other -> other
    end
  end

  defp validate_packs(_), do: {:error, :bad_packs}

  defp validate_pack(pack, idx) when is_map(pack) do
    # Qty failures stay surfaced as `:non_positive_qty` because that's
    # the worker-facing axis; the rest of the dim fields collapse to a
    # single `:non_positive_dim` so the FE just highlights the
    # packaging block. Weight is a dim — not a qty — despite using a
    # Decimal parser.
    with {:ok, qty} <- parse_positive_decimal(pack["qty"]) |> remap_err(:non_positive_qty),
         {:ok, length_mm} <- parse_positive_integer(pack["package_length_mm"]) |> remap_err(:non_positive_dim),
         {:ok, width_mm} <- parse_positive_integer(pack["package_width_mm"]) |> remap_err(:non_positive_dim),
         {:ok, height_mm} <- parse_positive_integer(pack["package_height_mm"]) |> remap_err(:non_positive_dim),
         {:ok, weight_kg} <- parse_positive_decimal(pack["package_weight_kg"]) |> remap_err(:non_positive_dim),
         {:ok, units_per} <- parse_positive_integer(pack["units_per_package"]) |> remap_err(:non_positive_dim),
         {:ok, stack} <- parse_positive_integer(pack["stack_factor"]) |> remap_err(:non_positive_dim) do
      {:ok,
       %{
         index: idx,
         qty: qty,
         package_length_mm: length_mm,
         package_width_mm: width_mm,
         package_height_mm: height_mm,
         package_weight_kg: weight_kg,
         units_per_package: units_per,
         stack_factor: stack,
         supplier_batch_no: trim_or_nil(pack["supplier_batch_no"]),
         manufactured_at: trim_or_nil(pack["manufactured_at"]),
         expiry_at: trim_or_nil(pack["expiry_at"]),
         country_of_origin: trim_or_nil(pack["country_of_origin"]),
         revision: trim_or_nil(pack["revision"]),
         route_to_quarantine: pack["route_to_quarantine"] == true
       }}
    else
      {:error, code} -> {:error, {code, idx}}
    end
  end

  defp validate_pack(_, idx), do: {:error, {:non_positive_dim, idx}}

  defp remap_err({:ok, _} = ok, _code), do: ok
  defp remap_err({:error, _}, code), do: {:error, code}

  defp parse_positive_decimal(nil), do: {:error, :non_positive_qty}
  defp parse_positive_decimal(""), do: {:error, :non_positive_qty}

  defp parse_positive_decimal(%Decimal{} = d) do
    if Decimal.gt?(d, 0), do: {:ok, d}, else: {:error, :non_positive_qty}
  end

  defp parse_positive_decimal(raw) when is_binary(raw) do
    case Decimal.parse(String.trim(raw)) do
      {%Decimal{} = d, ""} ->
        if Decimal.gt?(d, 0), do: {:ok, d}, else: {:error, :non_positive_qty}

      _ ->
        {:error, :non_positive_qty}
    end
  end

  defp parse_positive_decimal(n) when is_integer(n) or is_float(n) do
    parse_positive_decimal(to_string(n))
  end

  defp parse_positive_decimal(_), do: {:error, :non_positive_qty}

  defp parse_positive_integer(nil), do: {:error, :non_positive_dim}
  defp parse_positive_integer(""), do: {:error, :non_positive_dim}

  defp parse_positive_integer(n) when is_integer(n) do
    if n > 0, do: {:ok, n}, else: {:error, :non_positive_dim}
  end

  defp parse_positive_integer(raw) when is_binary(raw) do
    case Integer.parse(String.trim(raw)) do
      {n, ""} when n > 0 -> {:ok, n}
      _ -> {:error, :non_positive_dim}
    end
  end

  defp parse_positive_integer(_), do: {:error, :non_positive_dim}

  defp trim_or_nil(nil), do: nil
  defp trim_or_nil(""), do: nil

  defp trim_or_nil(raw) when is_binary(raw) do
    case String.trim(raw) do
      "" -> nil
      s -> s
    end
  end

  defp trim_or_nil(v), do: v

  defp ensure_sum_within_remaining(%PurchaseOrderLine{} = line, packs) do
    total =
      Enum.reduce(packs, Decimal.new(0), fn pack, acc ->
        Decimal.add(acc, pack[:qty])
      end)

    remaining =
      Decimal.sub(
        line.qty_ordered || Decimal.new(0),
        line.qty_received || Decimal.new(0)
      )

    if Decimal.gt?(total, remaining) do
      {:error, {:over_receipt, line.uuid}}
    else
      :ok
    end
  end

  defp build_lot_attrs(
         %PurchaseOrder{} = po,
         %PurchaseOrderLine{} = line,
         pack,
         batch_default,
         source_ref,
         warehouse_id,
         goods_in_inspection_id
       ) do
    item = fetch_line_item(line)
    batch_no = pack[:supplier_batch_no] || batch_default

    %{
      "item_id" => line.item_id,
      "unit_of_measurement_id" => item && item.stock_uom_id,
      "warehouse_id" => warehouse_id,
      "qty_received" => Decimal.to_string(pack[:qty]),
      "unit_cost" => line.unit_price && Decimal.to_string(line.unit_price),
      "currency" => po.currency_code,
      "supplier_batch_no" => batch_no,
      "country_of_origin" => pack[:country_of_origin],
      "manufactured_at" => pack[:manufactured_at],
      "expiry_at" => pack[:expiry_at],
      "revision" => pack[:revision],
      # The service-layer hand-off — `Stock.receive_lot/3` strips
      # user-supplied `source_kind` and reads ours from here. Keeps the
      # compliance rule honest (workers can't smuggle a kind) while
      # still letting the procurement boundary declare provenance.
      "__service_source_kind__" => "purchase_order",
      "__po_line_id__" => line.id,
      # Optional FK to the draft Goods-In Inspection that owns this
      # delivery. Stock.receive_lot/3 reads the `__...__` key (the
      # service-layer hand-off convention) and stamps the lot.
      "__goods_in_inspection_id__" => goods_in_inspection_id,
      "source_ref" => source_ref,
      "package_length_mm" => pack[:package_length_mm],
      "package_width_mm" => pack[:package_width_mm],
      "package_height_mm" => pack[:package_height_mm],
      "package_weight_kg" => pack[:package_weight_kg],
      "units_per_package" => pack[:units_per_package],
      "stack_factor" => pack[:stack_factor],
      "status" => "received"
    }
  end

  # The receive payload may carry a `goods_in_inspection_id` (integer
  # or numeric string). Returns the parsed integer or nil — absence
  # means the legacy / manual path where the lot routes through the
  # quarantine-by-default → expedite-release flow.
  defp parse_inspection_id(nil), do: nil
  defp parse_inspection_id(id) when is_integer(id) and id > 0, do: id

  defp parse_inspection_id(id) when is_binary(id) do
    case Integer.parse(id) do
      {n, ""} when n > 0 -> n
      _ -> nil
    end
  end

  defp parse_inspection_id(_), do: nil

  defp fetch_line_item(%PurchaseOrderLine{item: %Backend.Items.Item{} = i}), do: i
  defp fetch_line_item(%PurchaseOrderLine{item_id: id}), do: Repo.get(Backend.Items.Item, id)

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
        :default_warehouse,
        lines: [:item, :warehouse],
        approvals: [:signed_by],
        files: [:uploaded_by]
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

  # ----- file attachments ------------------------------------------

  @doc """
  Persist the metadata for an uploaded PO file. Bytes are already on
  disk via `Backend.Storage`; this records the row + uploader so the
  file can be served back with provenance later.

  Mirrors `Backend.Vendors.record_file/3` so the FE upload component
  works the same way against either parent.
  """
  def upload_file(%User{} = actor, %PurchaseOrder{} = po, attrs, bytes)
      when is_binary(bytes) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("company_id", po.company_id)
      |> Map.put("purchase_order_id", po.id)
      |> Map.put("uploaded_by_id", actor.id)

    key = build_file_storage_key(po, attrs)

    case Storage.put(key, bytes, content_type: attrs["mime"]) do
      {:ok, blob_path} ->
        attrs = Map.put(attrs, "blob_path", blob_path)

        %PurchaseOrderFile{}
        |> PurchaseOrderFile.changeset(attrs)
        |> Repo.insert()
        |> case do
          {:ok, file} ->
            Audit.record_created(actor, "purchase_order_file", file, %{
              purchase_order_id: file.purchase_order_id,
              kind: file.kind,
              filename: file.filename
            })

            {:ok, Repo.preload(file, :uploaded_by)}

          {:error, cs} ->
            # Insert lost — strand the blob? Drop it so we don't leak.
            # Storage delete failure is best-effort; the row didn't
            # land so an orphan blob is harmless.
            _ = Storage.delete(blob_path)
            {:error, cs}
        end

      {:error, reason} ->
        {:error, {:storage_failed, reason}}
    end
  end

  @doc """
  Remove a PO file — wipes both the blob and the metadata row. Best-
  effort on the storage side: a stuck blob is harmless once the FK
  is gone, but a row pointing at missing bytes would 404 every fetch.
  """
  def delete_file(%User{} = actor, %PurchaseOrder{} = _po, %PurchaseOrderFile{} = file) do
    Repo.transaction(fn ->
      case Repo.delete(file) do
        {:ok, deleted} ->
          _ = Storage.delete(file.blob_path)

          Audit.record_deleted(actor, "purchase_order_file", file, %{
            purchase_order_id: file.purchase_order_id,
            kind: file.kind,
            filename: file.filename
          })

          deleted

        {:error, reason} ->
          Repo.rollback(reason)
      end
    end)
  end

  @doc "Look up a file row scoped to the given PO."
  def get_file(po_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(f in PurchaseOrderFile,
            where: f.purchase_order_id == ^po_id and f.uuid == ^cast,
            preload: [:uploaded_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_file(_, _), do: nil

  defp build_file_storage_key(%PurchaseOrder{} = po, attrs) do
    kind = attrs["kind"] || "other"
    filename = attrs["filename"] || "upload"

    "po_files/" <>
      po.uuid <>
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
end
