defmodule Backend.Repo.Migrations.CreateLinkedDevices do
  use Ecto.Migration

  @moduledoc """
  Linked devices — phones / tablets / extra browsers paired to a user
  account. Each row holds a long-lived bearer token (stored as a SHA256
  hash, never plaintext) that the device presents in `Authorization:
  Bearer …` to authenticate API calls + the socket connect.

  Revocation is forward-only: setting `revoked_at` makes the token
  permanently dead at lookup time; the row stays for audit. The token
  hash column is uniquely indexed so a hash collision is caught at the
  DB layer rather than silently authenticating the wrong device.
  """

  def change do
    create table(:linked_devices) do
      add :uuid, :binary_id, null: false, default: fragment("gen_random_uuid()")
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :company_id, references(:companies, on_delete: :delete_all), null: false

      # Operator-given handle ("Goods-In tablet", "Max's iPhone"). The
      # platform + UA columns are denormalised from the claim request
      # so admins can spot stale "Chrome on Windows" rows without
      # parsing the UA at render time.
      add :label, :string, size: 80, null: false
      add :platform, :string, size: 32
      add :user_agent, :text

      # SHA256 of the raw token. The raw token is shown to the device
      # exactly once at claim time; we never store the plaintext, so a
      # DB dump leaks nothing usable. Length matches :crypto.hash/2
      # output for sha256 (32 bytes).
      add :token_hash, :binary, null: false

      add :last_seen_at, :utc_datetime
      add :paired_at, :utc_datetime, null: false
      # nil = active, set = revoked (forward-only)
      add :revoked_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create unique_index(:linked_devices, [:uuid])
    create unique_index(:linked_devices, [:token_hash])
    create index(:linked_devices, [:user_id])
    create index(:linked_devices, [:company_id, :user_id])
  end
end
