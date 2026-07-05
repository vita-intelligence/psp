defmodule Security.EncryptionAtRestTest do
  @moduledoc """
  Verifies the Cloak-backed vault + Ecto field type actually stores
  ciphertext on disk. Belt + braces on top of Cloak's own suite so
  a future refactor that swaps the cipher can't silently regress to
  plaintext.
  """

  use Backend.SecurityCase, async: false

  alias Backend.MFA
  alias Backend.Repo

  test "Vault round-trips a UTF-8 string" do
    plaintext = "hello, 🔐 world"

    {:ok, ciphertext} = Backend.Vault.encrypt(plaintext)
    assert is_binary(ciphertext)
    assert ciphertext != plaintext

    {:ok, decrypted} = Backend.Vault.decrypt(ciphertext)
    assert decrypted == plaintext
  end

  test "the raw DB column stores ciphertext, not the plaintext secret" do
    company = insert_company!("Vault test")
    user = insert_user!(company.id, "vault@vitamanufacture.co.uk")

    # Enroll to persist a real base32 secret against the column.
    {:ok, %{secret_base32: base32}, enrolled} = MFA.enroll(user)
    assert String.match?(base32, ~r/^[A-Z2-7]+$/)

    # The Ecto struct hands back the plaintext, since Backend.Encrypted.Binary
    # decrypts on read.
    assert enrolled.totp_secret == base32

    # But a raw SQL fetch bypasses Ecto's field type — the raw column
    # holds ciphertext bytes, not the base32 string.
    %{rows: [[raw]]} =
      Ecto.Adapters.SQL.query!(Repo, "SELECT totp_secret FROM users WHERE id = $1", [
        user.id
      ])

    assert is_binary(raw)
    assert raw != base32, "raw column still contains plaintext — encryption regressed"
    # AES-GCM ciphertext always starts with a Cloak tag envelope.
    # The 3-byte tag ("AA0" for the default cipher) is somewhere near
    # the front — check it made it in.
    assert raw =~ "AA0"
  end

  test "MFA enrollment + verify still work end-to-end with encrypted storage" do
    company = insert_company!("End-to-end vault test")
    user = insert_user!(company.id, "e2e-vault@vitamanufacture.co.uk")

    {:ok, _, enrolled} = MFA.enroll(user)
    {:ok, secret} = Base.decode32(enrolled.totp_secret, padding: false)
    code = NimbleTOTP.verification_code(secret)

    {:ok, _confirmed, _codes} = MFA.confirm(enrolled, code)

    # Re-fetch the row to prove decryption still yields a working
    # secret across a full Repo round-trip.
    reloaded = Repo.get!(Backend.Accounts.User, user.id)
    {:ok, decoded} = Base.decode32(reloaded.totp_secret, padding: false)
    fresh_code = NimbleTOTP.verification_code(decoded)

    assert :ok = MFA.verify(reloaded, fresh_code)
  end
end
