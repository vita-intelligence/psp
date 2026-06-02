defmodule Backend.RBAC.Role do
  @moduledoc """
  A bundle of permissions, scoped to a company. Multiple users can hold
  the same role; a user can hold multiple roles (their effective
  permission set is the union).

  System roles (`is_system: true`) ship with the app and can't be
  deleted from the UI. The Owner role (`is_owner: true`) is the
  god-mode role — `Backend.RBAC.has_permission?/2` short-circuits to
  true regardless of the actual `permissions` array.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Companies.Company
  alias Backend.Accounts.User
  alias Backend.RBAC.Permissions

  schema "roles" do
    field :name, :string
    field :slug, :string
    field :description, :string
    field :is_system, :boolean, default: false
    field :is_owner, :boolean, default: false
    field :permissions, {:array, :string}, default: []

    belongs_to :company, Company
    many_to_many :users, User, join_through: "user_roles"

    timestamps(type: :utc_datetime)
  end

  def changeset(role, attrs) do
    role
    |> cast(attrs, [
      :company_id,
      :name,
      :slug,
      :description,
      :is_system,
      :is_owner,
      :permissions
    ])
    |> validate_required([:company_id, :name, :slug])
    |> validate_length(:name, min: 1, max: 80)
    |> validate_format(:slug, ~r/^[a-z][a-z0-9_-]*$/,
      message: "must be lowercase letters, numbers, _ or -"
    )
    |> validate_permissions()
    |> unique_constraint([:company_id, :slug])
  end

  defp validate_permissions(changeset) do
    case get_change(changeset, :permissions) do
      nil ->
        changeset

      perms when is_list(perms) ->
        case Enum.reject(perms, &Permissions.valid?/1) do
          [] ->
            changeset

          unknown ->
            add_error(
              changeset,
              :permissions,
              "contains unknown permission codes: #{Enum.join(unknown, ", ")}"
            )
        end

      _ ->
        add_error(changeset, :permissions, "must be a list of strings")
    end
  end
end
