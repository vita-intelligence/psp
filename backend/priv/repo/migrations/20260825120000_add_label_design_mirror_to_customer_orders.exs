defmodule Backend.Repo.Migrations.AddLabelDesignMirrorToCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  Mirror columns for the vita-cff label-design workflow.

  Populated by the proposal-merge sync — vita-cff fires the sync from a
  `post_save` signal on `LabelDesign`, so every state change (path
  chosen, artwork uploaded, reviewer verdicts, customer approval)
  lands here without extra glue.

  Every column is nullable: a CO whose formulation hasn't bootstrapped
  a `LabelDesign` yet leaves them null, and the PSP UI reads that as
  "no label workflow started."
  """

  def change do
    alter table(:customer_orders) do
      # The `LabelDesign` row uuid on vita-cff (also the URL segment on
      # the /labelling/[id] workspace). Presence == a workflow exists.
      add :npd_label_design_uuid, :uuid

      # `payment_pending` / `label_path_pending` / `design_preferences_pending`
      # / `design_in_progress` / `scientist_review` / `director_review`
      # / `customer_approval` / `label_approved` / `on_hold`.
      add :npd_label_status, :string

      # `design_by_us` / `design_by_customer` / "" until the customer
      # picks on the portal.
      add :npd_label_design_path, :string

      # Customer's e-sign approval timestamp — the terminal signal for
      # the Vita-designs path. When set, `npd_label_status` should be
      # `label_approved`.
      add :npd_label_approved_at, :utc_datetime

      # Consecutive customer rejections. Bumped by vita-cff's transition
      # service; auto-hold routes at 3. Surfacing the count lets PSP
      # show "2 rejections" without making a second API call.
      add :npd_label_rejection_count, :integer

      # `updated_at` on the LabelDesign row — freshness anchor for the
      # PSP UI. Distinct from PSP's own `updated_at` on the CO.
      add :npd_label_updated_at, :utc_datetime

      # Thumbnail (PNG) of the current revision. Rendered on the PSP
      # kanban card and inside the R&D team card. Null until the first
      # artwork upload OR when the current revision has no preview.
      add :npd_label_preview_png_url, :string, size: 500

      # PDF of the current revision — the full artwork file. PSP links
      # out to this so a scientist can inspect the print-ready file.
      add :npd_label_pdf_url, :string, size: 500

      # Deep-link back to the /labelling/[id] workspace on vita-cff.
      # Empty string when APP_BASE_URL isn't configured for the org.
      add :npd_label_url, :string, size: 500
    end

    # Fast lookup by label-design uuid — mirrors the shape used for
    # spec-sheet and final-spec uuid indexes above. Supports a future
    # sync path keyed off the label design uuid rather than the
    # proposal uuid.
    create index(:customer_orders, [:npd_label_design_uuid])
  end
end
