defmodule Backend.Repo.Migrations.AddIssueKindToStockMovements do
  use Ecto.Migration

  # `issue` is a new stock movement kind for the consumables flow
  # (PPE, sanitiser, food-grade lube, lab reagents, spare parts).
  # An operator "issues" a qty from a lot at a specific cell to a
  # recipient — typically another worker for their shift, sometimes
  # linked to a specific MO. Different from `consume` (which is the
  # MO-internal pick → confirm → consume ceremony) because the
  # recipient is a person / department, not a production step.
  #
  # The kind itself is a string column with no DB check constraint,
  # so accepting "issue" only requires the schema whitelist update
  # in `Backend.Stock.Movement`. This migration adds a nullable
  # `issued_to_user_id` FK — the "who took it" side of the audit
  # trail, distinct from `actor_id` ("who issued it"). Optional
  # because a shift-level bulk issuance may not track individual
  # recipients.
  def change do
    alter table(:stock_movements) do
      add :issued_to_user_id, references(:users, on_delete: :nilify_all), null: true
    end

    create index(:stock_movements, [:issued_to_user_id])
  end
end
