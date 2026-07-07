defmodule Backend.Repo.Migrations.CreateIntegrationTokens do
  use Ecto.Migration

  # Long-lived opaque bearer tokens for machine-to-machine callers
  # (vita-performance today, more later). Never rotated by the server
  # — an operator issues them on `/settings/integrations`, copies the
  # raw string once, and stores it in the caller's secret manager.
  # Revocation is `is_active = false` (soft) plus `revoked_at` +
  # `revoked_by` for the audit trail.
  #
  # Storage:
  #   * `token_hash`   — bcrypt(raw_token), cost 12 (same as passwords).
  #   * `token_prefix` — first 20 chars of the raw token (`psp_live_` +
  #                       11 hex chars). Displayed in the UI so an
  #                       operator can identify a token without seeing
  #                       the sensitive tail. Also indexed so the plug
  #                       does one keyed lookup instead of scanning
  #                       every row.
  #
  # Scopes are stored as a text array; the plug enforces
  # least-privilege by matching the required scope for the endpoint
  # against `scopes` on hit.
  #
  # Multi-tenancy: every token binds to exactly one company, so the
  # plug can set `conn.assigns.current_company_id` and every scoped
  # controller resolves data through that.
  def change do
    create table(:integration_tokens) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")

      add :company_id, references(:companies, on_delete: :restrict), null: false

      # Human-readable name shown on `/settings/integrations`
      # (e.g. "vita-performance"). Unique per company so an operator
      # can't accidentally mint two tokens with the same name.
      add :name, :string, null: false, size: 100

      # bcrypt(raw_token), cost 12.
      add :token_hash, :string, null: false

      # First 20 chars of the raw token — used for indexed lookup and
      # UI display. Format: "psp_live_" + 11 hex chars.
      add :token_prefix, :string, null: false, size: 24

      # Least-privilege capability list. Only endpoints whose required
      # scope appears here will authorise. Enforced by the plug.
      add :scopes, {:array, :string}, null: false, default: []

      # Soft delete + audit trail. Revoked tokens stay in the table so
      # historical audit rows keep resolving; the plug rejects any
      # token whose `is_active = false`.
      add :is_active, :boolean, null: false, default: true
      add :revoked_at, :utc_datetime
      add :revoked_by_id, references(:users, on_delete: :nilify_all)
      add :revoke_reason, :string

      add :created_by_id, references(:users, on_delete: :nilify_all)

      # Bumped on every successful auth. Lets ops see "when was this
      # token last used?" and detect orphaned tokens.
      add :last_used_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create unique_index(:integration_tokens, [:uuid])
    create unique_index(:integration_tokens, [:company_id, :name])
    create unique_index(:integration_tokens, [:token_prefix])
    create index(:integration_tokens, [:company_id, :is_active])
  end
end
