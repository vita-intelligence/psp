defmodule Backend.RBAC.Permissions do
  @moduledoc """
  Permission registry — the single source of truth for every action
  the platform recognises.

  A permission code is a `"<resource>.<action>"` string. Resources are
  the noun (`company`, `users`, `roles`); actions are the verb (`view`,
  `edit`, `invite`, `deactivate`, …). Keep codes stable forever —
  changing a code is a breaking change for every role that holds it.

  Grouped into modules so the future "Permissions" admin UI can render
  them in sensible buckets (each tuple is `{code, description}`).
  """

  @company [
    {"company.view", "View company settings"},
    {"company.edit", "Edit company settings"}
  ]

  @users [
    {"users.view", "View team members"},
    {"users.invite", "Invite new users"},
    {"users.deactivate", "Deactivate users"}
  ]

  @roles [
    {"roles.view", "View roles"},
    {"roles.edit", "Create, edit, and assign roles"}
  ]

  @doc """
  All permissions, in display order. Used by the Owner-role seeder
  (Owner gets every permission so a future permission addition lights
  up automatically).
  """
  def all do
    Enum.map(@company ++ @users ++ @roles, &elem(&1, 0))
  end

  @doc "Permissions grouped by resource for the future admin UI."
  def grouped do
    %{
      company: @company,
      users: @users,
      roles: @roles
    }
  end

  @doc "Check that a permission code is a known one."
  def valid?(code) when is_binary(code), do: code in all()
  def valid?(_), do: false
end
