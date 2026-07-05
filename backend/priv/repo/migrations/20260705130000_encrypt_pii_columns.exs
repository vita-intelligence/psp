defmodule Backend.Repo.Migrations.EncryptPiiColumns do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Convert four PII-heavy `varchar` columns to Vault-encrypted `bytea`:

    * `companies.tax_number`
    * `companies.payment_details`
    * `vendors.tax_number`
    * `customers.tax_number`

  Same pattern as `20260705120000_encrypt_users_totp_secret`: add
  `<col>_enc`, walk every non-null row through `Backend.Vault.encrypt/1`,
  drop the plaintext column, rename.

  These columns are the ones an audit for GDPR / PCI-scope would flag
  first — tax numbers are regulator IDs that identify legal entities,
  payment_details holds the bank string that goes on remittance
  advice.

  Trade-off: fuzzy search over `tax_number` (partial ILIKE) stops
  working post-encryption. `Backend.Vendors` + `Backend.Customers`
  drop tax_number from `@vendor_search` / `@customer_search` in the
  same commit — users still search by name / legal_name / contact.
  """

  @targets [
    {"companies", :tax_number},
    {"companies", :payment_details},
    {"vendors", :tax_number},
    {"customers", :tax_number}
  ]

  def up do
    ensure_vault_started!()

    for {table, col} <- @targets do
      col_str = Atom.to_string(col)
      enc_col = String.to_atom(col_str <> "_enc")

      alter table(String.to_atom(table)) do
        add enc_col, :binary
      end
    end

    flush()

    for {table, col} <- @targets do
      col_str = Atom.to_string(col)
      enc_col = String.to_atom(col_str <> "_enc")

      from(t in table,
        where: not is_nil(field(t, ^col)),
        select: %{id: t.id, val: field(t, ^col)}
      )
      |> repo().all()
      |> Enum.each(fn %{id: id, val: plaintext} ->
        {:ok, encrypted} = Backend.Vault.encrypt(plaintext)

        from(t in table, where: t.id == ^id)
        |> repo().update_all(set: [{enc_col, encrypted}])
      end)
    end

    for {table, col} <- @targets do
      col_str = Atom.to_string(col)
      enc_col = String.to_atom(col_str <> "_enc")

      alter table(String.to_atom(table)) do
        remove col
      end

      rename table(String.to_atom(table)), enc_col, to: col
    end
  end

  def down do
    ensure_vault_started!()

    for {table, col} <- @targets do
      col_str = Atom.to_string(col)
      dec_col = String.to_atom(col_str <> "_dec")

      alter table(String.to_atom(table)) do
        add dec_col, :string
      end
    end

    flush()

    for {table, col} <- @targets do
      col_str = Atom.to_string(col)
      dec_col = String.to_atom(col_str <> "_dec")

      from(t in table,
        where: not is_nil(field(t, ^col)),
        select: %{id: t.id, val: field(t, ^col)}
      )
      |> repo().all()
      |> Enum.each(fn %{id: id, val: encrypted} ->
        {:ok, plaintext} = Backend.Vault.decrypt(encrypted)

        from(t in table, where: t.id == ^id)
        |> repo().update_all(set: [{dec_col, plaintext}])
      end)
    end

    for {table, col} <- @targets do
      col_str = Atom.to_string(col)
      dec_col = String.to_atom(col_str <> "_dec")

      alter table(String.to_atom(table)) do
        remove col
      end

      rename table(String.to_atom(table)), dec_col, to: col
    end
  end

  defp ensure_vault_started! do
    {:ok, _apps} = Application.ensure_all_started(:cloak)

    case Process.whereis(Backend.Vault) do
      nil -> {:ok, _pid} = Backend.Vault.start_link([])
      _pid -> :ok
    end
  end
end
