defmodule Backend.Repo.Migrations.EncryptUsersTotpSecret do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Convert `users.totp_secret` from plaintext `varchar` to
  Vault-encrypted `bytea`.

  Ships as three steps in one migration:

    1. Add a `totp_secret_enc` bytea column.
    2. Read each existing plaintext secret, encrypt via
       `Backend.Vault`, write into the new column.
    3. Drop the old column and rename `totp_secret_enc` back to
       `totp_secret`.

  On rollback, decrypts back into a plaintext column. The Vault must
  be booted for the migration to succeed — the `use Mix.Task`-style
  `Application.ensure_all_started(:backend)` block above `change/0`
  handles that in dev/test; releases run migrations via
  `Backend.Release.migrate/0` which starts the app first.

  If your deployment sequence runs migrations from a runner that
  doesn't start the full app, temporarily inline `Backend.Vault` boot
  before this migration.
  """

  def up do
    ensure_vault_started!()

    alter table(:users) do
      add :totp_secret_enc, :binary
    end

    flush()

    from(u in "users",
      where: not is_nil(u.totp_secret),
      select: %{id: u.id, totp_secret: u.totp_secret}
    )
    |> repo().all()
    |> Enum.each(fn %{id: id, totp_secret: plaintext} ->
      {:ok, encrypted} = Backend.Vault.encrypt(plaintext)

      from(u in "users", where: u.id == ^id)
      |> repo().update_all(set: [totp_secret_enc: encrypted])
    end)

    alter table(:users) do
      remove :totp_secret
    end

    rename table(:users), :totp_secret_enc, to: :totp_secret
  end

  def down do
    ensure_vault_started!()

    alter table(:users) do
      add :totp_secret_dec, :string
    end

    flush()

    from(u in "users",
      where: not is_nil(u.totp_secret),
      select: %{id: u.id, totp_secret: u.totp_secret}
    )
    |> repo().all()
    |> Enum.each(fn %{id: id, totp_secret: encrypted} ->
      {:ok, plaintext} = Backend.Vault.decrypt(encrypted)

      from(u in "users", where: u.id == ^id)
      |> repo().update_all(set: [totp_secret_dec: plaintext])
    end)

    alter table(:users) do
      remove :totp_secret
    end

    rename table(:users), :totp_secret_dec, to: :totp_secret
  end

  # `mix ecto.migrate` starts the Repo but not the full application,
  # so the Vault isn't automatically alive. Boot it lazily here.
  # `ensure_all_started` is safe to call multiple times.
  defp ensure_vault_started! do
    {:ok, _apps} = Application.ensure_all_started(:cloak)

    case Process.whereis(Backend.Vault) do
      nil -> {:ok, _pid} = Backend.Vault.start_link([])
      _pid -> :ok
    end
  end
end
