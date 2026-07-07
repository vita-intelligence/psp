defmodule Backend.Equipment do
  @moduledoc """
  Boundary for the equipment registry — individual physical units
  with serial numbers, cadence-driven maintenance + calibration
  schedules, and a lifecycle event log.

  This module is the read + registry surface. Lifecycle transitions
  (put_in_service, moved, maintenance_started, calibrated, retired,
  disposed, etc.) run through `Backend.Equipment.Lifecycle` — added
  in a follow-up PR.

  ## Compliance posture

    * BRCGS Issue 9 § 4.13 — equipment used for verifying product
      safety-critical parameters (scales, thermometers, moisture
      analysers, pH meters) requires documented calibration on a
      cadence with signed evidence. `calibration_frequency_months`
      + `last/next_calibrated_at` + evidence uploads carry this.
    * BRCGS Issue 9 § 4.11.6 — planned preventive maintenance for
      food-contact equipment. Same fields as calibration but under
      `maintenance_*` prefix.
    * BRCGS Issue 9 § 3.5.2 — traceability of equipment origin
      (via `purchase_order_line_id`) + retention of the audit
      trail (via `equipment_events`).
  """

  import Ecto.Query, warn: false

  alias Backend.Equipment.Equipment
  alias Backend.Repo

  @doc """
  Fetch a unit by uuid, scoped to the current company. Returns
  `nil` when the uuid doesn't parse or the unit is on a different
  tenant.
  """
  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Equipment
        |> where([e], e.company_id == ^company_id and e.uuid == ^cast)
        |> preload([
          :item,
          :current_cell,
          :assigned_to,
          :purchase_order_line,
          :created_by,
          :updated_by
        ])
        |> Repo.one()

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  @doc """
  All units for the tenant. No paging yet — the ledger + list
  endpoints in a follow-up PR add cursor pagination.
  """
  def list_for_company(company_id) when is_integer(company_id) do
    Equipment
    |> where([e], e.company_id == ^company_id)
    |> order_by([e], asc: e.id)
    |> preload([:item, :current_cell, :assigned_to])
    |> Repo.all()
  end
end
