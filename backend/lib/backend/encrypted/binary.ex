defmodule Backend.Encrypted.Binary do
  @moduledoc """
  Ecto type for binary columns whose plaintext is a UTF-8 string.
  Dispatches encryption/decryption through `Backend.Vault`. See the
  Vault moduledoc for key management.

  Use in schemas the same way as `:string`:

      field :totp_secret, Backend.Encrypted.Binary, redact: true
  """

  use Cloak.Ecto.Binary, vault: Backend.Vault
end
