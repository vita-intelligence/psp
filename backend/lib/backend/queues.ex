defmodule Backend.Queues do
  @moduledoc """
  Read-only "what needs attention soon" queries. Two queues today:

  * **Reviews due** — raw-material compliance rows where
    `review_due_at` falls within the next N days (default 30).
  * **Certificates expiring** — per-item certificate attachments
    where `valid_until` falls within the next N days (default 30).

  Both indexed at the schema level so these queries stay cheap as
  the catalogue grows.
  """

  import Ecto.Query, warn: false

  alias Backend.Certificates.ItemCertificate
  alias Backend.Items.{Item, RawMaterialCompliance}
  alias Backend.Repo

  @default_window_days 30

  @doc """
  Raw-material items whose compliance review is due within `window_days`.
  Includes already-overdue rows (`review_due_at <= horizon`).
  Returns `[{item, compliance}]` so the FE can show the item name +
  the due date + the days-overdue badge.
  """
  def reviews_due(company_id, window_days \\ @default_window_days)
      when is_integer(company_id) and is_integer(window_days) do
    horizon = Date.add(Date.utc_today(), window_days)

    Repo.all(
      from(c in RawMaterialCompliance,
        join: i in Item,
        on: i.id == c.item_id,
        where:
          i.company_id == ^company_id and i.is_active == true and
            not is_nil(c.review_due_at) and c.review_due_at <= ^horizon,
        order_by: [asc: c.review_due_at, asc: i.name],
        preload: [item: {i, [:stock_uom, :product_family]}, last_reviewed_by: []],
        select: %{item: i, compliance: c}
      )
    )
  end

  @doc """
  Certificate attachments expiring within `window_days`. Includes
  already-expired rows. Returns `[{item, attachment}]` for the FE
  table.
  """
  def certificates_expiring(company_id, window_days \\ @default_window_days)
      when is_integer(company_id) and is_integer(window_days) do
    horizon = Date.add(Date.utc_today(), window_days)

    Repo.all(
      from(ic in ItemCertificate,
        join: i in Item,
        on: i.id == ic.item_id,
        where:
          i.company_id == ^company_id and i.is_active == true and
            not is_nil(ic.valid_until) and ic.valid_until <= ^horizon,
        order_by: [asc: ic.valid_until, asc: i.name],
        preload: [certificate: [], item: {i, []}],
        select: %{item: i, attachment: ic}
      )
    )
  end
end
