defmodule Backend.Production.ManufacturingOrderStepWorker do
  @moduledoc """
  Join row between an MO step and a worker (user). Wholesale-replace
  pattern — the edit form sends the full set and the context wipes +
  reinserts inside one transaction.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Production.ManufacturingOrderStep

  schema "manufacturing_order_step_workers" do
    belongs_to :manufacturing_order_step, ManufacturingOrderStep
    belongs_to :user, User
    belongs_to :company, Company

    timestamps(type: :utc_datetime, updated_at: false)
  end

  def changeset(row, attrs) do
    row
    |> cast(attrs, [:manufacturing_order_step_id, :user_id, :company_id])
    |> validate_required([:manufacturing_order_step_id, :user_id, :company_id])
    |> assoc_constraint(:manufacturing_order_step)
    |> assoc_constraint(:user)
    |> assoc_constraint(:company)
    |> unique_constraint([:manufacturing_order_step_id, :user_id],
      name: :mo_step_workers_pair_index,
      message: "this worker is already assigned to the step"
    )
  end
end
