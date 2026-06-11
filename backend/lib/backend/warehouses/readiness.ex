defmodule Backend.Warehouses.Readiness do
  @moduledoc """
  Warehouse goods-in readiness check.

  A BRCGS / FSSC food-safety warehouse can't run goods-in without
  physical segregation areas for:

    * **quarantine** — every incoming lot lands here pending QC
      verdict (BRCGS Issue 9 § 5.3, FSSC 22000 § 8.9.4 control of
      nonconforming product)
    * **hold** — lots awaiting investigation that aren't quarantine
      and aren't yet rejected (allergen review, supplier query, …)
    * **rejected** — lots failed by QC, awaiting disposal or return

  Without at least one cell of each purpose the auto-router on the
  goods-in verdict can't park lots, and the receive flow silently
  routes everything into `regular` cells — exactly the off-the-
  regulatory-road scenario the cell-purpose machinery was built
  to prevent.

  This module is pure — no DB writes, no transitions. The
  `Backend.Purchasing.receive_against_po/3` gate calls it on every
  receive attempt; the warehouse show payload calls it to surface
  the live coverage on the plan page.

  Dispatch is intentionally NOT required for goods-in — it only
  matters for outbound shipments. Add when we ship a warehouse-
  dispatch flow.
  """

  import Ecto.Query, warn: false
  alias Backend.Repo
  alias Backend.Warehouses.StorageCell
  alias Backend.Warehouses.StorageLocation

  # Purposes the goods-in pipeline cannot operate without.
  @required_purposes ~w(quarantine hold rejected)

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

  @doc """
  Run the readiness check for a single warehouse. Returns the cell
  count per purpose plus the missing-purpose blocker list. Both go on
  the show payload so the FE can render the coverage chip strip
  + the regulatory-why for each missing one.

  `nil` warehouse → trivially not ready (use this to fail-safe when
  the caller hasn't supplied a warehouse_id yet).
  """
  @spec check(integer() | nil) :: readiness()
  def check(nil), do: %{counts: zero_counts(), blockers: missing_all(), ready?: false}

  def check(warehouse_id) when is_integer(warehouse_id) do
    counts = counts_for(warehouse_id)
    blockers = blockers_for(counts)

    %{
      counts: counts,
      blockers: blockers,
      ready?: blockers == []
    }
  end

  @doc "Required-purpose list — exposed for the FE legend + the docs."
  def required_purposes, do: @required_purposes

  # ----- internals ------------------------------------------------

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

  defp blockers_for(counts) do
    @required_purposes
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
    # even if its row count is zero (vs absent).
    %{
      "regular" => 0,
      "quarantine" => 0,
      "hold" => 0,
      "rejected" => 0,
      "dispatch" => 0
    }
  end

  defp missing_all do
    Enum.map(@required_purposes, fn purpose ->
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

  defp reason_for(other), do: "Add at least one cell with purpose = #{other}."
end
