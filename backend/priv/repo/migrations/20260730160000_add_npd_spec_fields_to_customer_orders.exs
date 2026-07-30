defmodule Backend.Repo.Migrations.AddNpdSpecFieldsToCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  Denormalised specification-sheet identity + sign-off from NPD.

  Fired on the sheet's ``in_review → approved`` transition (director
  signs). Presence of ``npd_spec_approved_at`` on a draft CO is what
  moves the wizard phase from ``:r_and_d`` → ``:awaiting_proposal``
  — that's the "spec is quotable, sales can start the proposal" state.
  """

  def change do
    alter table(:customer_orders) do
      add :npd_spec_sheet_uuid, :uuid
      # Deep link to the sheet on NPD — same pattern as npd_app_url.
      # 500 chars matches the existing formulation-URL column.
      add :npd_spec_sheet_url, :string, size: 500
      add :npd_spec_prepared_by_name, :string, size: 200
      add :npd_spec_prepared_at, :utc_datetime
      add :npd_spec_director_name, :string, size: 200
      add :npd_spec_approved_at, :utc_datetime
    end
  end
end
