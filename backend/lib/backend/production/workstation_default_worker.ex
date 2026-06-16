defmodule Backend.Production.WorkstationDefaultWorker do
  @moduledoc """
  Join row between a workstation and a default user (operator). The
  schedule pre-fills MOs running at this workstation with the
  assigned users — they remain editable per MO.

  Set semantics: at most one row per (workstation, user). The schema
  carries no extra fields beyond the FKs + denormalised
  `company_id` for audit-log filtering. Updates are wholesale
  replace: the context layer wipes the set + inserts the new one
  inside a transaction.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Production.Workstation

  schema "workstation_default_workers" do
    belongs_to :workstation, Workstation
    belongs_to :user, User
    belongs_to :company, Company

    timestamps(type: :utc_datetime, updated_at: false)
  end

  def changeset(row, attrs) do
    row
    |> cast(attrs, [:workstation_id, :user_id, :company_id])
    |> validate_required([:workstation_id, :user_id, :company_id])
    |> assoc_constraint(:workstation)
    |> assoc_constraint(:user)
    |> assoc_constraint(:company)
    |> unique_constraint([:workstation_id, :user_id],
      name: :workstation_default_workers_pair_index,
      message: "this worker is already assigned to the workstation"
    )
  end
end
