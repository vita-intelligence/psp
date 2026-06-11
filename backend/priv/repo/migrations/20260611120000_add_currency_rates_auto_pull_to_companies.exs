defmodule Backend.Repo.Migrations.AddCurrencyRatesAutoPullToCompanies do
  use Ecto.Migration

  @moduledoc """
  Auto-pull metadata for ECB-sourced currency rates. The rates
  themselves stay in the existing `currency_rates` JSONB bag; these
  three columns surface "who set them last", "when did the cron
  succeed", and "is the cron allowed to overwrite manual edits".

  Defaults are chosen so existing companies behave as if the cron is
  on but has not yet run — first cron tick will flip `source` to
  `ecb_auto` and stamp `pulled_at`. No backfill needed.
  """

  def change do
    alter table(:companies) do
      add :currency_rates_auto_pull, :boolean, null: false, default: true
      add :currency_rates_pulled_at, :utc_datetime
      add :currency_rates_source, :string, null: false, default: "manual"
    end
  end
end
