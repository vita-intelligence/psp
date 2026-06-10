defmodule Backend.Devices.PairingCode do
  @moduledoc """
  Short-lived pairing code — laptop creates it, phone consumes it once
  at `/pair?code=…` in exchange for a long-lived device token. Codes
  are single-use and expire after a few minutes to bound the drive-by
  window.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Devices.LinkedDevice

  schema "device_pairing_codes" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :code, :string
    field :expires_at, :utc_datetime
    field :used_at, :utc_datetime

    belongs_to :user, User
    belongs_to :company, Company
    belongs_to :used_by_device, LinkedDevice

    timestamps(type: :utc_datetime)
  end

  @doc false
  def create_changeset(pairing, attrs) do
    pairing
    |> cast(attrs, [:user_id, :company_id, :code, :expires_at])
    |> validate_required([:user_id, :company_id, :code, :expires_at])
    |> validate_length(:code, is: 6)
    |> unique_constraint(:code)
  end

  @doc false
  def consume_changeset(pairing, attrs) do
    pairing
    |> cast(attrs, [:used_at, :used_by_device_id])
    |> validate_required([:used_at, :used_by_device_id])
  end
end
