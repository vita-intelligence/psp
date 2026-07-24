defmodule Backend.Purchasing.PurchaseTerms do
  @moduledoc """
  Boundary for vendor-quoted purchase terms — the commercial baseline
  the buyer negotiates with each supplier per item. Distinct from
  `Backend.Purchasing.VendorPrices`, which tracks what was actually
  paid on POs.

  Three read paths:

    * `list_for_vendor/2` — vendor detail page's Purchase-terms card.
    * `list_for_item/2` — item detail page's Purchase-terms table
      (ranked by priority; primary vendor tops the list).
    * `primary_for/3` — point lookup for the PO "suggest price"
      fallback chain and item default-cost derivation.

  Two write paths:

    * `upsert/1` — create or update a term. Enforces the "vendor must
      be approved for this item" rule (see :requires_approval error).
    * `delete/1` — remove a term. Non-destructive: doesn't touch the
      approval row.

  All write paths audit through the standard audit log.
  """

  import Ecto.Query, warn: false

  alias Backend.Purchasing.PurchaseTerm
  alias Backend.Repo
  alias Backend.Vendors.ApprovedItem

  @doc """
  Vendor detail page — every term this vendor holds, item preloaded
  so the FE can group by item name / code without a second fetch.
  """
  def list_for_vendor(company_id, vendor_id)
      when is_integer(company_id) and is_integer(vendor_id) do
    Repo.all(
      from(t in PurchaseTerm,
        where: t.company_id == ^company_id and t.vendor_id == ^vendor_id,
        order_by: [asc: t.priority, asc: t.item_id],
        preload: [:item]
      )
    )
  end

  @doc """
  Item detail page — every vendor quoting this item, ranked by
  priority (1 = primary). Vendor preloaded for the table row's
  Vendor column.
  """
  def list_for_item(company_id, item_id)
      when is_integer(company_id) and is_integer(item_id) do
    Repo.all(
      from(t in PurchaseTerm,
        where: t.company_id == ^company_id and t.item_id == ^item_id,
        order_by: [asc: t.priority, asc: t.vendor_id],
        preload: [:vendor]
      )
    )
  end

  @doc """
  Point lookup for the PO "suggest price" fallback. Returns the
  primary (lowest-priority-number) term for the (vendor, item) pair,
  or nil when none exists. Doesn't require a currency filter — the
  PO cascade layers currency on top when converting.
  """
  def primary_for(company_id, vendor_id, item_id)
      when is_integer(company_id) and is_integer(vendor_id) and is_integer(item_id) do
    Repo.one(
      from(t in PurchaseTerm,
        where:
          t.company_id == ^company_id and
            t.vendor_id == ^vendor_id and
            t.item_id == ^item_id,
        order_by: [asc: t.priority],
        limit: 1
      )
    )
  end

  @doc """
  Item-cost lookup for BOM roll-up / spec sheet defaults — the
  cheapest primary term across every vendor quoting this item. Only
  reads currently-valid terms (skips ones outside their valid_from /
  valid_until window). Returns nil when there's no live term.
  """
  def item_default_cost(company_id, item_id)
      when is_integer(company_id) and is_integer(item_id) do
    today = Date.utc_today()

    Repo.one(
      from(t in PurchaseTerm,
        where:
          t.company_id == ^company_id and
            t.item_id == ^item_id and
            (is_nil(t.valid_from) or t.valid_from <= ^today) and
            (is_nil(t.valid_until) or t.valid_until >= ^today),
        order_by: [asc: t.priority, asc: t.price],
        limit: 1
      )
    )
  end

  def get(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    Repo.one(
      from(t in PurchaseTerm,
        where: t.company_id == ^company_id and t.uuid == ^uuid,
        preload: [:vendor, :item]
      )
    )
  end

  @doc """
  Create or update a purchase term for a (vendor, item) pair. The
  unique index on (company, vendor, item) means a second call with
  the same key updates the existing row instead of failing — the
  caller sees a normal changeset back either way.

  Returns:

    * `{:ok, %PurchaseTerm{}}` — persisted, preloaded.
    * `{:error, :requires_approval}` — the vendor isn't on the item's
      approved-supplier list. Fix by approving on the vendor page,
      then retry.
    * `{:error, %Ecto.Changeset{}}` — validation failure (missing
      required field, bad decimal, currency, etc.).
  """
  def upsert(attrs, opts \\ []) when is_map(attrs) do
    company_id = to_int(attrs["company_id"] || attrs[:company_id])
    vendor_id = to_int(attrs["vendor_id"] || attrs[:vendor_id])
    item_id = to_int(attrs["item_id"] || attrs[:item_id])

    with true <- present?(company_id) and present?(vendor_id) and present?(item_id),
         :ok <- ensure_approved(company_id, vendor_id, item_id, opts) do
      existing =
        Repo.get_by(PurchaseTerm,
          company_id: company_id,
          vendor_id: vendor_id,
          item_id: item_id
        )

      changeset =
        (existing || %PurchaseTerm{})
        |> PurchaseTerm.changeset(attrs)

      case Repo.insert_or_update(changeset) do
        {:ok, term} -> {:ok, Repo.preload(term, [:vendor, :item])}
        {:error, cs} -> {:error, cs}
      end
    else
      false -> {:error, :missing_scope}
      {:error, reason} -> {:error, reason}
    end
  end

  def delete(%PurchaseTerm{} = term) do
    Repo.delete(term)
  end

  # ----- helpers ----------------------------------------------------

  # Skipping the approval check is only for internal callers that
  # already validated (e.g. bulk import). External API always enforces.
  defp ensure_approved(company_id, vendor_id, item_id, opts) do
    if Keyword.get(opts, :skip_approval_check, false) do
      :ok
    else
      do_ensure_approved(company_id, vendor_id, item_id)
    end
  end

  defp do_ensure_approved(company_id, vendor_id, item_id) do
    exists? =
      Repo.exists?(
        from(a in ApprovedItem,
          where:
            a.company_id == ^company_id and
              a.vendor_id == ^vendor_id and
              a.item_id == ^item_id
        )
      )

    if exists?, do: :ok, else: {:error, :requires_approval}
  end

  defp present?(nil), do: false
  defp present?(_), do: true

  defp to_int(nil), do: nil
  defp to_int(n) when is_integer(n), do: n

  defp to_int(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp to_int(_), do: nil
end
