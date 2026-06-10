defmodule Backend.Repo.Migrations.CreateDevicePairingCodes do
  use Ecto.Migration

  @moduledoc """
  Short-lived pairing codes — the laptop creates one, shows it as a QR
  + 6-char fallback, and the phone consumes it once at `/pair?code=…`
  in exchange for a long-lived device token.

  Codes are single-use (`used_by_device_id` flips at claim time) and
  expire after a few minutes to bound the drive-by window. Old rows
  stay for audit; a periodic prune job can sweep them later.
  """

  def change do
    create table(:device_pairing_codes) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :company_id, references(:companies, on_delete: :delete_all), null: false

      # 6 unambiguous uppercase chars (no 0/O/1/I) — easy to type on
      # phone keypad if the QR scan fails. Unique while active.
      add :code, :string, size: 8, null: false

      add :expires_at, :utc_datetime, null: false

      add :used_by_device_id, references(:linked_devices, on_delete: :nilify_all)
      add :used_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create unique_index(:device_pairing_codes, [:uuid])
    create unique_index(:device_pairing_codes, [:code])
    create index(:device_pairing_codes, [:user_id, :inserted_at])
  end
end
