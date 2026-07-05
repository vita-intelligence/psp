defmodule Backend.CustomerReturns do
  @moduledoc """
  Boundary for customer returns (RMAs) + their lines + file evidence.

  State machine:

      draft → received → accepted   (terminal — credit note auto-issued)
                      ↘ rejected   (terminal)
                      ↘ cancelled  (terminal)

  Accepting an RMA fans out to `Backend.CustomerInvoices.create_credit_note_from_rma/2`
  which creates a `customer_invoices` row with `kind = "credit_note"`,
  negative line amounts, linked back to the source invoice and this
  RMA. Outstanding A/R then drops by the credit-note total — the
  CO credit-limit gate sees it naturally because A/R is computed off
  invoices.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.ListQueries
  alias Backend.Repo
  alias Backend.CustomerInvoices
  alias Backend.CustomerInvoices.CustomerInvoiceLine

  alias Backend.CustomerReturns.{
    CustomerReturn,
    CustomerReturnFile,
    CustomerReturnLine
  }

  @rma_audit_fields ~w(status customer_id customer_invoice_id return_date
                       reason_summary notes received_at resolved_at
                       cancelled_at cancellation_reason rejection_reason)a
  @rma_sortable ~w(id status customer_id customer_invoice_id
                   return_date received_at resolved_at cancelled_at
                   inserted_at updated_at)a
  @rma_search ~w(reason_summary notes)a
  @rma_default_sort {:return_date, :desc}

  # ----- list / get -----------------------------------------------

  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = normalise_sort(Keyword.get(opts, :sort, @rma_default_sort))

    base =
      CustomerReturn
      |> where([r], r.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @rma_search)
      |> maybe_status_filter(opts[:status])
      |> maybe_customer_filter(opts[:customer_id])
      |> ListQueries.apply_column_filters(opts[:column_filter], @rma_sortable)
      |> ListQueries.apply_sort(sort, @rma_sortable, @rma_default_sort)
      |> preload([
        :customer,
        :customer_invoice,
        :created_by,
        :updated_by,
        :received_by,
        :resolved_by,
        :cancelled_by
      ])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  defp maybe_status_filter(query, nil), do: query
  defp maybe_status_filter(query, ""), do: query
  defp maybe_status_filter(query, s) when is_binary(s),
    do: where(query, [r], r.status == ^s)

  defp maybe_customer_filter(query, nil), do: query
  defp maybe_customer_filter(query, ""), do: query

  defp maybe_customer_filter(query, id) when is_integer(id),
    do: where(query, [r], r.customer_id == ^id)

  defp maybe_customer_filter(query, id) when is_binary(id) do
    case Integer.parse(id) do
      {n, ""} -> where(query, [r], r.customer_id == ^n)
      _ -> query
    end
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        CustomerReturn
        |> where([r], r.company_id == ^company_id and r.uuid == ^cast)
        |> Repo.one()
        |> case do
          nil -> nil
          ret -> preload_rma(ret)
        end

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  @doc """
  Look up the credit note generated from this RMA (if any). The link
  lives on `customer_invoices.linked_rma_id`.
  """
  def credit_note_for(%CustomerReturn{} = ret) do
    Repo.one(
      from(i in Backend.CustomerInvoices.CustomerInvoice,
        where: i.linked_rma_id == ^ret.id and i.kind == "credit_note",
        limit: 1
      )
    )
  end

  # ----- create / update / delete ---------------------------------

  def create(%User{} = actor, company_id, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> default_return_date()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %CustomerReturn{}
    |> CustomerReturn.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, ret} ->
        Audit.record_created(actor, "customer_return", ret, rma_snapshot(ret))
        {:ok, preload_rma(ret)}

      other ->
        other
    end
  end

  defp default_return_date(attrs) do
    case attrs["return_date"] do
      nil -> Map.put(attrs, "return_date", Date.utc_today())
      _ -> attrs
    end
  end

  def update_header(%User{} = actor, %CustomerReturn{status: "draft"} = ret, attrs) do
    before_state = rma_snapshot(ret)
    str = attrs |> stringify_keys() |> Map.put("updated_by_id", actor.id)

    ret
    |> CustomerReturn.changeset(str)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "customer_return",
          updated,
          before_state,
          rma_snapshot(updated)
        )

        {:ok, preload_rma(updated)}

      other ->
        other
    end
  end

  def update_header(_actor, %CustomerReturn{}, _), do: {:error, :bad_status}

  def delete(%User{} = actor, %CustomerReturn{status: "draft"} = ret) do
    before_state = rma_snapshot(ret)

    case Repo.delete(ret) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "customer_return", ret, before_state)
        {:ok, deleted}

      other ->
        other
    end
  end

  def delete(_actor, %CustomerReturn{}), do: {:error, :bad_status}

  # ----- lines ----------------------------------------------------

  @doc """
  Add a line to a draft RMA. If the line references a
  `customer_invoice_line_id` we snapshot `unit_price` from that
  source so the eventual credit note quotes the same rate even if
  the source invoice is later edited.
  """
  def add_line(%User{} = actor, %CustomerReturn{status: "draft"} = ret, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "customer_return_id" => ret.id,
        "company_id" => ret.company_id
      })
      |> snapshot_unit_price_from_invoice_line()
      |> stamp_line_credit()

    %CustomerReturnLine{}
    |> CustomerReturnLine.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, line} ->
        Audit.record_created(actor, "customer_return_line", line, %{
          customer_return_id: line.customer_return_id,
          item_id: line.item_id,
          qty_returned: line.qty_returned,
          reason_code: line.reason_code
        })

        {:ok, Repo.preload(line, [item: :stock_uom, customer_invoice_line: []])}

      other ->
        other
    end
  end

  def add_line(_, %CustomerReturn{}, _), do: {:error, :bad_status}

  def update_line(%User{} = actor, %CustomerReturnLine{} = line, attrs) do
    ret = Repo.get!(CustomerReturn, line.customer_return_id)

    # Lines lock once `accepted/rejected/cancelled` — terminal. The
    # `qty_accepted` + `inspection_notes` columns DO move during the
    # received → accepted transition via `accept/3` though, so this
    # gate only kicks the user out of arbitrary edits, not the
    # inspection flow.
    if ret.status in ["accepted", "rejected", "cancelled"] do
      {:error, :bad_status}
    else
      before = %{
        qty_returned: line.qty_returned,
        qty_accepted: line.qty_accepted,
        reason_code: line.reason_code,
        unit_price: line.unit_price
      }

      attrs = attrs |> stringify_keys() |> stamp_line_credit()

      line
      |> CustomerReturnLine.changeset(attrs)
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          Audit.record_updated(
            actor,
            "customer_return_line",
            updated,
            before,
            %{
              qty_returned: updated.qty_returned,
              qty_accepted: updated.qty_accepted,
              reason_code: updated.reason_code,
              unit_price: updated.unit_price
            }
          )

          {:ok, Repo.preload(updated, [item: :stock_uom, customer_invoice_line: []])}

        other ->
          other
      end
    end
  end

  def delete_line(%User{} = actor, %CustomerReturnLine{} = line) do
    ret = Repo.get!(CustomerReturn, line.customer_return_id)

    if ret.status != "draft" do
      {:error, :bad_status}
    else
      case Repo.delete(line) do
        {:ok, deleted} ->
          Audit.record_deleted(actor, "customer_return_line", line, %{
            customer_return_id: line.customer_return_id,
            item_id: line.item_id
          })

          {:ok, deleted}

        other ->
          other
      end
    end
  end

  def get_line(rma_id, uuid) when is_integer(rma_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(l in CustomerReturnLine,
            where: l.customer_return_id == ^rma_id and l.uuid == ^cast,
            preload: [item: :stock_uom, customer_invoice_line: []]
          )
        )

      :error ->
        nil
    end
  end

  def get_line(_, _), do: nil

  # If the line references an invoice line and unit_price isn't
  # already in attrs, pull it from the linked line so the credit
  # note prices match what we billed.
  defp snapshot_unit_price_from_invoice_line(attrs) do
    cond do
      Map.has_key?(attrs, "unit_price") and attrs["unit_price"] not in [nil, ""] ->
        attrs

      true ->
        case attrs["customer_invoice_line_id"] do
          nil ->
            attrs

          id ->
            case Repo.get(CustomerInvoiceLine, id) do
              %CustomerInvoiceLine{unit_price: price} when not is_nil(price) ->
                Map.put(attrs, "unit_price", price)

              _ ->
                attrs
            end
        end
    end
  end

  # line_credit_amount = max(qty_accepted, 0) × unit_price.
  # During draft/received we may not have qty_accepted yet — fall
  # back to qty_returned × unit_price as a preview so the form can
  # show "if we accept all, we'll issue £X".
  defp stamp_line_credit(attrs) do
    accepted = to_dec(attrs["qty_accepted"])
    returned = to_dec(attrs["qty_returned"])
    price = to_dec(attrs["unit_price"] || 0)

    qty =
      cond do
        Decimal.compare(accepted, Decimal.new(0)) == :gt -> accepted
        Decimal.compare(returned, Decimal.new(0)) == :gt -> returned
        true -> Decimal.new(0)
      end

    credit = qty |> Decimal.mult(price) |> Decimal.round(2)
    Map.put(attrs, "line_credit_amount", credit)
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

  # ----- state machine --------------------------------------------

  def mark_received(%User{} = actor, %CustomerReturn{} = ret) do
    if ret.status != "draft" do
      {:error, :bad_status}
    else
      ret = preload_rma(ret)

      with :ok <- ensure_lines_present(ret) do
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        transition(actor, ret, %{
          "status" => "received",
          "received_at" => now,
          "received_by_id" => actor.id,
          "updated_by_id" => actor.id
        })
      end
    end
  end

  @doc """
  Accept the RMA. The caller may pass `line_decisions` — a map of
  `line_uuid => qty_accepted` — to update each line's accepted qty
  before issuing the credit note. Lines with no decision keep their
  existing `qty_accepted` (default 0).

  When `issue_credit_note` is true (default), the context creates a
  `customer_invoices` row with `kind = "credit_note"` linked back to
  this RMA. Otherwise the RMA closes without a financial effect
  (operator handles refund / replacement outside the system).
  """
  def accept(%User{} = actor, %CustomerReturn{} = ret, opts \\ %{}) do
    if ret.status != "received" do
      {:error, :bad_status}
    else
      ret = preload_rma(ret)
      decisions = Map.get(opts, "line_decisions", %{}) |> stringify_keys()
      issue_cn = Map.get(opts, "issue_credit_note", true)

      Repo.transaction(fn ->
        with :ok <- update_line_acceptances(actor, ret, decisions),
             ret_updated <- preload_rma(ret),
             :ok <- ensure_any_acceptance(ret_updated),
             {:ok, after_state} <- do_accept_transition(actor, ret_updated),
             {:ok, credit_note} <-
               maybe_issue_credit_note(actor, after_state, issue_cn) do
          %{rma: after_state, credit_note: credit_note}
        else
          {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  defp update_line_acceptances(actor, %CustomerReturn{} = ret, decisions)
       when is_map(decisions) do
    Enum.reduce_while(ret.lines, :ok, fn line, _acc ->
      case Map.get(decisions, line.uuid) do
        nil ->
          {:cont, :ok}

        raw_qty ->
          attrs =
            %{
              "qty_accepted" => raw_qty,
              "qty_returned" => line.qty_returned,
              "unit_price" => line.unit_price
            }
            |> stamp_line_credit()

          line
          |> CustomerReturnLine.changeset(attrs)
          |> Repo.update()
          |> case do
            {:ok, updated} ->
              Audit.record_updated(
                actor,
                "customer_return_line",
                updated,
                %{qty_accepted: line.qty_accepted},
                %{qty_accepted: updated.qty_accepted}
              )

              {:cont, :ok}

            {:error, cs} ->
              {:halt, {:error, cs}}
          end
      end
    end)
  end

  defp ensure_any_acceptance(%CustomerReturn{lines: lines}) do
    total =
      Enum.reduce(lines, Decimal.new(0), fn l, acc ->
        Decimal.add(acc, l.qty_accepted || Decimal.new(0))
      end)

    if Decimal.compare(total, Decimal.new(0)) == :gt do
      :ok
    else
      {:error, :no_accepted_qty}
    end
  end

  defp do_accept_transition(actor, %CustomerReturn{} = ret) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    before_state = rma_snapshot(ret)

    ret
    |> CustomerReturn.transition_status_changeset(%{
      "status" => "accepted",
      "resolved_at" => now,
      "resolved_by_id" => actor.id,
      "updated_by_id" => actor.id
    })
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "customer_return",
          updated,
          before_state,
          rma_snapshot(updated)
        )

        {:ok, preload_rma(updated)}

      other ->
        other
    end
  end

  defp maybe_issue_credit_note(_actor, ret, false), do: {:ok, {ret, nil}}

  defp maybe_issue_credit_note(actor, ret, _issue) do
    case CustomerInvoices.create_credit_note_from_rma(actor, ret) do
      {:ok, credit_note} -> {:ok, credit_note}
      {:error, reason} -> {:error, reason}
    end
  end

  def reject(%User{} = actor, %CustomerReturn{} = ret, reason) when is_binary(reason) do
    cond do
      ret.status in ["accepted", "rejected", "cancelled"] ->
        {:error, :bad_status}

      String.trim(reason) == "" ->
        {:error, :reason_required}

      true ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        transition(actor, ret, %{
          "status" => "rejected",
          "resolved_at" => now,
          "resolved_by_id" => actor.id,
          "rejection_reason" => reason,
          "updated_by_id" => actor.id
        })
    end
  end

  def cancel(%User{} = actor, %CustomerReturn{} = ret, reason) when is_binary(reason) do
    cond do
      ret.status in ["accepted", "rejected", "cancelled"] ->
        {:error, :bad_status}

      String.trim(reason) == "" ->
        {:error, :reason_required}

      true ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        transition(actor, ret, %{
          "status" => "cancelled",
          "cancelled_at" => now,
          "cancelled_by_id" => actor.id,
          "cancellation_reason" => reason,
          "updated_by_id" => actor.id
        })
    end
  end

  defp transition(actor, %CustomerReturn{} = ret, attrs) do
    before_state = rma_snapshot(ret)

    ret
    |> CustomerReturn.transition_status_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "customer_return",
          updated,
          before_state,
          rma_snapshot(updated)
        )

        {:ok, preload_rma(updated)}

      other ->
        other
    end
  end

  defp ensure_lines_present(%CustomerReturn{lines: lines})
       when is_list(lines) and lines != [],
       do: :ok

  defp ensure_lines_present(_), do: {:error, :no_lines}

  # ----- file uploads ---------------------------------------------

  def record_file(%User{} = actor, %CustomerReturn{} = ret, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("company_id", ret.company_id)
      |> Map.put("customer_return_id", ret.id)
      |> Map.put("uploaded_by_id", actor.id)

    %CustomerReturnFile{}
    |> CustomerReturnFile.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, file} ->
        Audit.record_created(actor, "customer_return_file", file, %{
          customer_return_id: file.customer_return_id,
          kind: file.kind,
          filename: file.filename
        })

        {:ok, Repo.preload(file, :uploaded_by)}

      other ->
        other
    end
  end

  def get_file(rma_id, uuid) when is_integer(rma_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(f in CustomerReturnFile,
            where: f.customer_return_id == ^rma_id and f.uuid == ^cast,
            preload: [:uploaded_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_file(_, _), do: nil

  def remove_file(%User{} = actor, %CustomerReturnFile{} = file) do
    case Repo.delete(file) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "customer_return_file", file, %{
          customer_return_id: file.customer_return_id,
          kind: file.kind,
          filename: file.filename
        })

        {:ok, deleted}

      other ->
        other
    end
  end

  # ----- internals -------------------------------------------------

  defp preload_rma(%CustomerReturn{} = ret) do
    Repo.preload(ret, [
      :customer,
      :customer_invoice,
      :created_by,
      :updated_by,
      :received_by,
      :resolved_by,
      :cancelled_by,
      [files: [:uploaded_by]],
      [lines: [item: :stock_uom, customer_invoice_line: []]]
    ])
  end

  defp rma_snapshot(%CustomerReturn{} = r),
    do: Map.new(@rma_audit_fields, fn k -> {k, Map.get(r, k)} end)

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
