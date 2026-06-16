defmodule Backend.Production.RoutingStepWorker do
  @moduledoc """
  Join row between a routing step and a default worker (user). The
  schedule pre-fills MOs running this step with the assigned users.

  Set semantics — at most one row per (step, user). Wholesale
  replace on save: the context layer wipes + reinserts within the
  parent transaction.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Production.RoutingStep

  schema "routing_step_workers" do
    belongs_to :routing_step, RoutingStep
    belongs_to :user, User
    belongs_to :company, Company

    timestamps(type: :utc_datetime, updated_at: false)
  end

  def changeset(row, attrs) do
    row
    |> cast(attrs, [:routing_step_id, :user_id, :company_id])
    |> validate_required([:routing_step_id, :user_id, :company_id])
    |> assoc_constraint(:routing_step)
    |> assoc_constraint(:user)
    |> assoc_constraint(:company)
    |> unique_constraint([:routing_step_id, :user_id],
      name: :routing_step_workers_pair_index,
      message: "this worker is already assigned to the step"
    )
  end
end
