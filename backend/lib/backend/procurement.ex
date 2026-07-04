defmodule Backend.Procurement do
  @moduledoc """
  Procurement boundary — vendor invoices, the AP ledger, and the
  paid/disputed/overdue lifecycle.

  Why a separate context from `Backend.Purchasing`: invoices are a
  finance-team concern, not a buyer-team concern. The two boundaries
  share `PurchaseOrder` as the common parent, but everything else
  (state, RBAC, audit) is distinct.

  Invoice lifecycle:

      received  →  default on create
        ↓ approve / pay (sets paid_at + paid_by + status)
      paid
        ↓ (terminal)

      received  →  dispute  →  disputed  (with notes)
      any       →  void     →  void      (write-off)

  `overdue` is not a stored status. It's derived in the list query:
  `status == received AND due_date < today`. This way bumping the due
  date or paying the invoice auto-clears the overdue flag without a
  status-machine round trip.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.ListQueries
  alias Backend.Procurement.Invoice
  alias Backend.Purchasing.PurchaseOrder
  alias Backend.Repo
  alias Backend.Storage

  @invoice_audit_fields ~w(invoice_number invoice_date due_date currency_code
                           subtotal tax_amount total_inc_tax paid_amount status
                           notes paid_at)a
  @invoice_sortable ~w(invoice_date due_date inserted_at total_inc_tax paid_amount status)a
  @invoice_search ~w(invoice_number notes)a
  @invoice_default_sort {:invoice_date, :desc}

  # ----- list ------------------------------------------------------

  @doc """
  Paginated AP ledger. `opts` accepts:

    * `:cursor`, `:limit`, `:sort` — `ListQueries` standard
    * `:status` — `"received" | "disputed" | "paid" | "void" | "overdue"`
      where `"overdue"` is the derived bucket
    * `:vendor_id` — filters via the parent PO's vendor
    * `:purchase_order_id` — scope to one PO (used by the PO detail
      card; bypasses pagination because each PO has <10 invoices)
    * `:from_date`, `:to_date` — invoice_date range
  """
  def list_page(company_id, opts \\ []) when is_integer(company_id) do
    sort = Keyword.get(opts, :sort, @invoice_default_sort)
    today = Date.utc_today()

    base =
      Invoice
      |> where([i], i.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @invoice_search)
      |> maybe_status_filter(opts[:status], today)
      |> maybe_vendor_filter(opts[:vendor_id])
      |> maybe_po_filter(opts[:purchase_order_id])
      |> maybe_date_range(opts[:from_date], opts[:to_date])
      |> ListQueries.apply_column_filters(opts[:column_filter], @invoice_sortable)
      |> ListQueries.apply_sort(sort, @invoice_sortable, @invoice_default_sort)
      |> preload([:created_by, :updated_by, :paid_by, purchase_order: :vendor])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  @doc """
  Aggregate totals for the ledger header — one row per currency so the
  FE can render the MRPEasy-style multi-currency summary stack.
  Respects the same filters as `list_page/2` so the header tracks the
  visible rows.
  """
  def totals_by_currency(company_id, opts \\ []) when is_integer(company_id) do
    today = Date.utc_today()

    Invoice
    |> where([i], i.company_id == ^company_id)
    |> ListQueries.apply_search(opts[:search], @invoice_search)
    |> maybe_status_filter(opts[:status], today)
    |> maybe_vendor_filter(opts[:vendor_id])
    |> maybe_po_filter(opts[:purchase_order_id])
    |> maybe_date_range(opts[:from_date], opts[:to_date])
    |> ListQueries.apply_column_filters(opts[:column_filter], @invoice_sortable)
    |> group_by([i], i.currency_code)
    |> select([i], %{
      currency_code: i.currency_code,
      subtotal: sum(i.subtotal),
      tax: sum(i.tax_amount),
      total_inc_tax: sum(i.total_inc_tax),
      paid: sum(i.paid_amount)
    })
    |> Repo.all()
  end

  defp maybe_status_filter(query, nil, _today), do: query
  defp maybe_status_filter(query, "", _today), do: query

  defp maybe_status_filter(query, "overdue", today) do
    where(
      query,
      [i],
      i.status == "received" and not is_nil(i.due_date) and i.due_date < ^today
    )
  end

  defp maybe_status_filter(query, status, _today) when is_binary(status) do
    where(query, [i], i.status == ^status)
  end

  defp maybe_vendor_filter(query, nil), do: query

  defp maybe_vendor_filter(query, vendor_id) when is_integer(vendor_id) do
    from i in query,
      join: po in PurchaseOrder,
      on: po.id == i.purchase_order_id,
      where: po.vendor_id == ^vendor_id
  end

  defp maybe_po_filter(query, nil), do: query

  defp maybe_po_filter(query, po_id) when is_integer(po_id),
    do: where(query, [i], i.purchase_order_id == ^po_id)

  defp maybe_date_range(query, nil, nil), do: query

  defp maybe_date_range(query, from, nil),
    do: where(query, [i], i.invoice_date >= ^from)

  defp maybe_date_range(query, nil, to),
    do: where(query, [i], i.invoice_date <= ^to)

  defp maybe_date_range(query, from, to) do
    where(query, [i], i.invoice_date >= ^from and i.invoice_date <= ^to)
  end

  # ----- get -------------------------------------------------------

  def list_for_po(po_id) when is_integer(po_id) do
    Invoice
    |> where([i], i.purchase_order_id == ^po_id)
    |> order_by([i], desc: i.invoice_date, desc: i.id)
    |> preload([:created_by, :updated_by, :paid_by, purchase_order: :vendor])
    |> Repo.all()
  end

  def get_for_company(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Invoice
        |> where([i], i.company_id == ^company_id and i.uuid == ^cast)
        |> preload([:created_by, :updated_by, :paid_by, purchase_order: :vendor])
        |> Repo.one()

      :error ->
        nil
    end
  end

  # ----- create / update / delete ----------------------------------

  @doc """
  Insert an invoice against `po`. `attrs` carry the AP-clerk-entered
  fields (`invoice_number`, dates, money, notes). The file is uploaded
  separately via `attach_file/3`.
  """
  def create(%User{} = actor, %PurchaseOrder{} = po, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("company_id", po.company_id)
      |> Map.put("purchase_order_id", po.id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)

    %Invoice{}
    |> Invoice.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, invoice} ->
        Audit.record_created(actor, "procurement_invoice", invoice, snapshot(invoice))
        {:ok, preload(invoice)}

      {:error, cs} ->
        {:error, cs}
    end
  end

  def update_invoice(%User{} = actor, %Invoice{} = invoice, attrs) do
    before = snapshot(invoice)

    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("updated_by_id", actor.id)
      # Buyer-team can't accidentally re-parent an invoice to a
      # different PO via the update payload.
      |> Map.delete("purchase_order_id")
      |> Map.delete("company_id")

    invoice
    |> Invoice.changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(actor, "procurement_invoice", updated, before, snapshot(updated))
        {:ok, preload(updated)}

      {:error, cs} ->
        {:error, cs}
    end
  end

  def delete(%User{} = actor, %Invoice{} = invoice) do
    Repo.transaction(fn ->
      case Repo.delete(invoice) do
        {:ok, deleted} ->
          if invoice.file_blob_path, do: Storage.delete(invoice.file_blob_path)
          Audit.record_deleted(actor, "procurement_invoice", deleted, snapshot(deleted))
          deleted

        {:error, reason} ->
          Repo.rollback(reason)
      end
    end)
  end

  # ----- pay / dispute / void --------------------------------------

  def mark_paid(%User{} = actor, %Invoice{} = invoice, paid_amount \\ nil) do
    amount = paid_amount || invoice.total_inc_tax

    attrs = %{
      "status" => "paid",
      "paid_amount" => amount,
      "paid_at" => DateTime.utc_now() |> DateTime.truncate(:second),
      "paid_by_id" => actor.id
    }

    update_invoice(actor, invoice, attrs)
  end

  def mark_disputed(%User{} = actor, %Invoice{} = invoice, notes) do
    attrs = %{
      "status" => "disputed",
      "notes" => notes
    }

    update_invoice(actor, invoice, attrs)
  end

  def mark_void(%User{} = actor, %Invoice{} = invoice, notes \\ nil) do
    attrs = %{
      "status" => "void",
      "notes" => notes || invoice.notes
    }

    update_invoice(actor, invoice, attrs)
  end

  # ----- file ------------------------------------------------------

  @doc """
  Upload (or replace) the PDF attached to this invoice. Replaces both
  the storage blob and the metadata fields atomically — if the row
  update fails the new blob is dropped so we don't strand it.
  """
  def attach_file(%User{} = actor, %Invoice{} = invoice, %{
        filename: filename,
        mime: mime,
        bytes: bytes
      }) do
    old_blob = invoice.file_blob_path

    key =
      "procurement_invoices/" <>
        invoice.uuid <>
        "/" <>
        sanitised_filename(filename)

    case Storage.put(key, bytes, content_type: mime) do
      {:ok, blob_path} ->
        attrs = %{
          "file_filename" => filename,
          "file_mime" => mime,
          "file_byte_size" => byte_size(bytes),
          "file_blob_path" => blob_path,
          "updated_by_id" => actor.id
        }

        invoice
        |> Invoice.changeset(attrs)
        |> Repo.update()
        |> case do
          {:ok, updated} ->
            if old_blob && old_blob != blob_path, do: Storage.delete(old_blob)
            {:ok, preload(updated)}

          {:error, cs} ->
            _ = Storage.delete(blob_path)
            {:error, cs}
        end

      {:error, reason} ->
        {:error, {:storage_failed, reason}}
    end
  end

  def detach_file(%User{} = actor, %Invoice{} = invoice) do
    attrs = %{
      "file_filename" => nil,
      "file_mime" => nil,
      "file_byte_size" => nil,
      "file_blob_path" => nil,
      "updated_by_id" => actor.id
    }

    invoice
    |> Invoice.changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        if invoice.file_blob_path, do: Storage.delete(invoice.file_blob_path)
        {:ok, preload(updated)}

      {:error, cs} ->
        {:error, cs}
    end
  end

  # ----- helpers ---------------------------------------------------

  defp preload(%Invoice{} = invoice) do
    Repo.preload(invoice, [:created_by, :updated_by, :paid_by, purchase_order: :vendor],
      force: true
    )
  end

  defp snapshot(%Invoice{} = invoice),
    do: Map.new(@invoice_audit_fields, fn k -> {k, Map.get(invoice, k)} end)

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end

  defp sanitised_filename(name) when is_binary(name) do
    name
    |> String.replace(~r/[^A-Za-z0-9._-]/, "_")
    |> String.slice(0, 200)
  end

  defp sanitised_filename(_), do: "invoice.pdf"
end
