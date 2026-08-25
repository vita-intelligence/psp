defmodule Backend.Repo.Migrations.AddNpdPaymentsAndLabelFilesAndHeaderImage do
  use Ecto.Migration

  @moduledoc """
  Multi-payment mirror + label supplementary files + project header image.

  Three additions in one migration because they all ride the same
  vita-cff → PSP main-formulation sync payload and land together on
  every push:

  1. `customer_order_npd_payments` — one row per NPD Payment attached
     to the CO's formulation. Replaces the singular `npd_payment_*`
     columns on `customer_orders` for custom projects (RTG sample
     flow keeps the singular columns as a back-compat channel).
     Deposit → additional_samples → label_design → final each get
     their own row, so the PSP invoice card can render the full
     finance trail per project.

  2. `customer_orders.npd_label_files` — JSONB list of supplementary
     artwork assets (back / side / bottle mockup views) attached to
     the CURRENT LabelDesign revision. Primary PDF + preview PNG stay
     on the singular columns added in the prior migration.

  3. `customer_orders.npd_header_image_url` — one URL vita-cff has
     already picked using the priority chain (approved label preview
     PNG → first product photo → empty). PSP renders it as the
     project's dashboard tile hero + detail-page banner.
  """

  def change do
    create table(:customer_order_npd_payments) do
      add :customer_order_id, references(:customer_orders, on_delete: :delete_all), null: false

      # The NPD `Payment.id` (uuid, string on this side because
      # PSP's own `uuid` primary keys are also stringy). Unique per
      # CO so the sync writer can upsert by `(customer_order_id, npd_payment_id)`.
      add :npd_payment_id, :uuid, null: false

      # `deposit` / `additional_samples` / `label_design` / `final` /
      # anything future NPD adds. String rather than enum so a new
      # kind on NPD doesn't require a coordinated PSP migration.
      add :kind, :string, null: false

      add :amount, :decimal, precision: 14, scale: 2
      add :currency, :string, size: 3

      # `pending` / `approved` / `voided`. Mirrors NPD's
      # `PaymentStatus` values.
      add :status, :string, null: false

      # Human-facing invoice reference (finance types it on approve).
      # Empty when finance hasn't recorded one yet.
      add :invoice_number, :string

      # NPD's `approved_at` when set, else `paid_at`. See
      # `_sample_payment_payload` on vita-cff for the priority.
      add :paid_at, :utc_datetime

      # PaymentFile mirror: `[%{uuid, filename, mime, byte_size, uploaded_at}]`.
      # Bytes stay on NPD; PSP proxies opens through its own origin.
      add :files, {:array, :map}, default: [], null: false

      # Freshness anchor — the NPD sync landing time. Distinct from
      # `updated_at` which tracks PSP-side edits (none today; the
      # sync writer is the only writer).
      add :synced_at, :utc_datetime, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(
             :customer_order_npd_payments,
             [:customer_order_id, :npd_payment_id],
             name: :customer_order_npd_payments_co_payment_uidx
           )
    # `paid_at` is the natural ordering for the PSP invoice card
    # (finance timeline is chronological). Composite index keeps the
    # per-CO fetch a single index scan.
    create index(
             :customer_order_npd_payments,
             [:customer_order_id, :paid_at],
             name: :customer_order_npd_payments_co_paid_idx
           )

    alter table(:customer_orders) do
      # Supplementary artwork views on the CURRENT LabelDesign
      # revision. `[%{uuid, label, content_type, filename, byte_size,
      # file_url}]`. Empty list when no revision or no extras.
      add :npd_label_files, {:array, :map}, default: []

      # One URL PSP renders as the project's header image. Priority
      # chain runs on NPD (approved label preview → first product
      # photo → empty) so PSP doesn't fetch multiple upstream URLs.
      add :npd_header_image_url, :string, size: 500
    end
  end
end
