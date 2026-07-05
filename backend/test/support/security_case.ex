defmodule Backend.SecurityCase do
  @moduledoc """
  Shared setup for the `test/security/` regression suite.

  Mirrors the ad-hoc `insert_company!` / `insert_user!` helpers from
  `Backend.CommentsTest`, but exposed as reusable functions so every
  security test can seed the same two-tenant fixture without
  duplicating boilerplate.

  Every test that opts in gets:

    * an SQL sandbox owner (via `Backend.DataCase.setup_sandbox/1`)
    * `Backend.Repo` in scope
    * helper functions to seed companies, users, vendors, etc.
  """

  use ExUnit.CaseTemplate

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Repo

  using do
    quote do
      alias Backend.Repo

      import Backend.SecurityCase
    end
  end

  setup tags do
    Backend.DataCase.setup_sandbox(tags)
    :ok
  end

  @doc "Insert a company with the given name (default `Tenant A`)."
  def insert_company!(name \\ "Tenant A") do
    {:ok, c} =
      %Company{}
      |> Company.bootstrap_changeset(%{name: name})
      |> Repo.insert()

    c
  end

  @doc """
  Insert a user in `company_id` with the supplied permissions.

  `opts` supports `is_admin: true` to bypass RBAC entirely, matching
  the shape used elsewhere in the test suite.
  """
  def insert_user!(company_id, email, permissions \\ [], opts \\ []) do
    is_admin = Keyword.get(opts, :is_admin, false)

    attrs = %{
      "email" => email,
      "name" => email,
      "password" => "correct-horse-battery-staple"
    }

    {:ok, user} =
      %User{}
      |> User.registration_changeset(attrs)
      |> Ecto.Changeset.put_change(:company_id, company_id)
      |> Ecto.Changeset.put_change(:permissions, permissions)
      |> Ecto.Changeset.put_change(:is_admin, is_admin)
      |> Repo.insert()

    user
  end

  @doc "Insert a vendor under `company_id` with sane defaults."
  def insert_vendor!(company_id, actor, name \\ "Test Vendor Ltd") do
    {:ok, v} =
      Backend.Vendors.create(actor, company_id, %{
        name: name,
        currency_code: "GBP"
      })

    v
  end

end
