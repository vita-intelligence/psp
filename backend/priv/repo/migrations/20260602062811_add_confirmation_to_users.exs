defmodule Backend.Repo.Migrations.AddConfirmationToUsers do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :confirmed_at, :utc_datetime
      add :confirmation_token, :string
    end

    # Tokens are single-use, so a unique index keeps the lookup O(log n)
    # and prevents the absurd case of duplicate tokens. Partial so
    # cleared (NULL) tokens never collide.
    create unique_index(:users, [:confirmation_token],
             where: "confirmation_token IS NOT NULL"
           )
  end
end
