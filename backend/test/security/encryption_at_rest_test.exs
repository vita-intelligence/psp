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

  describe "PII column encryption sweep" do
    test "companies.tax_number + payment_details store ciphertext" do
      tax_number = "GB123456789"
      payment_details = "Sort code 12-34-56, acct 12345678"

      {:ok, company} =
        %Backend.Companies.Company{}
        |> Backend.Companies.Company.bootstrap_changeset(%{name: "PII test co"})
        |> Backend.Repo.insert()

      {:ok, updated} =
        Backend.Companies.update_identity(company, %{
          "tax_number" => tax_number,
          "payment_details" => payment_details
        })

      # In-memory struct hands back plaintext.
      assert updated.tax_number == tax_number
      assert updated.payment_details == payment_details

      # Raw column is ciphertext.
      %{rows: [[raw_tax, raw_pay]]} =
        Ecto.Adapters.SQL.query!(
          Repo,
          "SELECT tax_number, payment_details FROM companies WHERE id = $1",
          [company.id]
        )

      assert is_binary(raw_tax) and raw_tax != tax_number
      assert is_binary(raw_pay) and raw_pay != payment_details
      assert raw_tax =~ "AA0"
      assert raw_pay =~ "AA0"
    end

    test "vendors.tax_number stores ciphertext AND is dropped from search" do
      company = insert_company!("Vendor encryption")
      actor = insert_user!(company.id, "ve@vitamanufacture.co.uk", ["vendors.create"])
      tax_number = "IE9876543Z"

      {:ok, vendor} =
        Backend.Vendors.create(actor, company.id, %{
          name: "Encrypted Vendor",
          currency_code: "EUR",
          tax_number: tax_number
        })

      assert vendor.tax_number == tax_number

      %{rows: [[raw]]} =
        Ecto.Adapters.SQL.query!(
          Repo,
          "SELECT tax_number FROM vendors WHERE id = $1",
          [vendor.id]
        )

      assert raw != tax_number
      assert raw =~ "AA0"

      # Searching for the plaintext tax number no longer matches —
      # the search column list dropped this field. Fuzzy match still
      # works on `name` / `legal_name` / `registration_number`.
      {items, _} = Backend.Vendors.list_page(company.id, search: tax_number)
      assert items == []

      {items, _} = Backend.Vendors.list_page(company.id, search: "Encrypted Vendor")
      assert Enum.any?(items, &(&1.id == vendor.id))
    end
  end
end
