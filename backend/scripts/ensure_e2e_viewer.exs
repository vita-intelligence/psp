# Seeds (or refreshes) the non-admin user the permission-matrix test
# pivots around. Same shape as ensure_e2e_user.exs but always
# `is_admin: false` and the permissions list is whatever's passed via
# E2E_VIEWER_PERMS (comma-separated codes); empty string = no perms.
#
# Run with:  E2E_VIEWER_PERMS="stock.view" mix run scripts/ensure_e2e_viewer.exs

alias Backend.Accounts.User
alias Backend.Companies
alias Backend.Repo

email = "e2e-viewer@vitamanufacture.co.uk"
password = "e2e-viewer-pass"
name = "E2E Viewer"

company = Companies.current()

perms =
  System.get_env("E2E_VIEWER_PERMS", "")
  |> String.split(",", trim: true)
  |> Enum.map(&String.trim/1)
  |> Enum.reject(&(&1 == ""))

user =
  case Repo.get_by(User, email: email) do
    nil ->
      {:ok, u} =
        %User{}
        |> User.registration_changeset(%{
          "email" => email,
          "name" => name,
          "password" => password,
          "company_id" => company.id
        })
        |> Repo.insert()

      u

    existing ->
      existing
  end

now = DateTime.utc_now() |> DateTime.truncate(:second)

# Force non-admin + confirmed + active + exact perms.
{:ok, user} =
  user
  |> Ecto.Changeset.change(%{
    is_admin: false,
    is_active: true,
    confirmed_at: user.confirmed_at || now,
    confirmation_token: nil,
    permissions: perms
  })
  |> Repo.update()

{:ok, _user} =
  user
  |> Ecto.Changeset.change(%{hashed_password: Bcrypt.hash_pwd_salt(password)})
  |> Repo.update()

IO.puts(email)
IO.puts(password)
IO.puts(Enum.join(perms, ","))
