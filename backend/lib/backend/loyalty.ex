defmodule Backend.Loyalty do
  @moduledoc """
  Boundary for the customer loyalty surface.

  Two things live here:

    1. **Loyalty programs** — named schemes with tiered cashback
       rates. CRUD with the usual audit + actor stamping. Only one
       program per company can be `is_default = true` at a time;
       toggling it transactionally clears the previous default.

    2. **Customer credits** — append-only signed-amount ledger
       (`kind ∈ {rebate_accrual, manual_grant, applied_to_invoice}`).
       Balance is computed by `sum(amount)` at read time; never
       persisted on the customer row.

  Auto-accrual fires from `accrue_on_invoice_paid/2` — called by the
  customer-invoices payment hook when a status edge into `paid` lands.
  The grant amount is `rate_pct%` of the invoice's `grand_total` at
  the highest qualifying tier (a "graduating rate" model). A unique
  index on `(customer_id, source_invoice_id, loyalty_program_tier_id)`
  makes the operation idempotent at the DB level so a re-firing
  hook never double-grants.

  Redemption (`apply_to_invoice/4`) does two things in one
  transaction:
    * writes a NEGATIVE `applied_to_invoice` ledger row
    * issues a sent credit-note invoice (mirroring the RMA path) so
      the FE's A/R + Cash Flow math stays consistent.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.CustomerInvoices.CustomerInvoice
  alias Backend.Customers.Customer
  alias Backend.Loyalty.{CustomerCredit, LoyaltyProgram, LoyaltyProgramTier}
  alias Backend.Repo

  # ----- programs -------------------------------------------------

  @doc "List all programs for the company, newest first."
  def list_programs(company_id) when is_integer(company_id) do
    from(p in LoyaltyProgram,
      where: p.company_id == ^company_id,
      order_by: [desc: p.is_default, desc: p.is_active, asc: p.name],
      preload: [tiers: ^tier_order()]
    )
    |> Repo.all()
  end

  defp tier_order do
    from(t in LoyaltyProgramTier, order_by: [asc: t.min_threshold])
  end

  @doc "Lookup by uuid + company scope. Returns nil for cross-tenant."
  def get_program(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        from(p in LoyaltyProgram,
          where: p.company_id == ^company_id and p.uuid == ^cast,
          preload: [tiers: ^tier_order()]
        )
        |> Repo.one()

      :error ->
        nil
    end
  end

  def get_program(_, _), do: nil

  def create_program(%User{} = actor, company_id, attrs) when is_integer(company_id) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id,
        "activated_at" => now()
      })

    Repo.transaction(fn ->
      with {:ok, program} <-
             %LoyaltyProgram{}
             |> LoyaltyProgram.changeset(attrs)
             |> Repo.insert(),
           {:ok, _} <- maybe_clear_other_defaults(program, attrs) do
        Audit.record_created(actor, "loyalty_program", program, program_snapshot(program))
        preload_program(program)
      else
        {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
      end
    end)
    |> tap(fn
      {:ok, %LoyaltyProgram{} = p} ->
        Backend.Broadcasts.entity_changed("loyalty-program", p.uuid, p.company_id, "created")

      _ ->
        :ok
    end)
  end

  def update_program(%User{} = actor, %LoyaltyProgram{} = program, attrs) do
    before_state = program_snapshot(program)

    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("updated_by_id", actor.id)

    program
    |> LoyaltyProgram.changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(actor, "loyalty_program", updated, before_state, program_snapshot(updated))
        Backend.Broadcasts.entity_changed("loyalty-program", updated.uuid, updated.company_id, "updated")
        {:ok, preload_program(updated)}

      other ->
        other
    end
  end

  def delete_program(%User{} = actor, %LoyaltyProgram{} = program) do
    # Refuse if customers reference it — admins must reassign first,
    # otherwise existing credits orphan their program context.
    in_use =
      Repo.aggregate(
        from(c in Customer, where: c.loyalty_program_id == ^program.id),
        :count,
        :id
      )

    cond do
      in_use > 0 ->
        {:error, {:in_use, in_use}}

      true ->
        before = program_snapshot(program)

        case Repo.delete(program) do
          {:ok, deleted} ->
            Audit.record_deleted(actor, "loyalty_program", deleted, before)
            Backend.Broadcasts.entity_changed("loyalty-program", program.uuid, program.company_id, "deleted")
            {:ok, deleted}

          other ->
            other
        end
    end
  end

  @doc """
  Flip is_active. Deactivating requires a reason and stamps
  deactivated_at. Existing credits stay — only new accrual is
  blocked.
  """
  def set_active(%User{} = actor, %LoyaltyProgram{} = program, is_active, reason \\ nil) do
    attrs =
      cond do
        is_active ->
          %{
            "is_active" => true,
            "activated_at" => now(),
            "deactivated_at" => nil,
            "deactivation_reason" => nil,
            "updated_by_id" => actor.id
          }

        true ->
          %{
            "is_active" => false,
            "deactivated_at" => now(),
            "deactivation_reason" => reason || "",
            "updated_by_id" => actor.id
          }
      end

    before_state = program_snapshot(program)

    program
    |> LoyaltyProgram.lifecycle_changeset(attrs)
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "loyalty_program",
          updated,
          before_state,
          program_snapshot(updated)
        )

        action = if is_active, do: "activated", else: "deactivated"
        Backend.Broadcasts.entity_changed("loyalty-program", updated.uuid, updated.company_id, action)
        {:ok, preload_program(updated)}

      other ->
        other
    end
  end

  @doc """
  Pin this program as the company's default. Atomically clears
  is_default on every other row.
  """
  def set_default(%User{} = actor, %LoyaltyProgram{} = program) do
    before_state = program_snapshot(program)

    Repo.transaction(fn ->
      Repo.update_all(
        from(p in LoyaltyProgram,
          where: p.company_id == ^program.company_id and p.id != ^program.id
        ),
        set: [is_default: false]
      )

      case program
           |> LoyaltyProgram.default_changeset(%{
             "is_default" => true,
             "updated_by_id" => actor.id
           })
           |> Repo.update() do
        {:ok, updated} ->
          Audit.record_updated(
            actor,
            "loyalty_program",
            updated,
            before_state,
            program_snapshot(updated)
          )

          preload_program(updated)

        {:error, cs} ->
          Repo.rollback(cs)
      end
    end)
    |> tap(fn
      {:ok, %LoyaltyProgram{} = p} ->
        Backend.Broadcasts.entity_changed("loyalty-program", p.uuid, p.company_id, "default_set")

      _ ->
        :ok
    end)
  end

  defp maybe_clear_other_defaults(%LoyaltyProgram{is_default: true} = program, _attrs) do
    Repo.update_all(
      from(p in LoyaltyProgram,
        where: p.company_id == ^program.company_id and p.id != ^program.id
      ),
      set: [is_default: false]
    )

    {:ok, :cleared}
  end

  defp maybe_clear_other_defaults(_, _), do: {:ok, :noop}

  # ----- tiers ----------------------------------------------------

  def add_tier(%User{} = actor, %LoyaltyProgram{} = program, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("loyalty_program_id", program.id)

    %LoyaltyProgramTier{}
    |> LoyaltyProgramTier.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, tier} ->
        Audit.record_created(actor, "loyalty_program_tier", tier, tier_snapshot(tier))
        Backend.Broadcasts.entity_changed("loyalty-program", program.uuid, program.company_id, "tier_added")
        {:ok, tier}

      other ->
        other
    end
  end

  def update_tier(%User{} = actor, %LoyaltyProgramTier{} = tier, attrs) do
    before_state = tier_snapshot(tier)

    tier
    |> LoyaltyProgramTier.changeset(stringify_keys(attrs))
    |> Repo.update()
    |> case do
      {:ok, updated} ->
        Audit.record_updated(
          actor,
          "loyalty_program_tier",
          updated,
          before_state,
          tier_snapshot(updated)
        )

        broadcast_program_by_id(updated.loyalty_program_id, "tier_updated")
        {:ok, updated}

      other ->
        other
    end
  end

  def delete_tier(%User{} = actor, %LoyaltyProgramTier{} = tier) do
    before_state = tier_snapshot(tier)

    case Repo.delete(tier) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "loyalty_program_tier", deleted, before_state)
        broadcast_program_by_id(tier.loyalty_program_id, "tier_deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  defp broadcast_program_by_id(program_id, action) when is_integer(program_id) do
    case Repo.get(LoyaltyProgram, program_id) do
      %LoyaltyProgram{uuid: uuid, company_id: cid} ->
        Backend.Broadcasts.entity_changed("loyalty-program", uuid, cid, action)

      _ ->
        :ok
    end
  end

  defp broadcast_program_by_id(_, _), do: :ok

  def get_tier(program_id, uuid) when is_integer(program_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(t in LoyaltyProgramTier,
            where: t.loyalty_program_id == ^program_id and t.uuid == ^cast
          )
        )

      :error ->
        nil
    end
  end

  # ----- credits --------------------------------------------------

  @doc """
  Manual grant. The admin sticks money in the customer's wallet with
  a reason; the audit log captures who + why. Always positive.
  """
  def grant_credit(%User{} = actor, %Customer{} = customer, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => customer.company_id,
        "customer_id" => customer.id,
        "kind" => "manual_grant",
        "currency_code" => attrs["currency_code"] || customer.currency_code,
        "granted_by_id" => actor.id,
        "loyalty_program_id" => customer.loyalty_program_id
      })

    %CustomerCredit{}
    |> CustomerCredit.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, credit} ->
        credit = Repo.preload(credit, [:granted_by, :loyalty_program])
        Audit.record_created(actor, "customer_credit", credit, credit_snapshot(credit))
        {:ok, credit}

      other ->
        other
    end
  end

  @doc """
  Auto-accrual hook. Called by `CustomerInvoices.record_payment/3`
  whenever a payment crosses the invoice into `paid`. No-op when:
    * the customer has no loyalty program
    * the program is inactive
    * no tier qualifies given the customer's new YTD revenue
    * we've already accrued for this (customer, invoice, tier) — the
      DB unique index makes this safe even under a duplicate call.
  """
  def accrue_on_invoice_paid(%CustomerInvoice{} = invoice, %User{} = actor) do
    invoice = Repo.preload(invoice, customer: [loyalty_program: [tiers: tier_order()]])
    customer = invoice.customer

    cond do
      is_nil(customer.loyalty_program_id) ->
        {:ok, :no_program}

      not (customer.loyalty_program && customer.loyalty_program.is_active) ->
        {:ok, :program_inactive}

      true ->
        ytd_paid = compute_ytd_paid_revenue(customer.id, invoice.invoice_date || Date.utc_today())

        case best_qualifying_tier(customer.loyalty_program.tiers, ytd_paid) do
          nil ->
            {:ok, :no_tier_crossed}

          tier ->
            credit_amount =
              invoice.grand_total
              |> Decimal.mult(tier.rate_pct)
              |> Decimal.div(Decimal.new(100))
              |> Decimal.round(2)

            attrs = %{
              "company_id" => invoice.company_id,
              "customer_id" => customer.id,
              "kind" => "rebate_accrual",
              "amount" => credit_amount,
              "currency_code" => invoice.currency_code,
              "reason" =>
                "Tier #{tier.rate_pct}% rebate on invoice ##{invoice.id} (YTD #{ytd_paid})",
              "loyalty_program_id" => customer.loyalty_program_id,
              "loyalty_program_tier_id" => tier.id,
              "source_invoice_id" => invoice.id
            }

            # Pre-check the partial unique index (where kind =
            # 'rebate_accrual') with an explicit query — simpler than
            # threading the WHERE predicate through Ecto's on_conflict
            # API for a partial index, and still safe because the DB
            # constraint is the ultimate backstop on concurrent calls.
            already_accrued? =
              Repo.exists?(
                from cc in CustomerCredit,
                  where:
                    cc.customer_id == ^customer.id and
                      cc.source_invoice_id == ^invoice.id and
                      cc.loyalty_program_tier_id == ^tier.id and
                      cc.kind == "rebate_accrual"
              )

            if already_accrued? do
              {:ok, :already_accrued}
            else
              %CustomerCredit{}
              |> CustomerCredit.changeset(attrs)
              |> Repo.insert()
              |> case do
                {:ok, credit} ->
                  Audit.record_created(actor, "customer_credit", credit, credit_snapshot(credit))
                  {:ok, credit}

                other ->
                  other
              end
            end
        end
    end
  end

  defp best_qualifying_tier([], _ytd), do: nil

  defp best_qualifying_tier(tiers, ytd) do
    tiers
    |> Enum.filter(fn t ->
      Decimal.compare(ytd, t.min_threshold) != :lt
    end)
    |> case do
      [] -> nil
      qualifying -> Enum.max_by(qualifying, & &1.min_threshold, fn -> nil end)
    end
  end

  defp compute_ytd_paid_revenue(customer_id, %Date{} = ref_date) do
    year_start = Date.new!(ref_date.year, 1, 1)

    # Sum (invoice.grand_total - paid_amount = paid_so_far isn't useful);
    # we want REVENUE that has been booked + collected within this year.
    # Simplest accounting definition: grand_total of invoices whose
    # status is one of [sent, partially_paid, paid] AND whose
    # invoice_date is within this year. We track outstanding separately.
    Repo.one(
      from(i in CustomerInvoice,
        where: i.customer_id == ^customer_id,
        where: i.status in ["sent", "partially_paid", "paid"],
        where: i.invoice_date >= ^year_start,
        select: coalesce(sum(i.grand_total), 0)
      )
    ) || Decimal.new(0)
  end

  @doc """
  Apply a credit to a future invoice — the redemption flow. Atomic:
    1. Issues a sent `credit_note` invoice that subtracts the chosen
       amount from the customer's A/R (mirrors the RMA path so the
       FE's Cash Flow + Statistics surfaces stay consistent).
    2. Writes a NEGATIVE ledger row of kind `applied_to_invoice`
       linked to that credit note + the source invoice being credited.

  `amount` must be positive (the caller's intent is "spend X of my
  balance"); the ledger row stores the negation.
  """
  def apply_to_invoice(%User{} = actor, %Customer{} = customer, %CustomerInvoice{} = source_invoice, amount) do
    amount = ensure_decimal(amount)

    cond do
      Decimal.compare(amount, Decimal.new(0)) != :gt ->
        {:error, :nonpositive_amount}

      Decimal.compare(amount, balance_for(customer.id, customer.currency_code)) == :gt ->
        {:error, :insufficient_balance}

      true ->
        Repo.transaction(fn ->
          with {:ok, credit_note} <-
                 issue_redemption_credit_note(actor, customer, source_invoice, amount),
               {:ok, ledger_row} <-
                 insert_ledger_row(
                   actor,
                   customer,
                   amount,
                   source_invoice,
                   credit_note
                 ) do
            %{credit: ledger_row, credit_note: credit_note}
          else
            {:error, cs} -> Repo.rollback(cs)
          end
        end)
    end
  end

  defp issue_redemption_credit_note(actor, customer, source_invoice, amount) do
    attrs = %{
      "company_id" => customer.company_id,
      "customer_id" => customer.id,
      "kind" => "credit_note",
      "currency_code" => source_invoice.currency_code,
      "tax_rate" => Decimal.new(0),
      "billing_address" => source_invoice.billing_address || customer.legal_address,
      "free_text" =>
        "Loyalty credit redemption against invoice ##{source_invoice.id}.",
      "created_by_id" => actor.id,
      "updated_by_id" => actor.id,
      "linked_invoice_id" => source_invoice.id,
      # No qty/line — we set grand_total directly because there's no
      # underlying goods line for a loyalty redemption.
      "subtotal" => Decimal.negate(amount),
      "grand_total" => Decimal.negate(amount),
      "status" => "sent",
      "sent_at" => DateTime.utc_now() |> DateTime.truncate(:second),
      "sent_by_id" => actor.id
    }

    %CustomerInvoice{}
    |> CustomerInvoice.changeset(attrs)
    |> Repo.insert()
  end

  defp insert_ledger_row(actor, customer, amount, source_invoice, credit_note) do
    attrs = %{
      "company_id" => customer.company_id,
      "customer_id" => customer.id,
      "kind" => "applied_to_invoice",
      "amount" => Decimal.negate(amount),
      "currency_code" => source_invoice.currency_code,
      "reason" => "Redeemed against invoice ##{source_invoice.id}",
      "loyalty_program_id" => customer.loyalty_program_id,
      "source_invoice_id" => source_invoice.id,
      "credit_note_invoice_id" => credit_note.id,
      "granted_by_id" => actor.id
    }

    %CustomerCredit{}
    |> CustomerCredit.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, row} ->
        row = Repo.preload(row, [:granted_by, :loyalty_program, :credit_note_invoice])
        Audit.record_created(actor, "customer_credit", row, credit_snapshot(row))
        {:ok, row}

      other ->
        other
    end
  end

  # ----- balance + ledger projections -----------------------------

  @doc """
  Balance for a customer — sum of all ledger rows, optionally
  filtered to a single currency. Returns `Decimal.new(0)` when
  empty.
  """
  def balance_for(customer_id, currency_code \\ nil)
      when is_integer(customer_id) do
    query =
      from(c in CustomerCredit,
        where: c.customer_id == ^customer_id,
        select: coalesce(sum(c.amount), 0)
      )

    query =
      if currency_code,
        do: where(query, [c], c.currency_code == ^currency_code),
        else: query

    Repo.one(query) || Decimal.new(0)
  end

  @doc """
  Per-customer summary across all customers in the company. Useful
  for the dashboard leaderboard. Returns
    `[%{customer_id, balance, currency_code, total_earned, total_applied}]`
  filtered to customers with at least one ledger row.
  """
  def per_customer_summary(company_id) when is_integer(company_id) do
    from(c in CustomerCredit,
      where: c.company_id == ^company_id,
      group_by: [c.customer_id, c.currency_code],
      select: %{
        customer_id: c.customer_id,
        currency_code: c.currency_code,
        balance: coalesce(sum(c.amount), 0),
        total_earned:
          coalesce(
            sum(fragment("CASE WHEN ? > 0 THEN ? ELSE 0 END", c.amount, c.amount)),
            0
          ),
        total_applied:
          coalesce(
            sum(fragment("CASE WHEN ? < 0 THEN ? ELSE 0 END", c.amount, c.amount)),
            0
          )
      }
    )
    |> Repo.all()
  end

  @doc """
  Recent ledger rows across the company — bounded for the dashboard
  feed. `opts[:limit]` defaults to 50.
  """
  def recent_ledger(company_id, opts \\ []) when is_integer(company_id) do
    limit = Keyword.get(opts, :limit, 50)

    from(c in CustomerCredit,
      where: c.company_id == ^company_id,
      order_by: [desc: c.inserted_at, desc: c.id],
      limit: ^limit,
      preload: [
        :customer,
        :granted_by,
        :loyalty_program,
        :loyalty_program_tier,
        :source_invoice,
        :credit_note_invoice
      ]
    )
    |> Repo.all()
  end

  @doc """
  Per-customer ledger for the customer-detail card. Paginated by a
  simple `limit` (default 50).
  """
  def ledger_for_customer(customer_id, opts \\ []) when is_integer(customer_id) do
    limit = Keyword.get(opts, :limit, 50)

    from(c in CustomerCredit,
      where: c.customer_id == ^customer_id,
      order_by: [desc: c.inserted_at, desc: c.id],
      limit: ^limit,
      preload: [
        :granted_by,
        :loyalty_program,
        :loyalty_program_tier,
        :source_invoice,
        :credit_note_invoice
      ]
    )
    |> Repo.all()
  end

  @doc """
  Get a single credit by uuid scoped to a company. Returns nil for
  cross-tenant lookups.
  """
  def get_credit(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        from(c in CustomerCredit,
          where: c.company_id == ^company_id and c.uuid == ^cast,
          preload: [
            :customer,
            :granted_by,
            :loyalty_program,
            :loyalty_program_tier,
            :source_invoice,
            :credit_note_invoice
          ]
        )
        |> Repo.one()

      :error ->
        nil
    end
  end

  def get_credit(_, _), do: nil

  # ----- internals ------------------------------------------------

  defp preload_program(%LoyaltyProgram{} = program) do
    Repo.preload(program, [:created_by, :updated_by, tiers: tier_order()])
  end

  defp program_snapshot(%LoyaltyProgram{} = p) do
    %{
      name: p.name,
      scheme: p.scheme,
      basis: p.basis,
      payout_kind: p.payout_kind,
      is_active: p.is_active,
      is_default: p.is_default,
      deactivation_reason: p.deactivation_reason
    }
  end

  defp tier_snapshot(%LoyaltyProgramTier{} = t) do
    %{
      loyalty_program_id: t.loyalty_program_id,
      rank: t.rank,
      min_threshold: t.min_threshold,
      rate_pct: t.rate_pct,
      label: t.label
    }
  end

  defp credit_snapshot(%CustomerCredit{} = c) do
    %{
      customer_id: c.customer_id,
      kind: c.kind,
      amount: c.amount,
      currency_code: c.currency_code,
      reason: c.reason,
      loyalty_program_id: c.loyalty_program_id,
      source_invoice_id: c.source_invoice_id
    }
  end

  defp now, do: DateTime.utc_now() |> DateTime.truncate(:second)

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end

  defp stringify_keys(other), do: other

  defp ensure_decimal(%Decimal{} = d), do: d
  defp ensure_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp ensure_decimal(n) when is_float(n), do: Decimal.from_float(n)
  defp ensure_decimal(n) when is_binary(n), do: Decimal.new(n)
  defp ensure_decimal(_), do: Decimal.new(0)
end
