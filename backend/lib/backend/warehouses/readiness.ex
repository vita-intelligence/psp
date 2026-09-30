defmodule Backend.Warehouses.Readiness do
  @moduledoc """
  Facility goods-in / production-in readiness check.

  What "ready" means depends on the `warehouses.kind` — a warehouse
  and a production facility run different workflows:

  ## Warehouse (`kind = "warehouse"`)

  A BRCGS / FSSC food-safety warehouse can't run goods-in without
  physical segregation areas for:

    * **quarantine** — every incoming lot lands here pending QC
      verdict (BRCGS Issue 9 § 5.3, FSSC 22000 § 8.9.4 control of
      nonconforming product)
    * **hold** — lots awaiting investigation that aren't quarantine
      and aren't yet rejected (allergen review, supplier query, …)
    * **rejected** — lots failed by QC, awaiting disposal or return
    * **finished_quarantine** — MO output lots waiting on Final
      Product Release (BRCGS Issue 9 § 5.6 Positive Release, FSSC
      § 8.6). Physically separated from raw-material `quarantine`
      so incoming and outgoing "unproven" stock never share a bay.

  Without at least one cell of each purpose the auto-router on the
  goods-in verdict can't park lots, and the receive flow silently
  routes everything into `regular` cells — exactly the off-the-
  regulatory-road scenario the cell-purpose machinery was built
  to prevent.

  ## Production facility (`kind = "production_facility"`)

  Production sites don't receive vendor stock directly — raw
  material transfers in from a warehouse, so `quarantine` / `hold` /
  `rejected` aren't the operator's concern here. What production
  can't operate without:

    * **production_feed** — where warehouse pickers land a released
      MO's raw-material transfer so floor operators can pick it up
      when the run starts (see `StorageCell` module doc)
    * **finished_quarantine** — MO output lots pending Final Product
      Release (same BRCGS § 5.6 rationale as warehouse)
    * **rnd** — R&D trial-batch stream; kept physically separate
      from production stock so trial ingredient consumption + trial
      output never contaminates commercial lots

  `regular` is intentionally NOT required for production — every
  cell defaults to `regular`, so the check would be trivially
  satisfied by any cell at all and add no signal.

  ## Purity

  This module is pure — no DB writes, no transitions. The
  `Backend.Purchasing.receive_against_po/3` gate calls it on every
  receive attempt; the warehouse show payload calls it to surface
  the live coverage on the plan page.

  Dispatch is intentionally NOT required for either kind — it only
  matters for outbound shipments. Add when we ship a warehouse-
  dispatch flow.
  """

  import Ecto.Query, warn: false
  alias Backend.Repo
  alias Backend.Warehouses.StorageCell
  alias Backend.Warehouses.StorageLocation

  # Goods-in receive gate — see moduledoc for the regulatory backing.
  @warehouse_required_purposes ~w(quarantine hold rejected finished_quarantine)

  # Production-in — see moduledoc; production_feed is the raw-material
  # staging cell without which an MO can't physically start.
  @production_required_purposes ~w(production_feed finished_quarantine rnd)

  @type blocker :: %{
          purpose: String.t(),
          label: String.t(),
          reason: String.t()
        }

  @type counts :: %{required(String.t()) => non_neg_integer()}

  @type readiness :: %{
          counts: counts(),
          blockers: [blocker()],
          ready?: boolean()
        }

  @type kind :: String.t()

  @doc """
  Run the readiness check for a single facility. Returns the cell
  count per purpose plus the missing-purpose blocker list. Both go on
  the show payload so the FE can render the coverage chip strip
  + the regulatory-why for each missing one.

  `warehouse_id = nil` → trivially not ready (use this to fail-safe
  when the caller hasn't supplied an id yet).

  `kind` defaults to `"warehouse"` to keep old callers working. Pass
  `"production_facility"` for a production site — a different
  required-purposes list applies.
  """
  @spec check(integer() | nil, kind()) :: readiness()
  def check(warehouse_or_nil, kind \\ "warehouse")

  def check(nil, kind) do
    %{counts: zero_counts(), blockers: missing_all(kind), ready?: false}
  end

  def check(warehouse_id, kind) when is_integer(warehouse_id) do
    counts = counts_for(warehouse_id)
    required = required_for(kind)
    blockers = blockers_for(counts, required)

    %{
      counts: counts,
      blockers: blockers,
      ready?: blockers == []
    }
  end

  @doc "Required-purpose list per kind — exposed for the FE legend + the docs."
  def required_purposes(kind \\ "warehouse")
  def required_purposes("production_facility"), do: @production_required_purposes
  def required_purposes(_), do: @warehouse_required_purposes

  # ----- internals ------------------------------------------------

  defp required_for("production_facility"), do: @production_required_purposes
  defp required_for(_), do: @warehouse_required_purposes

  defp counts_for(warehouse_id) do
    rows =
      from(c in StorageCell,
        join: l in StorageLocation,
        on: l.id == c.storage_location_id,
        where: l.warehouse_id == ^warehouse_id,
        group_by: c.purpose,
        select: {c.purpose, count(c.id)}
      )
      |> Repo.all()

    Map.merge(zero_counts(), Map.new(rows))
  end

  defp blockers_for(counts, required) do
    required
    |> Enum.filter(fn purpose -> Map.get(counts, purpose, 0) == 0 end)
    |> Enum.map(fn purpose ->
      %{
        purpose: purpose,
        label: label_for(purpose),
        reason: reason_for(purpose)
      }
    end)
  end

  defp zero_counts do
    # Cover every documented purpose so the FE can render every chip
    # even if its row count is zero (vs absent). `production_feed` +
    # `rnd` were added when the production-facility split landed.
    %{
      "regular" => 0,
      "quarantine" => 0,
      "hold" => 0,
      "rejected" => 0,
      "dispatch" => 0,
      "production_feed" => 0,
      "finished_quarantine" => 0,
      "three_pl_storage" => 0,
      "rnd" => 0
    }
  end

  defp missing_all(kind) do
    Enum.map(required_for(kind), fn purpose ->
      %{
        purpose: purpose,
        label: label_for(purpose),
        reason: reason_for(purpose)
      }
    end)
  end

  defp label_for("quarantine"), do: "Quarantine"
  defp label_for("hold"), do: "QA hold"
  defp label_for("rejected"), do: "Rejected"
  defp label_for("finished_quarantine"), do: "Finished quarantine"
  defp label_for("production_feed"), do: "Production feed"
  defp label_for("rnd"), do: "R&D"
  defp label_for(other), do: String.capitalize(other)

  defp reason_for("quarantine") do
    "At least one cell marked Quarantine is required. Every incoming lot lands here pending the goods-in QC verdict (BRCGS § 5.3)."
  end

  defp reason_for("hold") do
    "At least one cell marked QA hold is required. Used for lots awaiting investigation (allergen review, supplier query) that aren't rejected yet (FSSC § 8.9.4)."
  end

  defp reason_for("rejected") do
    "At least one cell marked Rejected is required so QC-failed lots can be segregated from usable stock until they're returned or disposed of (FSSC § 8.9.4)."
  end

  defp reason_for("finished_quarantine") do
    "At least one cell marked Finished quarantine is required. Every MO output lot lands here after closeout pending QA Final Product Release (BRCGS Issue 9 § 5.6 Positive Release, FSSC § 8.6). Kept physically separate from raw-material quarantine so incoming and outgoing 'unproven' stock never share a bay."
  end

  defp reason_for("production_feed") do
    "At least one cell marked Production feed is required. Warehouse pickers land a released MO's raw-material transfer here so floor operators can pick it up when the run starts — without this cell an MO physically can't stage on this site."
  end

  defp reason_for("rnd") do
    "At least one cell marked R&D is required so trial-batch ingredient consumption and trial output stay physically separate from commercial production stock."
  end

  defp reason_for(other), do: "Add at least one cell with purpose = #{other}."
end
