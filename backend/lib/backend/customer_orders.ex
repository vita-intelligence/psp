defmodule Backend.CustomerOrders do
  @moduledoc """
  Boundary for the customer-order registry + lines + ESIGN approvals.

  Sell-side mirror of `Backend.Purchasing` — same state-machine shape,
  same 2-tier ESIGN posture, sell-side semantics throughout.

  State flow:

      draft → pending_approver → pending_director → approved → confirmed
        (any non-terminal → cancelled with reason)

  Submit gates (defence in depth — UI also enforces):
    * Lines present
    * Default warehouse set
    * Customer is effectively approved (Customers.approval_active?/1)
    * Items are sellable to this customer
      (customer_approved_items empty ⇒ all allowed; non-empty ⇒ check)
    * Trade credit limit not breached when this CO is added to
      outstanding A/R

  Segregation of duties (sign_director):
    * Director signer must differ from approver signer.

  Identity columns (customer_id, currency_code) lock after the CO
  leaves draft — the changeset still accepts them, but the context
  rejects edits via `update_header/3`'s draft-only guard.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Customers
  alias Backend.CustomerOrders.{
    CustomerOrder,
    CustomerOrderApproval,
    CustomerOrderFile,
    CustomerOrderLine
  }
  alias Backend.ListQueries
  alias Backend.Pricelists
  alias Backend.Repo

  @co_audit_fields ~w(status customer_id currency_code subtotal discount_pct
                      discount_amount tax_rate tax_amount shipping_fees
                      additional_fees grand_total expected_ship_date
                      delivery_address customer_reference notes
                      default_warehouse_id submitted_at confirmed_at
                      cancelled_at cancellation_reason)a

  @co_sortable ~w(id status expected_ship_date grand_total inserted_at)a
  @co_search ~w(customer_reference notes delivery_address)a
  @co_default_sort {:inserted_at, :desc}

  # ----- list / get -----------------------------------------------

  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = normalise_sort(Keyword.get(opts, :sort, @co_default_sort))

    base =
      CustomerOrder
      |> where([co], co.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @co_search)
      |> maybe_status_filter(opts[:status])
      |> maybe_customer_filter(opts[:customer_id])
      |> ListQueries.apply_column_filters(opts[:column_filter], @co_sortable)
      |> ListQueries.apply_sort(sort, @co_sortable, @co_default_sort)
      |> preload([
        :customer,
        :created_by,
        :updated_by,
        :submitted_by,
        :confirmed_by,
        :cancelled_by,
        :default_warehouse,
        :approvals,
        :files
      ])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  defp maybe_status_filter(query, nil), do: query
  defp maybe_status_filter(query, ""), do: query

  defp maybe_status_filter(query, status) when is_binary(status),
    do: where(query, [co], co.status == ^status)

  defp maybe_customer_filter(query, nil), do: query
  defp maybe_customer_filter(query, ""), do: query

  defp maybe_customer_filter(query, id) when is_integer(id),
    do: where(query, [co], co.customer_id == ^id)

  defp maybe_customer_filter(query, id) when is_binary(id) do
    case Integer.parse(id) do
      {n, ""} -> where(query, [co], co.customer_id == ^n)
      _ -> query
    end
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        CustomerOrder
        |> where([co], co.company_id == ^company_id and co.uuid == ^cast)
        |> Repo.one()
        |> case do
          nil -> nil
          co -> preload_co(co)
        end

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  # ----- create / update / delete ---------------------------------

  @doc """
  Create a draft CO from header attrs. Applies the customer's
  defaults (currency_code, tax_rate, payment terms come along on
  the customer payload — UI uses them when populating the form,
  not the context, so we don't smuggle them here).
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

    # Customer-approval gate at the create boundary, not just at
    # submit. The FE picker already hides unapproved customers, but
    # a direct API call (or a customer suspended after the picker
    # render) could otherwise land an orphan draft that can never be
    # submitted. Closing the loop here keeps the chronology strict:
    # approve the customer first, then create the order.
    with :ok <- ensure_customer_approved_for_create(company_id, attrs["customer_id"]) do
      %CustomerOrder{}
      |> CustomerOrder.changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, co} ->
          Audit.record_created(actor, "customer_order", co, co_snapshot(co))
          {:ok, preload_co(co)}

        other ->
          other
      end
    end
  end

  defp ensure_customer_approved_for_create(_company_id, nil),
    do: {:error, :customer_required}

  defp ensure_customer_approved_for_create(company_id, customer_id) do
    case Repo.get(Backend.Customers.Customer, customer_id) do
      nil ->
        {:error, :customer_not_found}

      %{company_id: cid} when cid != company_id ->
        {:error, :customer_not_found}

      customer ->
        if Customers.approval_active?(customer),
          do: :ok,
          else: {:error, :customer_not_approved}
    end
  end

  def update_header(%User{} = actor, %CustomerOrder{status: "draft"} = co, attrs) do
    before_state = co_snapshot(co)
    attrs = attrs |> stringify_keys() |> Map.put("updated_by_id", actor.id)

    co
    |> CustomerOrder.changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "customer_order",
          updated,
          before_state,
          co_snapshot(updated)
        )

        {:ok, _} = recompute_totals(updated)
        {:ok, preload_co(updated)}

      other ->
        other
    end
  end

  def update_header(_actor, %CustomerOrder{}, _attrs), do: {:error, :bad_status}

  def delete(%User{} = actor, %CustomerOrder{status: "draft"} = co) do
    before_state = co_snapshot(co)

    case Repo.delete(co) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "customer_order", co, before_state)
        {:ok, deleted}

      other ->
        other
    end
  end

  def delete(_actor, %CustomerOrder{}), do: {:error, :bad_status}

  # ----- lines ----------------------------------------------------

  def add_line(%User{} = actor, %CustomerOrder{status: "draft"} = co, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "customer_order_id" => co.id,
        "company_id" => co.company_id,
        # Fall back to CO-default warehouse when the line didn't override.
        "warehouse_id" =>
          Map.get(attrs, "warehouse_id") || Map.get(attrs, :warehouse_id) ||
            co.default_warehouse_id
      })
      |> stamp_line_subtotal()

    %CustomerOrderLine{}
    |> CustomerOrderLine.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, line} ->
        Audit.record_created(actor, "customer_order_line", line, %{
          customer_order_id: line.customer_order_id,
          item_id: line.item_id,
          qty_ordered: line.qty_ordered,
          unit_price: line.unit_price
        })

        {:ok, _} = recompute_totals(co)
        {:ok, Repo.preload(line, [item: :stock_uom])}

      other ->
        other
    end
  end

  def add_line(_actor, %CustomerOrder{}, _attrs), do: {:error, :bad_status}

  def update_line(%User{} = actor, %CustomerOrderLine{} = line, attrs) do
    co = Repo.get!(CustomerOrder, line.customer_order_id)

    if co.status != "draft" do
      {:error, :bad_status}
    else
      before_state = %{
        item_id: line.item_id,
        qty_ordered: line.qty_ordered,
        unit_price: line.unit_price,
        discount_pct: line.discount_pct,
        line_subtotal: line.line_subtotal,
        warehouse_id: line.warehouse_id
      }

      attrs = attrs |> stringify_keys() |> stamp_line_subtotal()

      line
      |> CustomerOrderLine.changeset(attrs)
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          Audit.record_updated(
            actor,
            "customer_order_line",
            updated,
            before_state,
            %{
              item_id: updated.item_id,
              qty_ordered: updated.qty_ordered,
              unit_price: updated.unit_price,
              discount_pct: updated.discount_pct,
              line_subtotal: updated.line_subtotal,
              warehouse_id: updated.warehouse_id
            }
          )

          {:ok, _} = recompute_totals(co)
          {:ok, Repo.preload(updated, [item: :stock_uom])}

        other ->
          other
      end
    end
  end

  def delete_line(%User{} = actor, %CustomerOrderLine{} = line) do
    co = Repo.get!(CustomerOrder, line.customer_order_id)

    if co.status != "draft" do
      {:error, :bad_status}
    else
      case Repo.delete(line) do
        {:ok, deleted} ->
          Audit.record_deleted(actor, "customer_order_line", line, %{
            customer_order_id: line.customer_order_id,
            item_id: line.item_id,
            qty_ordered: line.qty_ordered
          })

          {:ok, _} = recompute_totals(co)
          {:ok, deleted}

        other ->
          other
      end
    end
  end

  def get_line(co_id, uuid) when is_integer(co_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(l in CustomerOrderLine,
            where: l.customer_order_id == ^co_id and l.uuid == ^cast,
            preload: [item: :stock_uom]
          )
        )

      :error ->
        nil
    end
  end

  def get_line(_, _), do: nil

  # `line_subtotal = qty_ordered × unit_price × (1 - discount_pct/100)`.
  # Stored on insert/update so footer math is a sum, not a multiply-
  # then-sum per render.
  defp stamp_line_subtotal(attrs) do
    qty = to_dec(attrs["qty_ordered"])
    price = to_dec(attrs["unit_price"])
    disc = to_dec(attrs["discount_pct"] || 0)

    factor =
      Decimal.div(Decimal.sub(Decimal.new(100), disc), Decimal.new(100))

    subtotal =
      qty
      |> Decimal.mult(price)
      |> Decimal.mult(factor)
      |> Decimal.round(4)

    Map.put(attrs, "line_subtotal", subtotal)
  end

  defp to_dec(nil), do: Decimal.new(0)
  defp to_dec(%Decimal{} = d), do: d
  defp to_dec(n) when is_integer(n), do: Decimal.new(n)
  defp to_dec(n) when is_float(n), do: Decimal.from_float(n)

  defp to_dec(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, _} -> d
      :error -> Decimal.new(0)
    end
  end

  defp to_dec(_), do: Decimal.new(0)

  # ----- totals refresh -------------------------------------------

  @doc """
  Re-denormalise header totals from the live line set. Called after
  any line save / delete / header rate change.
  """
  def recompute_totals(%CustomerOrder{} = co) do
    co = Repo.get!(CustomerOrder, co.id)

    lines =
      Repo.all(from l in CustomerOrderLine, where: l.customer_order_id == ^co.id)

    subtotal =
      Enum.reduce(lines, Decimal.new(0), fn line, acc ->
        Decimal.add(acc, line.line_subtotal || Decimal.new(0))
      end)
      |> Decimal.round(2)

    discount_pct = co.discount_pct || Decimal.new(0)
    tax_rate = co.tax_rate || Decimal.new(0)
    shipping = co.shipping_fees || Decimal.new(0)
    additional = co.additional_fees || Decimal.new(0)

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

    co
    |> CustomerOrder.totals_changeset(%{
      "subtotal" => subtotal,
      "discount_amount" => discount_amount,
      "tax_amount" => tax_amount,
      "grand_total" => grand_total
    })
    |> Repo.update()
  end

  # ----- state machine --------------------------------------------

  @doc """
  Submit a draft CO for approval. Defence-in-depth gates:
    * Lines present
    * Default warehouse set
    * Customer is effectively approved
      (Customers.approval_active?/1 — covers approved + active + not
       overdue for re-qualification)
    * Items are sellable to this customer (per-customer approved-items
      list — empty list ⇒ OK; non-empty ⇒ every line item must be on it)
    * Trade credit limit OK when this CO is added to outstanding A/R
  """
  def submit(%User{} = actor, %CustomerOrder{} = co) do
    if co.status != "draft" do
      {:error, :bad_status}
    else
      co = preload_co(co)

      with :ok <- ensure_lines_present(co),
           :ok <- ensure_default_warehouse(co),
           :ok <- ensure_customer_approved(co),
           :ok <- ensure_items_sellable(co),
           :ok <- ensure_credit_limit_ok(co) do
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        transition(actor, co, %{
          "status" => "pending_approver",
          "submitted_at" => now,
          "submitted_by_id" => actor.id,
          "updated_by_id" => actor.id
        })
      end
    end
  end

  @doc """
  Approver-tier signature. Records a `customer_order_approvals` row +
  flips status to `pending_director`.
  """
  def sign_approver(%User{} = actor, %CustomerOrder{} = co, opts \\ %{}) do
    if co.status != "pending_approver" do
      {:error, :bad_status}
    else
      record_approval_and_advance(actor, co, "approver", "pending_director", opts)
    end
  end

  @doc """
  Director-tier signature. Must be a different user from the approver
  signer — segregation of duties enforced server-side.
  """
  def sign_director(%User{} = actor, %CustomerOrder{} = co, opts \\ %{}) do
    if co.status != "pending_director" do
      {:error, :bad_status}
    else
      with :ok <- ensure_different_signer(co, actor) do
        record_approval_and_advance(actor, co, "director", "approved", opts)
      end
    end
  end

  defp record_approval_and_advance(actor, co, kind, next_status, opts) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    Repo.transaction(fn ->
      with {:ok, approval} <-
             %CustomerOrderApproval{}
             |> CustomerOrderApproval.changeset(%{
               "customer_order_id" => co.id,
               "company_id" => co.company_id,
               "signed_by_id" => actor.id,
               "kind" => kind,
               "signed_at" => now,
               "notes" => Map.get(opts, "notes") || Map.get(opts, :notes),
               "signature_image" =>
                 Map.get(opts, "signature_image") ||
                   Map.get(opts, :signature_image)
             })
             |> Repo.insert(),
           {:ok, updated} <-
             transition_db(actor, co, %{
               "status" => next_status,
               "updated_by_id" => actor.id
             }) do
        Audit.record_created(actor, "customer_order_approval", approval, %{
          customer_order_id: approval.customer_order_id,
          kind: approval.kind,
          signed_by_id: approval.signed_by_id
        })

        preload_co(updated)
      else
        {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
    |> tap(fn
      {:ok, updated} -> Backend.OrderWizard.notify_co_changed(updated)
      _ -> :ok
    end)
  end

  defp ensure_different_signer(co, %User{} = actor) do
    co = preload_co(co)

    case Enum.find(co.approvals, fn a -> a.kind == "approver" end) do
      nil -> :ok
      %{signed_by_id: id} when id == actor.id -> {:error, :same_signer}
      _ -> :ok
    end
  end

  @doc """
  Operator stamps the CO as committed to the customer. Mirror of PO's
  `mark_ordered`. V1 has no side effects (V2 will reserve stock + raise
  a pick request when the warehouse pick flow ships).
  """
  def mark_confirmed(%User{} = actor, %CustomerOrder{} = co) do
    if co.status != "approved" do
      {:error, :bad_status}
    else
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      transition(actor, co, %{
        "status" => "confirmed",
        "confirmed_at" => now,
        "confirmed_by_id" => actor.id,
        "updated_by_id" => actor.id
      })
    end
  end

  def cancel(%User{} = actor, %CustomerOrder{} = co, reason) when is_binary(reason) do
    if co.status in ~w(confirmed cancelled) do
      # `confirmed` may need its own un-confirm flow in V2 (recall an
      # already-committed order). For V1, confirmed is terminal until
      # invoicing — block cancel here.
      {:error, :bad_status}
    else
      now = DateTime.utc_now() |> DateTime.truncate(:second)

      transition(actor, co, %{
        "status" => "cancelled",
        "cancelled_at" => now,
        "cancelled_by_id" => actor.id,
        "cancellation_reason" => reason,
        "updated_by_id" => actor.id
      })
    end
  end

  defp transition(actor, %CustomerOrder{} = co, attrs) do
    result =
      Repo.transaction(fn ->
        case transition_db(actor, co, attrs) do
          {:ok, updated} -> preload_co(updated)
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)

    # Broadcast outside the transaction so subscribers see the
    # committed state, not a phantom mid-transaction view.
    with {:ok, updated} <- result do
      Backend.OrderWizard.notify_co_changed(updated)
    end

    result
  end

  defp transition_db(actor, %CustomerOrder{} = co, attrs) do
    before_state = co_snapshot(co)

    co
    |> CustomerOrder.transition_status_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "customer_order",
          updated,
          before_state,
          co_snapshot(updated)
        )

        {:ok, updated}

      other ->
        other
    end
  end

  # ----- gates ----------------------------------------------------

  defp ensure_lines_present(%CustomerOrder{lines: lines})
       when is_list(lines) and lines != [],
       do: :ok

  defp ensure_lines_present(_), do: {:error, :no_lines}

  defp ensure_default_warehouse(%CustomerOrder{default_warehouse_id: id})
       when not is_nil(id),
       do: :ok

  defp ensure_default_warehouse(_), do: {:error, :default_warehouse_required}

  defp ensure_customer_approved(%CustomerOrder{customer: customer}) when not is_nil(customer) do
    if Customers.approval_active?(customer),
      do: :ok,
      else: {:error, :customer_not_approved}
  end

  defp ensure_customer_approved(_), do: {:error, :customer_not_approved}

  defp ensure_items_sellable(%CustomerOrder{customer_id: customer_id, lines: lines}) do
    line_item_ids = Enum.map(lines, & &1.item_id) |> Enum.uniq()
    not_sellable = Customers.items_not_sellable(customer_id, line_item_ids)

    case not_sellable do
      [] -> :ok
      ids -> {:error, {:items_not_sellable, ids}}
    end
  end

  defp ensure_credit_limit_ok(%CustomerOrder{} = co) do
    limit = co.customer.trade_credit_limit
    incoming = co.grand_total || Decimal.new(0)

    cond do
      is_nil(limit) ->
        # No limit set ⇒ no gate.
        :ok

      true ->
        # Outstanding A/R lives in CustomerInvoices now — it's the
        # invoices-first definition (unpaid invoice totals + not-yet-
        # invoiced portion of confirmed COs). Falls back to the old
        # "sum of confirmed CO totals" behaviour when no invoices
        # exist for the customer because the unbilled portion equals
        # the full CO total.
        outstanding =
          Backend.CustomerInvoices.outstanding_ar_for(co.customer_id,
            exclude_co_id: co.id
          )

        total = Decimal.add(outstanding, incoming)

        if Decimal.compare(total, limit) == :gt do
          {:error, {:credit_limit_breached, %{outstanding: outstanding, total: total, limit: limit}}}
        else
          :ok
        end
    end
  end

  @doc """
  Outstanding A/R for a customer — delegates to the invoices module
  so the credit-limit math has a single source of truth.
  """
  def outstanding_ar_for(customer_id, opts \\ []) when is_integer(customer_id) do
    Backend.CustomerInvoices.outstanding_ar_for(customer_id, opts)
  end

  # ----- file uploads ---------------------------------------------

  def record_file(%User{} = actor, %CustomerOrder{} = co, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("company_id", co.company_id)
      |> Map.put("customer_order_id", co.id)
      |> Map.put("uploaded_by_id", actor.id)

    %CustomerOrderFile{}
    |> CustomerOrderFile.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, file} ->
        Audit.record_created(actor, "customer_order_file", file, %{
          customer_order_id: file.customer_order_id,
          kind: file.kind,
          filename: file.filename
        })

        {:ok, Repo.preload(file, :uploaded_by)}

      other ->
        other
    end
  end

  def get_file(co_id, uuid) when is_integer(co_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(f in CustomerOrderFile,
            where: f.customer_order_id == ^co_id and f.uuid == ^cast,
            preload: [:uploaded_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_file(_, _), do: nil

  def remove_file(%User{} = actor, %CustomerOrderFile{} = file) do
    case Repo.delete(file) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "customer_order_file", file, %{
          customer_order_id: file.customer_order_id,
          kind: file.kind,
          filename: file.filename
        })

        {:ok, deleted}

      other ->
        other
    end
  end

  # ----- pricelist lookup proxy -----------------------------------

  @doc """
  Resolve the unit price for a (customer, item, qty) — thin proxy
  over `Pricelists.price_for/3` so the CO controller doesn't need to
  import the Pricelists context directly. Returns the same shape:

      %{
        unit_price, currency_code, min_quantity,
        pricelist_id, pricelist_uuid, pricelist_name, source
      }
      | nil
  """
  def suggest_line_price(customer_id, item_id, qty)
      when is_integer(customer_id) and is_integer(item_id) do
    case Repo.get(Backend.Customers.Customer, customer_id) do
      nil -> nil
      customer -> Pricelists.price_for(customer, item_id, qty)
    end
  end

  # ----- internals ------------------------------------------------

  defp preload_co(%CustomerOrder{} = co) do
    Repo.preload(co, [
      :customer,
      :created_by,
      :updated_by,
      :submitted_by,
      :confirmed_by,
      :cancelled_by,
      :default_warehouse,
      [files: [:uploaded_by]],
      [approvals: [:signed_by]],
      [lines: [item: :stock_uom, pricelist: [], warehouse: []]]
    ])
  end

  defp co_snapshot(%CustomerOrder{} = co),
    do: Map.new(@co_audit_fields, fn k -> {k, Map.get(co, k)} end)

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
