defmodule Backend.Repo.Migrations.AddProfileAndPasswordResetToUsers do
  use Ecto.Migration

  def change do
    alter table(:users) do
      # Avatar is a base64 data URL — unbounded text. ~50KB per user
      # is a non-issue at our scale; revisit if avatars grow or the
      # roster exceeds a few thousand rows.
      add :avatar, :text
      add :password_reset_token, :string
      add :password_reset_sent_at, :utc_datetime
    end

    create unique_index(:users, [:password_reset_token],
             where: "password_reset_token IS NOT NULL"
           )
  end
end
