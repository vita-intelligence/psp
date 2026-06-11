defmodule Backend.Purchasing.VendorPrices do
  @moduledoc """
  Vendor / item last-paid-price cache.

  Compliance rule the cache enforces: "if it can be computed, don't
  ask". A worker creating a PO line for an item we've already bought
  from this vendor shouldn't be typing the unit price from scratch —
  pre-fill from history, warn when the new number drifts ±20%, and
  let them override with eyes open.

  Three entry points:

    * `upsert_from_receipt/2` — called from the PO receive flow when
      a line gets a receipt. Sets / overwrites the (vendor, item,
      currency) row, accumulates rolling qty.
    * `last_paid_for/3` — point lookup used by the new-PO-line
      "suggest price" endpoint.
    * `deviation_check/4` — runs the ±20% check the FE renders as a
      soft warning when the worker submits a price that disagrees
      with history.

  Not auditable — the cache is a projection of received PO lines,
  which carry their own audit rows. Logging every cache upsert would
  flood the audit feed with mechanical noise.
  """

  import Ecto.Query, warn: false

  alias Backend.Purchasing.{PurchaseOrder, PurchaseOrderLine, VendorItemPrice}
  alias Backend.Repo

  # 20% — symmetric. Worker types a number ≥1.2× or ≤0.833× the cached
  # value and the FE renders the yellow "confirm or revise" banner.
  @deviation_threshold Decimal.new("0.20")

  @doc """
  Apply a received PO line to the cache. Idempotent on identical
  input — re-receiving the same line just overwrites with the same
  value + bumps the rolling qty.

  Skips silently when the line is missing the data we'd need to make
  a meaningful row (no item, no qty, zero price). The caller doesn't
  care about the result — this is a side-effect on the receive path.
  """
  def upsert_from_receipt(%PurchaseOrder{} = po, %PurchaseOrderLine{} = line) do
    with true <- recordable?(line),
         {:ok, currency} <- normalise_currency(po.currency_code),
         now <- DateTime.utc_now() |> DateTime.truncate(:second) do
      qty_increment = line.qty_received || Decimal.new(0)

      Repo.transaction(fn ->
        case Repo.get_by(VendorItemPrice,
               company_id: po.company_id,
               vendor_id: po.vendor_id,
               item_id: line.item_id,
               currency_code: currency
             ) do
          nil ->
            attrs = %{
              "company_id" => po.company_id,
              "vendor_id" => po.vendor_id,
              "item_id" => line.item_id,
              "currency_code" => currency,
              "unit_price" => line.unit_price,
              "qty_purchased" => qty_increment,
              "last_paid_at" => now,
              "last_po_line_id" => line.id
            }

            %VendorItemPrice{}
            |> VendorItemPrice.changeset(attrs)
            |> Repo.insert()

          %VendorItemPrice{} = existing ->
            attrs = %{
              "unit_price" => line.unit_price,
              "qty_purchased" => Decimal.add(existing.qty_purchased || Decimal.new(0), qty_increment),
              "last_paid_at" => now,
              "last_po_line_id" => line.id
            }

            existing
            |> VendorItemPrice.changeset(attrs)
            |> Repo.update()
        end
        |> case do
          {:ok, row} -> row
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    else
      _ -> {:ok, :skipped}
    end
  end

  @doc """
  Point lookup for the "suggest price" endpoint. Returns the cached
  row's shape the FE needs to pre-fill + render the "last paid X on
  date" caption, or nil when no history exists.
  """
  def last_paid_for(company_id, vendor_id, item_id, currency_code)
      when is_integer(company_id) and is_integer(vendor_id) and is_integer(item_id) do
    with {:ok, currency} <- normalise_currency(currency_code) do
      case Repo.get_by(VendorItemPrice,
             company_id: company_id,
             vendor_id: vendor_id,
             item_id: item_id,
             currency_code: currency
           ) do
        nil ->
          nil

        %VendorItemPrice{} = row ->
          %{
            unit_price: row.unit_price,
            currency_code: row.currency_code,
            last_paid_at: row.last_paid_at,
            last_po_line_id: row.last_po_line_id,
            qty_purchased: row.qty_purchased
          }
      end
    else
      _ -> nil
    end
  end

  @doc """
  Verdict for the soft "this is X% higher than last paid" banner.

  Returns:

    * `:no_history`   — no cached row, nothing to compare against
    * `:within_range` — |Δ| ≤ 20%
    * `{:warning, %{last, proposed, pct_change}}` — outside ±20%

  `pct_change` is a `Decimal` (positive = paying more, negative =
  paying less) so the FE can render the sign explicitly.
  """
  def deviation_check(company_id, vendor_id, item_id, currency_code, proposed_unit_price)
      when is_integer(company_id) and is_integer(vendor_id) and is_integer(item_id) do
    with %{} = last <- last_paid_for(company_id, vendor_id, item_id, currency_code),
         {:ok, proposed} <- coerce_decimal(proposed_unit_price),
         true <- positive?(last.unit_price) do
      delta = Decimal.sub(proposed, last.unit_price)
      pct = Decimal.div(delta, last.unit_price)

      if Decimal.compare(Decimal.abs(pct), @deviation_threshold) == :gt do
        {:warning,
         %{
           last: last.unit_price,
           proposed: proposed,
           pct_change: pct,
           last_paid_at: last.last_paid_at,
           currency_code: last.currency_code
         }}
      else
        :within_range
      end
    else
      nil -> :no_history
      _ -> :within_range
    end
  end

  @doc """
  Vendor-detail "Price history" card data. One row per cached
  (item, currency) pair for the given vendor, ordered by most-recent
  paid date. Item preloaded so the FE can show name + code without
  a second round-trip.
  """
  def list_for_vendor(company_id, vendor_id)
      when is_integer(company_id) and is_integer(vendor_id) do
    Repo.all(
      from(p in VendorItemPrice,
        where: p.company_id == ^company_id and p.vendor_id == ^vendor_id,
        order_by: [desc: p.last_paid_at],
        preload: [:item, last_po_line: :purchase_order]
      )
    )
  end

  # ----- helpers ----------------------------------------------------

  defp recordable?(%PurchaseOrderLine{item_id: nil}), do: false
  defp recordable?(%PurchaseOrderLine{unit_price: nil}), do: false

  defp recordable?(%PurchaseOrderLine{unit_price: price}) do
    case coerce_decimal(price) do
      {:ok, d} -> Decimal.compare(d, Decimal.new(0)) == :gt
      _ -> false
    end
  end

  defp normalise_currency(nil), do: :error
  defp normalise_currency(""), do: :error

  defp normalise_currency(code) when is_binary(code) do
    case String.trim(code) |> String.upcase() do
      <<a::binary-size(3)>> -> {:ok, a}
      _ -> :error
    end
  end

  defp coerce_decimal(%Decimal{} = d), do: {:ok, d}
  defp coerce_decimal(n) when is_integer(n) or is_float(n), do: {:ok, Decimal.new(to_string(n))}

  defp coerce_decimal(s) when is_binary(s) do
    case Decimal.parse(String.trim(s)) do
      {%Decimal{} = d, ""} -> {:ok, d}
      _ -> :error
    end
  end

  defp coerce_decimal(_), do: :error

  defp positive?(%Decimal{} = d), do: Decimal.compare(d, Decimal.new(0)) == :gt
  defp positive?(_), do: false
end
