defmodule Backend.Certificates.ItemCertificate do
  @moduledoc """
  Per-item certificate attachment. Carries serial + validity window +
  the document URL. `valid_until` is indexed for the expiring-soon
  queue.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Certificates.Certificate
  alias Backend.Items.Item

  schema "item_certificates" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :certificate_number, :string
    field :valid_from, :date
    field :valid_until, :date
    field :document_url, :string
    field :notes, :string
    field :uploaded_at, :utc_datetime

    belongs_to :item, Item
    belongs_to :certificate, Certificate
    belongs_to :uploaded_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(att, attrs) do
    att
    |> cast(attrs, [
      :item_id,
      :certificate_id,
      :certificate_number,
      :valid_from,
      :valid_until,
      :document_url,
      :notes,
      :uploaded_by_id,
      :uploaded_at
    ])
    |> validate_required([:item_id, :certificate_id, :uploaded_at])
    |> validate_length(:certificate_number, max: 120)
    |> validate_dates()
  end

  defp validate_dates(changeset) do
    from = get_field(changeset, :valid_from)
    until = get_field(changeset, :valid_until)

    cond do
      is_nil(from) or is_nil(until) -> changeset
      Date.compare(from, until) == :gt ->
        add_error(changeset, :valid_until, "must be on or after `valid_from`")

      true ->
        changeset
    end
  end
end
