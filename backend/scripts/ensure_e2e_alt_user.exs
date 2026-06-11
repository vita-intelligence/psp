# Second E2E user — used by the collab matrix specs to drive a peer
# browser context alongside `e2e@vitamanufacture.co.uk`. Same admin
# bypass, different identity. Idempotent.
#
# Run with:  mix run scripts/ensure_e2e_alt_user.exs

alias Backend.Accounts.User
alias Backend.Companies
alias Backend.Repo

email = "e2e-alt@vitamanufacture.co.uk"
password = "e2e-playwright-pass-alt"
name = "E2E Peer"

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
