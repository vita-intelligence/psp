defmodule Backend.Repo.Migrations.AddCoRoutingRequestsAndThreePlEstimateDays do
  @moduledoc """
  Customer-driven 3PL vs direct-shipment routing for custom-formulation
  Customer Orders.

  Today the operator picks the routing per released lot on PSP.
  Bespoke NPD-developed COs now defer that decision to the customer
  via the portal — the customer picks 3PL storage or direct shipment,
  and if 3PL the request enters a team-review state where PSP
  confirms capacity + accepts / declines with a reason.

  Two parts:

    1. New ``co_routing_requests`` table — one row per CO, tracks
       ``customer_choice`` + ``state`` + the frozen ``estimate_snapshot``
       (m³ + price + capacity) at customer-decision time so a later
       rate change doesn't retroactively mutate what the customer
       agreed to.
    2. New ``companies.default_three_pl_estimate_days`` (default 30)
       — the illustration period the customer portal uses to render
       "£X for Y days" so the number scales visibly. Ops tunes it
       from ``/settings/company`` without a deploy.
  """

  use Ecto.Migration

  def change do
    alter table(:companies) do
      add :default_three_pl_estimate_days, :integer, null: false, default: 30
    end

    create constraint(:companies, :companies_three_pl_estimate_days_positive,
             check: "default_three_pl_estimate_days > 0"
           )

    create table(:co_routing_requests) do
      add :uuid, :uuid, null: false

      add :company_id,
          references(:companies, on_delete: :restrict),
          null: false

      add :customer_order_id,
          references(:customer_orders, on_delete: :delete_all),
          null: false

      # State machine:
      #
      #   * ``awaiting_customer``       — request created, portal
      #     shows the two option cards.
      #   * ``awaiting_team_review``    — customer picked 3PL; PSP
      #     team sees the request with computed capacity + estimated
      #     price and must Approve / Decline.
      #   * ``applied_three_pl``        — team approved; every CO
      #     output lot got a ``routed_to_3pl`` lifecycle event.
      #     Terminal.
      #   * ``applied_shipment``        — customer picked shipment
      #     directly, OR team declined 3PL and customer subsequently
      #     picked shipment. Every CO lot got ``routed_to_shipment``.
      #     Terminal.
      #
      # Decline bounces the state back to ``awaiting_customer`` (with
      # ``team_decision_reason`` set) — the customer re-decides.
      add :state, :string, null: false, default: "awaiting_customer"

      # Customer's latest submitted choice. Cleared to null when
      # the team declines a 3PL request (state → awaiting_customer)
      # so the portal shows the picker again with a fresh slate.
      add :customer_choice, :string, null: true

      # Frozen snapshot of the price + capacity figures the customer
      # saw at submit time. The number they agreed to is authoritative
      # for billing — a later rate hike or capacity change doesn't
      # retroactively mutate what they signed off on.
      #
      # Shape:
      #   {
      #     "required_m3": "2.4000",
      #     "free_m3": "18.6000",
      #     "capacity_ok": true,
      #     "rate_per_m3_per_day": "3.50",
      #     "estimated_days": 30,
      #     "estimated_daily_charge": "8.40",
      #     "estimated_period_charge": "252.00",
      #     "currency_code": "GBP"
      #   }
      add :estimate_snapshot, :jsonb, null: true

      # Team decline reason. Required when transitioning to
      # ``awaiting_customer`` from ``awaiting_team_review`` (state
      # machine won't accept the write without it). Mirrored to the
      # portal so the customer sees WHY 3PL wasn't available.
      add :team_decision_reason, :text, null: true

      add :customer_chose_at, :utc_datetime, null: true
      add :team_reviewed_at, :utc_datetime, null: true

      add :team_reviewed_by_id,
          references(:users, on_delete: :nilify_all),
          null: true

      add :created_by_id,
          references(:users, on_delete: :nilify_all),
          null: true

      add :updated_by_id,
          references(:users, on_delete: :nilify_all),
          null: true

      timestamps(type: :utc_datetime)
    end

    create unique_index(:co_routing_requests, [:uuid])
    # One request per CO — recreating the choice is a state
    # reset on the existing row, not a fresh row.
    create unique_index(:co_routing_requests, [:customer_order_id])
    create index(:co_routing_requests, [:state])

    create constraint(:co_routing_requests, :co_routing_requests_state_known,
             check:
               "state IN ('awaiting_customer', 'awaiting_team_review', 'applied_three_pl', 'applied_shipment')"
           )

    create constraint(:co_routing_requests, :co_routing_requests_choice_known,
             check:
               "customer_choice IS NULL OR customer_choice IN ('three_pl', 'shipment')"
           )
  end
end
