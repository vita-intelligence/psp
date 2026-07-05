defmodule Backend.Repo.Migrations.AddTokenVersionToUsers do
  use Ecto.Migration

  @moduledoc """
  Add `token_version` to users so we can invalidate every outstanding
  session token in one bump.

  Signed session tokens embed the version they were minted against.
  Password change / password reset increment the column, which makes
  every older token fail verification. Rotate defensively (admin
  action, suspected compromise) by incrementing the same field.
  """

  def change do
    alter table(:users) do
      add :token_version, :integer, default: 0, null: false
    end
  end
end
