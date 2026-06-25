defmodule Backend.Repo.Migrations.CreateLoyalty do
  use Ecto.Migration

  @moduledoc """
  Loyalty programs + customer credits ledger.

  Tables:
    * `loyalty_programs` — named scheme. V1 supports `tiered_rebate`
      (cashback %) on `ytd_revenue`, paying out as `credit` to the
      customer's account.
    * `loyalty_program_tiers` — one row per threshold. `min_threshold`
      is the YTD revenue floor in the company base currency; once a
      customer's YTD paid revenue crosses it, the corresponding
      `rate_pct` cashback is granted.
    * `customer_credits` — signed-amount event ledger keyed by
      customer. `kind` distinguishes earned (rebate_accrual,
      manual_grant) from applied (applied_to_invoice). Balance is
      `sum(amount)` per customer, never persisted.

  Cross-cutting:
    * `customers.loyalty_program_id` — opt-in per customer. NULL means
      no program (no accrual fires).
    * `customer_credits.source_invoice_id` — for accruals, the invoice
      whose payment triggered the tier crossing; for applications,
      the invoice being credited.
    * Append-only intent on `customer_credits`: rows are inserted only.
      A correction is a new row with an opposite-sign amount + a
      `reason` referencing the corrected event, so the audit trail
      reads chronologically.
  """

  def change do
    create table(:loyalty_programs) do
      add :uuid, :uuid, null: false
      add :company_id, references(:companies, on_delete: :delete_all), null: false

      add :name, :string, null: false
      add :description, :text

      # Scheme enum. V1 ships with one value to keep the surface tight;
      # adding `flat_rate` (a single % on every paid invoice) is a one
      # liner when we want it.
      add :scheme, :string, null: false, default: "tiered_rebate"

      # What we measure against the tier thresholds.
      add :basis, :string, null: false, default: "ytd_revenue"

      # How the reward shows up. V1 = account credit only; gift cards
      # and bank refunds layer on later.
      add :payout_kind, :string, null: false, default: "credit"

      # Active programs can be assigned to customers + accrue rewards.
      # Deactivating prevents new accrual but doesn't void existing
      # credits — those stay in the ledger.
      add :is_active, :boolean, null: false, default: true

      # Company-default flag. New customers inherit this program if
      # set; only one row per company can be default at a time
      # (enforced server-side, not via partial unique because we want
      # the flip to be atomic).
      add :is_default, :boolean, null: false, default: false

      add :activated_at, :utc_datetime
      add :deactivated_at, :utc_datetime
      add :deactivation_reason, :string

      add :created_by_id, references(:users, on_delete: :nilify_all)
      add :updated_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:loyalty_programs, [:uuid])
    create index(:loyalty_programs, [:company_id])
    create index(:loyalty_programs, [:company_id, :is_active])
    create index(:loyalty_programs, [:company_id, :is_default])

    create table(:loyalty_program_tiers) do
      add :uuid, :uuid, null: false
      add :loyalty_program_id, references(:loyalty_programs, on_delete: :delete_all), null: false

      # Ordering within the program — both the rank field and the
      # threshold should agree on tier order. We sort by threshold at
      # query time so editing rank doesn't desync the math.
      add :rank, :integer, null: false, default: 0

      # YTD revenue floor (base currency). Once a customer's
      # `paid_revenue_ytd` >= this number, this tier's `rate_pct`
      # applies retroactively to all paid revenue under the program.
      add :min_threshold, :decimal, precision: 14, scale: 2, null: false

      # Cashback percentage as a decimal (e.g. 2.5 = 2.5%).
      add :rate_pct, :decimal, precision: 5, scale: 2, null: false

      add :label, :string

      timestamps(type: :utc_datetime)
    end

    create unique_index(:loyalty_program_tiers, [:uuid])
    create index(:loyalty_program_tiers, [:loyalty_program_id])

    create table(:customer_credits) do
      add :uuid, :uuid, null: false
      add :company_id, references(:companies, on_delete: :delete_all), null: false
      add :customer_id, references(:customers, on_delete: :delete_all), null: false

      # The event kind. Drives the UI label + the reason validation.
      #
      #   "rebate_accrual"     — auto-granted on tier crossing
      #   "manual_grant"       — admin gift (apology / goodwill)
      #   "applied_to_invoice" — negative-amount row when redeeming
      add :kind, :string, null: false

      # SIGNED amount. Earning rows are positive, redemptions are
      # negative. Stored in customer's currency (matches the invoice
      # that triggered the event) — balance projection converts at
      # display time. NULL not allowed; zero is rejected by changeset.
      add :amount, :decimal, precision: 14, scale: 2, null: false

      add :currency_code, :string, null: false

      # Human-readable rationale. REQUIRED for manual grants (4-eyes
      # discipline — admin must justify a "free money" event); also
      # set automatically for accruals ("Tier crossed: £100k YTD →
      # 2% rebate").
      add :reason, :string

      # Traceability: which program rule fired (for accruals), which
      # invoice's payment triggered it (for accruals), which invoice
      # got the credit (for applications). Nilable because manual
      # grants don't link to any of these.
      add :loyalty_program_id, references(:loyalty_programs, on_delete: :nilify_all)
      add :loyalty_program_tier_id, references(:loyalty_program_tiers, on_delete: :nilify_all)
      add :source_invoice_id, references(:customer_invoices, on_delete: :nilify_all)

      # For applied_to_invoice rows we also write a matching credit
      # note invoice in customer_invoices (same path as RMAs).
      # `credit_note_invoice_id` links the ledger row to that
      # invoice so A/R math stays consistent.
      add :credit_note_invoice_id, references(:customer_invoices, on_delete: :nilify_all)

      # nil = system (auto-accrual). Set for manual grants.
      add :granted_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:customer_credits, [:uuid])
    create index(:customer_credits, [:company_id])
    create index(:customer_credits, [:customer_id])
    create index(:customer_credits, [:loyalty_program_id])

    # Idempotency guard: at most one accrual row per (customer, invoice,
    # tier) so a re-firing of the payment hook can't double-grant. The
    # context fires this only on the status edge into `paid`, but a
    # belt-and-braces DB constraint costs nothing.
    create unique_index(
             :customer_credits,
             [:customer_id, :source_invoice_id, :loyalty_program_tier_id],
             where: "kind = 'rebate_accrual'",
             name: :customer_credits_accrual_unique
           )

    alter table(:customers) do
      add :loyalty_program_id, references(:loyalty_programs, on_delete: :nilify_all)
    end

    create index(:customers, [:loyalty_program_id])
  end
end
