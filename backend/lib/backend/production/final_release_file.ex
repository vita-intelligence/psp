defmodule Backend.Production.FinalReleaseFile do
  @moduledoc """
  Attachment on a Final Product Release. `kind` is one of `coa` |
  `bmr` | `micro` | `label_retain`. Bytes live in `Backend.Storage`.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Production.FinalRelease

  @kinds ~w(coa bmr micro label_retain)
  def kinds, do: @kinds

  schema "production_final_release_files" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :kind, :string
    field :filename, :string
    field :mime, :string
    field :byte_size, :integer
    field :blob_path, :string

    belongs_to :company, Company
    belongs_to :production_final_release, FinalRelease
    belongs_to :uploaded_by, User, foreign_key: :uploaded_by_id

    timestamps(type: :utc_datetime)
  end

  def changeset(file, attrs) do
    file
    |> cast(attrs, [
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :company_id,
      :production_final_release_id,
      :uploaded_by_id
    ])
    |> validate_required([
      :kind,
      :filename,
      :mime,
      :byte_size,
      :blob_path,
      :company_id,
      :production_final_release_id
    ])
    |> validate_inclusion(:kind, @kinds)
  end
end
