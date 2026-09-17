defmodule Backend.Production.RoutingHealEvent do
  @moduledoc """
  Audit row emitted every time the nightly `RoutingHealer` writes a
  new healed target onto a `RoutingStep`. Powers the "why did this
  target move?" drawer on the routing UI + a supervisor-facing
  timeline of drift.

  Immutable once written. `method` distinguishes the three normal
  outcomes plus the two skip paths:

    * `"regression"`         — ≥ 5 sessions with quantity variance,
                                fitted `duration = setup + cycle × qty`.
    * `"median"`             — ≥ 5 sessions but flat quantity, used
                                `cycle = median(duration / qty)` and
                                kept the authored setup.
    * `"insufficient_data"` — < 5 sessions in window; recorded so the
                                UI can say "waiting on more data".
    * `"locked"`             — planner set `manual_override_locked`;
                                target left alone but we still keep
                                a heartbeat so the drift banner
                                doesn't stale out.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.Production.RoutingStep

  schema "routing_heal_events" do
    field :from_setup_seconds, :decimal
    field :to_setup_seconds, :decimal
    field :from_cycle_seconds, :decimal
    field :to_cycle_seconds, :decimal

    field :sample_size, :integer, default: 0
    field :confidence, :decimal

    field :method, :string
    field :window_days, :integer, default: 30
    field :computed_at, :utc_datetime

    belongs_to :routing_step, RoutingStep
    belongs_to :company, Company

    timestamps(type: :utc_datetime, updated_at: false, inserted_at: false)
  end

  def changeset(event, attrs) do
    event
    |> cast(attrs, [
      :routing_step_id,
      :company_id,
      :from_setup_seconds,
      :to_setup_seconds,
      :from_cycle_seconds,
      :to_cycle_seconds,
      :sample_size,
      :confidence,
      :method,
      :window_days,
      :computed_at
    ])
    |> validate_required([:routing_step_id, :company_id, :method, :computed_at])
    |> validate_inclusion(:method, ~w(regression median insufficient_data locked))
    |> assoc_constraint(:routing_step)
    |> assoc_constraint(:company)
  end
end
