defmodule BackendWeb.HREmployeeController do
  @moduledoc """
  HR / Employees CRUD + wage timeline + reputation timeline.

  Permission gating:

    * `:index`, `:show`, `:list_wages`, `:list_reputation_events`
      → `hr.view`
    * `:create` → `hr.create`
    * `:update`, `:create_wage`, `:create_reputation_event`
      → `hr.edit`
    * `:archive` → `hr.delete`

  Payload shapes match the FE ledger contract:

    * Ledger (`index`): `%{items: [summary...], next_cursor: nil | "..."}`
    * Detail (`show`, `create`, `update`, `archive`): `%{employee: ...}`
    * Timelines (`list_wages`, `list_reputation_events`): keyset-paginated
      `%{items: [...], next_cursor: nil | "..."}`. The profile-page
      sidebar fetches 5; the dedicated infinite-scroll pages walk the
      cursor at 50/page. Workers can accumulate 700+ reputation events
      so an unbounded pull would crush the profile render.
    * Sessions (`list_sessions`): same paginated shape but keyed
      `%{sessions: [...], next_cursor: ...}` to keep the existing
      consumer's response contract stable.
    * Create-wage / record-event: `%{wage: ...}` / `%{event: ...,
      employee: ...}` so the FE can refresh the reputation badge
      without a second GET.
  """

  use BackendWeb, :controller

  alias Backend.HR
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission,
       "hr.view"
       when action in [
              :index,
              :show,
              :list_wages,
              :list_reputation_events,
              :list_sessions
            ]

  plug RequirePermission, "hr.create" when action in [:create]

  plug RequirePermission,
       "hr.edit" when action in [:update, :create_wage, :create_reputation_event]

  plug RequirePermission, "hr.delete" when action in [:archive]

  action_fallback BackendWeb.FallbackController

  ## Ledger ----------------------------------------------------------

  def index(conn, params) do
    user = conn.assigns.current_user
    opts = list_opts_from_params(params)

    {items, next_cursor} = HR.list_employees_page(user.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.hr_employee_summary/1),
      next_cursor: next_cursor
    })
  end

  def show(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    case HR.get_employee(user.company_id, id) do
      nil -> {:error, :not_found}
      employee -> json(conn, %{employee: Payloads.hr_employee(employee)})
    end
  end

  ## Mutation --------------------------------------------------------

  def create(conn, params) do
    user = conn.assigns.current_user
    attrs = Map.drop(params, ["id"])

    case HR.create_employee(user, attrs) do
      {:ok, employee} ->
        conn
        |> put_status(:created)
        |> json(%{employee: Payloads.hr_employee(employee)})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(
          Errors.payload(
            "validation_failed",
            "Please correct the highlighted fields.",
            Errors.changeset_fields(cs)
          )
        )
    end
  end

  def update(conn, %{"id" => id} = params) do
    user = conn.assigns.current_user

    case HR.get_employee(user.company_id, id) do
      nil ->
        {:error, :not_found}

      employee ->
        attrs = Map.drop(params, ["id"])

        case HR.update_employee(user, employee, attrs) do
          {:ok, updated} ->
            json(conn, %{employee: Payloads.hr_employee(updated)})

          {:error, %Ecto.Changeset{} = cs} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "validation_failed",
                "Please correct the highlighted fields.",
                Errors.changeset_fields(cs)
              )
            )
        end
    end
  end

  def archive(conn, %{"hr_employee_id" => id} = params) do
    user = conn.assigns.current_user

    case HR.get_employee(user.company_id, id) do
      nil ->
        {:error, :not_found}

      employee ->
        opts =
          case params["termination_date"] do
            date when is_binary(date) and date != "" ->
              case Date.from_iso8601(date) do
                {:ok, d} -> [termination_date: d]
                _ -> []
              end

            _ ->
              []
          end

        case HR.archive_employee(user, employee, opts) do
          {:ok, updated} ->
            json(conn, %{employee: Payloads.hr_employee(updated)})

          {:error, %Ecto.Changeset{} = cs} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "validation_failed",
                "Please correct the highlighted fields.",
                Errors.changeset_fields(cs)
              )
            )
        end
    end
  end

  ## Wages -----------------------------------------------------------

  def list_wages(conn, %{"hr_employee_id" => id} = params) do
    user = conn.assigns.current_user

    case HR.get_employee(user.company_id, id) do
      nil ->
        {:error, :not_found}

      employee ->
        {wages, next_cursor} =
          HR.list_wages_for_employee(employee, page_opts(params))

        json(conn, %{
          items: Enum.map(wages, &Payloads.hr_employee_wage/1),
          next_cursor: next_cursor
        })
    end
  end

  def create_wage(conn, %{"hr_employee_id" => id} = params) do
    user = conn.assigns.current_user

    case HR.get_employee(user.company_id, id) do
      nil ->
        {:error, :not_found}

      employee ->
        attrs = Map.drop(params, ["hr_employee_id"])

        case HR.add_wage(user, employee, attrs) do
          {:ok, wage} ->
            conn
            |> put_status(:created)
            |> json(%{
              wage: Payloads.hr_employee_wage(wage),
              employee: Payloads.hr_employee(employee)
            })

          {:error, %Ecto.Changeset{} = cs} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "validation_failed",
                "Please correct the highlighted fields.",
                Errors.changeset_fields(cs)
              )
            )
        end
    end
  end

  ## Reputation -----------------------------------------------------

  def list_reputation_events(conn, %{"hr_employee_id" => id} = params) do
    user = conn.assigns.current_user

    case HR.get_employee(user.company_id, id) do
      nil ->
        {:error, :not_found}

      employee ->
        {events, next_cursor} =
          HR.list_reputation_events_for_employee(employee, page_opts(params))

        json(conn, %{
          items: Enum.map(events, &Payloads.hr_employee_reputation_event/1),
          next_cursor: next_cursor
        })
    end
  end

  def create_reputation_event(conn, %{"hr_employee_id" => id} = params) do
    user = conn.assigns.current_user

    case HR.get_employee(user.company_id, id) do
      nil ->
        {:error, :not_found}

      employee ->
        attrs = Map.drop(params, ["hr_employee_id"])

        case HR.record_reputation_event(user, employee, attrs) do
          {:ok, event} ->
            # Reload so `reputation_score` reflects the just-recomputed
            # value the FE will render on the badge.
            fresh = HR.get_employee(user.company_id, employee.uuid)

            conn
            |> put_status(:created)
            |> json(%{
              event: Payloads.hr_employee_reputation_event(event),
              employee: Payloads.hr_employee(fresh)
            })

          {:error, %Ecto.Changeset{} = cs} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "validation_failed",
                "Please correct the highlighted fields.",
                Errors.changeset_fields(cs)
              )
            )
        end
    end
  end

  ## ------------------------------------------------------------------

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      filters: parse_filters(params["filter"]),
      column_filter: params["column_filter"],
      search: params["search"]
    ]
  end

  ## Sessions -------------------------------------------------------

  def list_sessions(conn, %{"hr_employee_id" => id} = params) do
    user = conn.assigns.current_user

    case HR.get_employee(user.company_id, id) do
      nil ->
        {:error, :not_found}

      employee ->
        {sessions, next_cursor} =
          Backend.Production.list_sessions_for_employee(
            user.company_id,
            employee.uuid,
            page_opts(params)
          )

        json(conn, %{
          sessions: Payloads.workstation_sessions(sessions),
          next_cursor: next_cursor
        })
    end
  end

  # Small local shim so timeline endpoints stay symmetrical — the
  # profile card asks for `limit=5`, the dedicated page asks for
  # `limit=50`. `ListQueries.paginate` clamps [1, 100] server-side so a
  # rogue `limit=999999` cannot exhaust the pool.
  defp page_opts(params) do
    [
      limit: params["limit"] || 5,
      cursor: params["cursor"]
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
