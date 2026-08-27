defmodule Backend.ThreePL.RoutingRequest do
  @moduledoc """
  Customer-driven routing decision for a bespoke NPD-formulation CO.
  Replaces the operator per-lot picker at ``awaiting_routing`` when
  the CO carries an ``npd_formulation_uuid`` — the customer picks
  3PL storage or direct shipment on the portal instead.

  State machine (see migration for the constraint):

      awaiting_customer
        ├─ customer picks "shipment" ─→ applied_shipment  (terminal)
        └─ customer picks "three_pl"  ─→ awaiting_team_review
                                          ├─ team approve ─→ applied_three_pl  (terminal)
                                          └─ team decline ─→ awaiting_customer (reason set, choice cleared)

  Every transition writes an event on ``customer_order`` audit trail
  via the context module. ``estimate_snapshot`` is frozen at customer
  submit — the number they signed off on is what bills them, even if
  ``company.three_pl_rate_per_m3_per_day`` moves later.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.CustomerOrders.CustomerOrder

  @states ~w(awaiting_customer awaiting_team_review applied_three_pl applied_shipment)
  @choices ~w(three_pl shipment)

  def states, do: @states
  def choices, do: @choices

  schema "co_routing_requests" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :state, :string, default: "awaiting_customer"
    field :customer_choice, :string
    field :estimate_snapshot, :map
    field :team_decision_reason, :string
    field :customer_chose_at, :utc_datetime
    field :team_reviewed_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :customer_order, CustomerOrder
    belongs_to :team_reviewed_by, User
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  @doc """
  Fresh-request changeset — used the first time the wizard hook
  fires on a custom CO entering ``:awaiting_routing``.
  """
  def create_changeset(request, attrs) do
    request
    |> cast(attrs, [
      :company_id,
      :customer_order_id,
      :created_by_id,
      :updated_by_id
    ])
    |> put_change(:state, "awaiting_customer")
    |> validate_required([:company_id, :customer_order_id])
    |> unique_constraint(:customer_order_id)
    |> assoc_constraint(:company)
    |> assoc_constraint(:customer_order)
  end

  @doc """
  Customer submitted a choice via the portal. Enforces the
  ``awaiting_customer`` precondition + fires with the frozen
  estimate snapshot (never the live one — the customer sees a
  number, and that number is what we honour).
  """
  def customer_choice_changeset(request, attrs) do
    request
    |> cast(attrs, [
      :customer_choice,
      :estimate_snapshot,
      :customer_chose_at,
      :state,
      :updated_by_id
    ])
    |> validate_required([:customer_choice, :customer_chose_at, :state])
    |> validate_inclusion(:customer_choice, @choices)
    |> validate_inclusion(:state, ["applied_shipment", "awaiting_team_review"])
    |> validate_snapshot_shape()
  end

  @doc """
  Team approved a 3PL request — flips to ``applied_three_pl``.
  Requires ``team_reviewed_at`` + ``team_reviewed_by_id`` so the
  audit answers "who signed 3PL off?".
  """
  def team_approve_changeset(request, attrs) do
    request
    |> cast(attrs, [
      :state,
      :team_reviewed_at,
      :team_reviewed_by_id,
      :updated_by_id
    ])
    |> validate_required([:state, :team_reviewed_at, :team_reviewed_by_id])
    |> validate_inclusion(:state, ["applied_three_pl"])
  end

  @doc """
  Team declined a 3PL request. Bounces the state back to
  ``awaiting_customer`` (so the portal shows the choice again),
  clears ``customer_choice``, and requires a reason mirrored to
  the customer.
  """
  def team_decline_changeset(request, attrs) do
    request
    |> cast(attrs, [
      :state,
      :team_reviewed_at,
      :team_reviewed_by_id,
      :team_decision_reason,
      :updated_by_id
    ])
    |> put_change(:customer_choice, nil)
    |> validate_required([
      :state,
      :team_reviewed_at,
      :team_reviewed_by_id,
      :team_decision_reason
    ])
    |> validate_inclusion(:state, ["awaiting_customer"])
    |> validate_length(:team_decision_reason, min: 3, max: 4_000)
  end

  # ``estimate_snapshot`` is opaque JSON to the DB but the wizard
  # + portal FE rely on a stable shape — enforce the required keys
  # so a bad relay payload fails fast instead of surfacing "N/A"
  # on the portal card.
  @required_snapshot_keys ~w(required_m3 free_m3 capacity_ok rate_per_m3_per_day
                              estimated_days estimated_daily_charge
                              estimated_period_charge currency_code)

  defp validate_snapshot_shape(cs) do
    case get_field(cs, :estimate_snapshot) do
      nil ->
        add_error(cs, :estimate_snapshot, "is required at customer decision time")

      snap when is_map(snap) ->
        missing = @required_snapshot_keys -- Enum.map(Map.keys(snap), &to_string/1)

        if missing == [] do
          cs
        else
          add_error(
            cs,
            :estimate_snapshot,
            "missing keys: #{Enum.join(missing, ", ")}"
          )
        end

      _ ->
        add_error(cs, :estimate_snapshot, "must be a JSON object")
    end
  end
end
