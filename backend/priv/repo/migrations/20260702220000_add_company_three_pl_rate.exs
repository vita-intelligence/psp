defmodule Backend.Repo.Migrations.AddCompanyThreePlRate do
  use Ecto.Migration

  # 3PL storage rate — accrues against every bailee lot from
  # bailee_routed_at until dispatch. Kept as a plain decimal in the
  # company base currency (currency_code) so we don't have to pin an
  # FX moment; the number the settings card shows is the number
  # invoiced. Nullable so companies that haven't decided on a rate
  # yet see "no rate configured" on the 3PL tab, not £0.00.
  def change do
    alter table(:companies) do
      add :three_pl_rate_per_m3_per_day, :decimal, precision: 12, scale: 4, null: true
    end
  end
end
