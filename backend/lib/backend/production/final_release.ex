defmodule Backend.Production.FinalRelease do
  @moduledoc """
  Final Product Release row — one per (parent MO, output lot). See
  `Backend.Production.FinalReleases` for the state-machine + sign-off
  ceremony. BRCGS Issue 9 § 5.6 Positive Release.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Production.ManufacturingOrder
  alias Backend.Stock.Lot

  @statuses ~w(pending released on_hold rejected)
  def statuses, do: @statuses

  schema "production_final_releases" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :status, :string, default: "pending"

    field :notes, :string
    field :hold_reason, :string
    field :reject_reason, :string

    field :releaser_signature_image, :string
    field :releaser_signed_at, :utc_datetime

    field :approver_signature_image, :string
    field :approver_signed_at, :utc_datetime

    field :finalized_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :manufacturing_order, ManufacturingOrder
    belongs_to :stock_lot, Lot
    belongs_to :releaser, User, foreign_key: :releaser_id
    belongs_to :approver, User, foreign_key: :approver_id
    belongs_to :finalized_by, User, foreign_key: :finalized_by_id
    belongs_to :created_by, User, foreign_key: :created_by_id
    belongs_to :updated_by, User, foreign_key: :updated_by_id

    has_many :files, Backend.Production.FinalReleaseFile,
      foreign_key: :production_final_release_id

    timestamps(type: :utc_datetime)
  end

  def changeset(release, attrs) do
    release
    |> cast(attrs, [
      :status,
      :notes,
      :hold_reason,
      :reject_reason,
      :releaser_signature_image,
      :releaser_signed_at,
      :approver_signature_image,
      :approver_signed_at,
      :finalized_at,
      :company_id,
      :manufacturing_order_id,
      :stock_lot_id,
      :releaser_id,
      :approver_id,
      :finalized_by_id,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :manufacturing_order_id, :stock_lot_id, :status])
    |> validate_inclusion(:status, @statuses)
  end
end
