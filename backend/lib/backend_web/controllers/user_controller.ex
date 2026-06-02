defmodule BackendWeb.UserController do
  @moduledoc """
  Users endpoints split into two tiers by access level:

    * `:team`           — slim roster (id/name/email/avatar/online).
                          **No** permission gate — any authed user.
                          Powers the home-page presence widget.
    * `:index` / `:show` — admin payload incl. permissions, wage,
                          is_admin. Gated on `users.view`.
    * `:update_access`  — additionally gated on `roles.edit`.

  Index follows the standard paginated list shape from
  `Backend.ListQueries` — `{items, next_cursor}` — so the same
  frontend DataTable that drives Warehouses drives the team list
  too. Online flag is computed per row from the live presence set
  and merged into the payload.
  """

  use BackendWeb, :controller

  import Ecto.Query, only: [from: 2]

  alias Backend.{Accounts, Repo}
  alias Backend.RBAC.Permissions
  alias BackendWeb.{Errors, Payloads, Presence}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "users.view" when action in [:index, :show]
  plug RequirePermission, "roles.edit" when action in [:update_access]

  action_fallback BackendWeb.FallbackController

  @doc """
  Slim org roster for the home-page "who's here" widget. Returns one
  row per active user — `{id, name, email, avatar, is_online}` — with
  no role/permission/wage data. **Not** gated on `users.view`: any
  authed user can see who else is in the company. Pairs with the
  lobby presence channel for the live online dot.
  """
  def team(conn, _params) do
    user = conn.assigns.current_user
    online_ids = Presence.list_online_user_ids()

    items =
      user.company_id
      |> Accounts.list_team_for_company()
      |> Enum.map(&Map.put(&1, :is_online, &1.id in online_ids))

    json(conn, %{items: items})
  end

  def index(conn, params) do
    user = conn.assigns.current_user
    opts = list_opts_from_params(params)

    {items, next_cursor} = Accounts.list_for_company(user.company_id, opts)
    online_ids = Presence.list_online_user_ids()

    json(conn, %{
      items: Enum.map(items, &user_row(&1, online_ids)),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => id}) do
    current = conn.assigns.current_user

    case Accounts.get_user_by_uuid(id) do
      nil ->
        {:error, :not_found}

      %{company_id: other_company_id} when other_company_id != current.company_id ->
        {:error, :not_found}

      user ->
        online = user.id in Presence.list_online_user_ids()

        json(conn, %{user: Map.put(Payloads.user(user), :is_online, online)})
    end
  end

  @doc """
  Replace the per-user access state. Body shape:

      %{
        "is_admin"    => true,
        "permissions" => ["company.view", "warehouses.edit", …],
        "hourly_wage" => "12.50"   # optional, string or number
      }

  Guards:
    * `:last_admin_removed`  — the change would leave the company
                                with zero admins. Refused.
    * `:cannot_self_demote`  — the actor is removing their OWN
                                is_admin without a replacement admin
                                in the room. Refused.
    * `:unknown_permission`  — a code outside the registry was sent.
                                Refused (would be a no-op grant).

  Unknown user / cross-company users → 404.
  """
  def update_access(conn, %{"id" => id} = params) do
    actor = conn.assigns.current_user

    with %{} = subject <- Accounts.get_user_by_uuid(id),
         true <- subject.company_id == actor.company_id,
         {:ok, attrs} <- normalize_access_params(params),
         :ok <- check_access_guards(subject, actor, attrs) do
      {:ok, updated} =
        subject
        |> Ecto.Changeset.change(attrs)
        |> Repo.update()

      online = updated.id in Presence.list_online_user_ids()

      json(conn, %{
        user: Map.put(Payloads.user(updated), :is_online, online)
      })
    else
      nil -> {:error, :not_found}
      false -> {:error, :not_found}
      {:error, :last_admin_removed} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "last_admin_removed",
            "Every company must keep at least one Admin.",
            %{is_admin: ["The company can't lose its last Admin."]}
          )
        )

      {:error, :cannot_self_demote} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "cannot_self_demote",
            "You can't remove your own Admin status. Ask another Admin.",
            %{is_admin: ["You can't strip your own Admin status."]}
          )
        )

      {:error, :unknown_permission, bad} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "unknown_permission",
            "One or more permission codes aren't recognised.",
            %{permissions: ["Unknown: #{Enum.join(bad, ", ")}"]}
          )
        )

      {:error, :invalid_payload} ->
        conn
        |> put_status(:bad_request)
        |> json(
          Errors.payload(
            "invalid_payload",
            "Send `is_admin` (bool), `permissions` (list), and optional `hourly_wage`."
          )
        )
    end
  end

  @doc "Static matrix config the frontend uses to draw the grid."
  def matrix(conn, _params), do: json(conn, %{matrix: Permissions.matrix()})

  ## ------------------------------------------------------------------

  defp normalize_access_params(params) do
    is_admin = params["is_admin"]
    perms_raw = params["permissions"]
    wage_raw = params["hourly_wage"]

    cond do
      not is_boolean(is_admin) ->
        {:error, :invalid_payload}

      not is_list(perms_raw) ->
        {:error, :invalid_payload}

      true ->
        # De-dupe + reject unknown codes so a stale UI can't smuggle
        # a typo'd permission into the user's grants.
        cleaned = perms_raw |> Enum.uniq() |> Enum.map(&to_string/1)
        unknown = Enum.reject(cleaned, &Permissions.valid?/1)

        if unknown != [] do
          {:error, :unknown_permission, unknown}
        else
          {:ok,
           %{
             is_admin: is_admin,
             permissions: cleaned,
             hourly_wage: parse_wage(wage_raw)
           }}
        end
    end
  end

  defp parse_wage(nil), do: nil
  defp parse_wage(""), do: nil
  defp parse_wage(n) when is_number(n), do: Decimal.new(to_string(n))

  defp parse_wage(s) when is_binary(s) do
    case Decimal.parse(s) do
      {dec, _} -> dec
      :error -> nil
    end
  end

  defp parse_wage(_), do: nil

  # Verify the change wouldn't leave the company without an admin AND
  # doesn't have the current actor stripping their own admin.
  defp check_access_guards(subject, actor, %{is_admin: false}) do
    cond do
      subject.id == actor.id and actor.is_admin ->
        {:error, :cannot_self_demote}

      other_admin_exists?(subject) ->
        :ok

      true ->
        {:error, :last_admin_removed}
    end
  end

  defp check_access_guards(_subject, _actor, _attrs), do: :ok

  defp other_admin_exists?(subject) do
    Repo.exists?(
      from u in Backend.Accounts.User,
        where:
          u.company_id == ^subject.company_id and
            u.id != ^subject.id and
            u.is_admin == true
    )
  end

  ## ------------------------------------------------------------------

  defp user_row(user, online_ids) do
    user
    |> Payloads.user()
    |> Map.put(:is_online, MapSet.member?(online_ids, user.id))
  end

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      filters: parse_filters(params["filter"]),
      search: params["search"]
    ]
  end

  defp parse_sort(nil), do: nil
  defp parse_sort(""), do: nil

  defp parse_sort(spec) when is_binary(spec) do
    case String.split(spec, ":", parts: 2) do
      [field] -> {field, :asc}
      [field, "desc"] -> {field, :desc}
      [field, _] -> {field, :asc}
    end
  end

  defp parse_sort(_), do: nil

  defp parse_filters(nil), do: %{}
  defp parse_filters(map) when is_map(map), do: map
  defp parse_filters(_), do: %{}
end
