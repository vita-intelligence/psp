defmodule Backend.Production.MOConsumerLink do
  @moduledoc """
  Secondary consumer link from a shared batch MO to another MO.

  The primary parent stays on `manufacturing_orders.parent_mo_id`;
  this table is purely additive for the "this batch also feeds X"
  case. See the create_mo_consumer_links migration for the workflow.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Production.ManufacturingOrder

  schema "mo_consumer_links" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :shared_qty, :decimal

    belongs_to :company, Company
    belongs_to :batch_mo, ManufacturingOrder
    belongs_to :consumer_mo, ManufacturingOrder
    belongs_to :created_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(link, attrs) do
    link
    |> cast(attrs, [
      :company_id,
      :batch_mo_id,
      :consumer_mo_id,
      :shared_qty,
      :created_by_id
    ])
    |> validate_required([:company_id, :batch_mo_id, :consumer_mo_id, :shared_qty])
    |> validate_number(:shared_qty, greater_than: 0)
    |> validate_self_link()
    |> assoc_constraint(:company)
    |> assoc_constraint(:batch_mo)
    |> assoc_constraint(:consumer_mo)
    |> unique_constraint([:batch_mo_id, :consumer_mo_id],
      name: :mo_consumer_links_unique_pair,
      message: "this consumer is already linked to the batch"
    )
    |> check_constraint(:shared_qty,
      name: :mo_consumer_links_qty_positive,
      message: "must be greater than zero"
    )
    |> check_constraint(:batch_mo_id,
      name: :mo_consumer_links_no_self_link,
      message: "a batch can't consume itself"
    )
  end

  defp validate_self_link(cs) do
    case {get_field(cs, :batch_mo_id), get_field(cs, :consumer_mo_id)} do
      {x, x} when not is_nil(x) ->
        add_error(cs, :consumer_mo_id, "a batch can't consume itself")

      _ ->
        cs
    end
  end
end
