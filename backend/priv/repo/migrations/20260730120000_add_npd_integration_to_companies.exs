defmodule Backend.Repo.Migrations.AddNpdIntegrationToCompanies do
  use Ecto.Migration

  @moduledoc """
  NPD reverse-integration config on the Company row.

  Mirrors the shape NPD uses for its side (``Organization.psp_config``):
  a flag, a base URL, and a Cloak-encrypted bearer token. Optional
  everywhere so seed companies pre-integration stay valid.
  """

  def change do
    alter table(:companies) do
      add :npd_integration_enabled, :boolean, default: false, null: false
      add :npd_base_url, :string
      add :npd_integration_token, :binary
    end
  end
end
