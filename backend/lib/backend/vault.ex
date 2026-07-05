defmodule Backend.Vault do
  @moduledoc """
  Application-wide encryption vault for column-level encryption at
  rest.

  The active cipher is AES-256-GCM. Ciphers are keyed by short tags
  (`"AA0"`, `"AA1"`, …) so rotating keys is additive: register a new
  key, mark it the default for new writes, and existing rows keep
  decrypting under the previous tag until they're re-saved.

  Configuration lives at runtime, sourced from an env var so a leaked
  release archive doesn't include the key:

      export CLOAK_KEY=<base64-encoded 32-byte key>

  Local dev falls back to a fixed key so `mix ecto.migrate` works
  without extra setup. Never ship the dev key to production — the
  env-var branch fires first in prod.

  Rotate by generating a new key and:

      config :backend, Backend.Vault,
        ciphers: [
          # New default — every future write uses this tag.
          new: {Cloak.Ciphers.AES.GCM, tag: "AA1", key: new_key},
          # Retained so previously-encrypted rows still decrypt.
          old: {Cloak.Ciphers.AES.GCM, tag: "AA0", key: old_key}
        ]

  Then run a re-encrypt task per encrypted column (Cloak.Ecto ships
  `Cloak.Ecto.Migrator` for exactly this).
  """

  use Cloak.Vault, otp_app: :backend

  @impl Cloak.Vault
  def init(config) do
    # `runtime.exs` writes `Application.put_env(:backend, Backend.Vault,
    # ciphers: [...])` before boot; we keep that in place. Only fall
    # back if nothing is configured (e.g. `mix compile` from a fresh
    # clone before runtime.exs ran).
    config =
      if Keyword.has_key?(config, :ciphers) do
        config
      else
        Keyword.put(config, :ciphers,
          default: {
            Cloak.Ciphers.AES.GCM,
            tag: "AA0",
            key: dev_fallback_key()
          }
        )
      end

    {:ok, config}
  end

  # Fixed 32-byte key derived at compile time. **Dev only.** The
  # runtime branch above intentionally never falls through in prod
  # because `config/runtime.exs` refuses to boot without `CLOAK_KEY`.
  defp dev_fallback_key do
    :crypto.hash(:sha256, "psp-dev-vault-key-DO-NOT-USE-IN-PROD")
  end
end
