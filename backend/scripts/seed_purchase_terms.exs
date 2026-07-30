# Seed a "Default supplier" vendor and populate purchase terms for a
# handful of common raw-material items so the vita-cff formulation
# cost calculator has real numbers to display in dev.
#
# Idempotent: skips items that already carry a term, skips vendor
# creation if the vendor already exists, and skips ApprovedItem rows
# that already exist. Safe to re-run.
#
# Run with:  mix run scripts/seed_purchase_terms.exs

import Ecto.Query

alias Backend.Companies.Company
alias Backend.Items.Item
alias Backend.Purchasing.PurchaseTerms
alias Backend.Repo
alias Backend.Vendors.ApprovedItem
alias Backend.Vendors.Vendor

# --- Item catalogue we care about seeding pricing for ---------------
# name-fragment (case-insensitive substring) => {price_gbp, uom_symbol}
# Kept intentionally rough — the point is that the FE shows a number,
# not that dev data reflects real market prices.
seed_prices = %{
  "erythritol"         => {2.80, "kg"},
  "pectin"             => {24.00, "kg"},
  "sucralose"          => {45.00, "kg"},
  "citric acid"        => {3.20, "kg"},
  "malic acid"         => {4.50, "kg"},
  "deionised water"    => {0.50, "kg"},
  "vanilla flavouring" => {32.00, "kg"},
  "lemon flavouring"   => {28.00, "kg"},
  "apple flavouring"   => {26.00, "kg"},
  "watermelon"         => {30.00, "kg"},
  "acai berry"         => {80.00, "kg"},
  "capsule shell"      => {0.04, "unit"},
  "hdpe lid"           => {0.15, "unit"},
  "bottle"             => {0.85, "unit"},
  "label"              => {0.08, "unit"}
}

vendor_name = "Default Supplier"

companies = Repo.all(from c in Company, order_by: c.id)

if companies == [] do
  IO.puts(:stderr, "No companies found — nothing to seed.")
  System.halt(0)
end

Enum.each(companies, fn %Company{id: company_id, name: company_name} ->
  IO.puts("\n▸ #{company_name} (id=#{company_id})")

  # --- 1. Ensure the vendor exists ---------------------------------
  vendor =
    Repo.one(
      from v in Vendor,
        where: v.company_id == ^company_id and v.name == ^vendor_name,
        limit: 1
    ) ||
      Repo.insert!(%Vendor{
        company_id: company_id,
        name: vendor_name,
        legal_name: vendor_name,
        currency_code: "GBP",
        approval_status: "approved",
        default_lead_time_days: 21
      })

  IO.puts("  ✓ vendor: #{vendor.name} (id=#{vendor.id})")

  # --- 2. Match seed_prices to real items on this tenant -----------
  # Use LIKE with case-insensitive collation via `ilike` (PG only —
  # fine for dev). One query per fragment is cheap at seed scale.
  Enum.each(seed_prices, fn {fragment, {price, uom_symbol}} ->
    pattern = "%#{fragment}%"

    items =
      Repo.all(
        from i in Item,
          where:
            i.company_id == ^company_id and
              i.is_active == true and
              ilike(i.name, ^pattern)
      )

    if items == [] do
      IO.puts("  · no items match #{inspect(fragment)}")
    end

    Enum.each(items, fn item ->
      # Ensure the vendor is approved for the item — required by
      # PurchaseTerms.upsert unless we pass skip_approval_check.
      # Seed script does both for defence in depth: idempotently
      # create the approved row AND bypass the check.
      Repo.get_by(ApprovedItem,
        company_id: company_id,
        vendor_id: vendor.id,
        item_id: item.id
      ) ||
        Repo.insert!(%ApprovedItem{
          company_id: company_id,
          vendor_id: vendor.id,
          item_id: item.id
        })

      attrs = %{
        "company_id" => company_id,
        "vendor_id" => vendor.id,
        "item_id" => item.id,
        "price" => Decimal.from_float(price),
        "currency_code" => "GBP",
        "min_quantity" => Decimal.new(1),
        "min_quantity_uom" => uom_symbol,
        "priority" => 1,
        "lead_time_days" => 21
      }

      case PurchaseTerms.upsert(attrs, skip_approval_check: true) do
        {:ok, _term} ->
          IO.puts("  ✓ #{item.name}: £#{price}/#{uom_symbol}")

        {:error, reason} ->
          IO.puts(:stderr, "  ✗ #{item.name}: #{inspect(reason)}")
      end
    end)
  end)
end)

IO.puts("\nDone.")
