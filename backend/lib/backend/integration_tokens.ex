defmodule Backend.IntegrationTokens do
  @moduledoc """
  Boundary for machine-to-machine bearer credentials
  (`Backend.Accounts.IntegrationToken`).

  Token strings look like `psp_live_<11 hex><21 hex>` — 32 hex chars
  in total after the `psp_live_` marker, giving ~128 bits of entropy.
  The first 20 chars (marker + 11 hex) are the searchable prefix; the
  rest is what goes into bcrypt. The plaintext never leaves this
  module except on the create call where the operator sees it once.

  Bcrypt cost matches user passwords (12). Verifying every hit is
  ~50ms — acceptable because the caller opens one long-lived HTTPS
  session and reuses it; not acceptable if we ever move to per-request
  auth for a chatty client, at which point cache verified prefixes.
  """

  import Ecto.Query, warn: false

  alias Backend.Repo
  alias Backend.Accounts.IntegrationToken

  @token_marker "psp_live_"
  # 11 hex chars after `psp_live_` = 20 total (the searchable prefix).
  # 21 more hex chars = the secret tail bcrypt sees.
  @prefix_hex_len 11
  @secret_hex_len 21

  ## Minting ---------------------------------------------------------

  @doc """
  Generate + persist a new integration token for `company_id`.

  Returns `{:ok, %{token: raw_token, record: %IntegrationToken{}}}` on
  success. **`raw_token` is the only place the plaintext ever
  surfaces** — hand it to the operator immediately and drop the
  reference. All subsequent auth is against the stored bcrypt hash.
  """
  def create(attrs, company_id, created_by_id) when is_map(attrs) do
    {raw_token, prefix} = mint_raw()

    hashed = Bcrypt.hash_pwd_salt(raw_token)

    changeset_attrs =
      attrs
      |> Map.put(:token_hash, hashed)
      |> Map.put(:token_prefix, prefix)
      |> Map.put(:company_id, company_id)
      |> Map.put(:created_by_id, created_by_id)

    %IntegrationToken{}
    |> IntegrationToken.create_changeset(changeset_attrs)
    |> Repo.insert()
    |> case do
      {:ok, record} -> {:ok, %{token: raw_token, record: record}}
      {:error, cs} -> {:error, cs}
    end
  end

  @doc """
  Generate a raw token string + its 20-char prefix. Callable from
  tests when you need to seed a known-prefix token.
  """
  def mint_raw do
    prefix_hex = random_hex(@prefix_hex_len)
    secret_hex = random_hex(@secret_hex_len)
    prefix = @token_marker <> prefix_hex
    raw = prefix <> secret_hex
    {raw, prefix}
  end

  defp random_hex(chars) do
    bytes = div(chars + 1, 2)

    :crypto.strong_rand_bytes(bytes)
    |> Base.encode16(case: :lower)
    |> binary_part(0, chars)
  end

  ## Verification ----------------------------------------------------

  @doc """
  Verify a raw token string against the stored hash.

  Returns:

    * `{:ok, %IntegrationToken{}}` — active, scope-check pending.
    * `{:error, :not_found}` — no matching prefix / inactive.
    * `{:error, :invalid}` — prefix matched but bcrypt failed.
    * `{:error, :malformed}` — token doesn't parse as
      `psp_live_<32 hex>`.

  On success, `last_used_at` is bumped as a side-effect. Also preloads
  `:company` since the plug will need it.
  """
  def verify(raw_token) when is_binary(raw_token) do
    case parse(raw_token) do
      {:ok, prefix} ->
        case lookup_active_by_prefix(prefix) do
          nil ->
            {:error, :not_found}

          %IntegrationToken{token_hash: hash} = token ->
            if Bcrypt.verify_pass(raw_token, hash) do
              touch_last_used(token)
              {:ok, token}
            else
              {:error, :invalid}
            end
        end

      :error ->
        {:error, :malformed}
    end
  end

  def verify(_), do: {:error, :malformed}

  defp parse(@token_marker <> rest) do
    total_hex = @prefix_hex_len + @secret_hex_len

    if byte_size(rest) == total_hex and String.match?(rest, ~r/^[0-9a-f]+$/) do
      {:ok, @token_marker <> binary_part(rest, 0, @prefix_hex_len)}
    else
      :error
    end
  end

  defp parse(_), do: :error

  defp lookup_active_by_prefix(prefix) do
    Repo.one(
      from t in IntegrationToken,
        where: t.token_prefix == ^prefix and t.is_active == true,
        preload: [:company]
    )
  end

  defp touch_last_used(token) do
    token
    |> IntegrationToken.touch_last_used_changeset()
    |> Repo.update()
  end

  @doc """
  Check whether the token's granted scopes include the required one.
  """
  def has_scope?(%IntegrationToken{scopes: scopes}, required)
      when is_binary(required) do
    required in scopes
  end

  ## Listing / lifecycle --------------------------------------------

  @doc """
  List all tokens (including revoked) for a company, newest first.
  Ties on `inserted_at` (same-second inserts) broken by `id` desc so
  ordering is deterministic in tests.
  """
  def list_for_company(company_id) do
    Repo.all(
      from t in IntegrationToken,
        where: t.company_id == ^company_id,
        order_by: [desc: t.inserted_at, desc: t.id],
        preload: [:created_by, :revoked_by]
    )
  end

  def get_by_uuid(uuid, company_id) do
    Repo.one(
      from t in IntegrationToken,
        where: t.uuid == ^uuid and t.company_id == ^company_id,
        preload: [:created_by, :revoked_by]
    )
  end

  @doc """
  Soft-delete a token. Sets `is_active` → false and stamps
  `revoked_at` / `revoked_by`. Callers of `verify/1` will get
  `{:error, :not_found}` on the next request.
  """
  def revoke(%IntegrationToken{} = token, revoker_user_id, reason \\ nil) do
    token
    |> IntegrationToken.revoke_changeset(%{
      revoked_by_id: revoker_user_id,
      revoke_reason: reason
    })
    |> Repo.update()
  end
end
