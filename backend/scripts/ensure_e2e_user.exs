# Idempotent: ensures the Playwright E2E user exists, is confirmed,
# active, and admin (so every RBAC gate short-circuits). Prints
# `EMAIL\nPASSWORD\n` to stdout for the caller to pipe into env.
#
# Run with:  mix run scripts/ensure_e2e_user.exs

alias Backend.Accounts.User
alias Backend.Companies
alias Backend.Repo

email = "e2e@vitamanufacture.co.uk"
password = "e2e-playwright-pass"
name = "E2E Playwright"

company = Companies.current()

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

# Force admin + confirmed + active regardless of how the row was
# initially registered, and refresh the password hash so we know the
# value above is what's in the DB even after a previous rotation.
{:ok, user} =
  user
  |> Ecto.Changeset.change(%{
    is_admin: true,
    is_active: true,
    confirmed_at: user.confirmed_at || now,
    confirmation_token: nil
  })
  |> Repo.update()

{:ok, _user} =
  user
  |> Ecto.Changeset.change(%{
    hashed_password: Bcrypt.hash_pwd_salt(password)
  })
  |> Repo.update()

IO.puts(email)
IO.puts(password)
