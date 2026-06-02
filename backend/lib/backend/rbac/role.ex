defmodule Backend.RBAC.Role do
  @moduledoc """
  A permission template — a saved bundle of permission codes admins
  can apply to a user's matrix with one click. The DB table is still
  called `roles` for schema stability; the UI surfaces them as
  "templates". There is no persistent link between a user and a
  template: applying just unions the template's codes into
  `user.permissions`.

  System rows (`is_system: true`) are reserved for future demo/seed
  templates and refuse update/delete via the controller. Today none
  are seeded.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.RBAC.Permissions

  schema "roles" do
    # Public identifier — URLs / API / channel topics use this.
    field :uuid, Ecto.UUID, autogenerate: true
    field :name, :string
    field :slug, :string
    field :description, :string
    field :is_system, :boolean, default: false
    field :permissions, {:array, :string}, default: []

    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User

    timestamps(type: :utc_datetime)
  end

  def changeset(role, attrs) do
    role
    |> cast(attrs, [
      :company_id,
      :name,
      :slug,
      :description,
      :permissions,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :name, :slug])
    |> validate_length(:name, min: 1, max: 80)
    |> validate_length(:description, max: 400)
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
