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
              :list_sessions,
              :list_shifts,
              :list_all_shifts,
              :list_all_wages,
              :list_all_reputation_events,
              :statistics_summary,
              :show_shift_detail
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

  ## Shifts ---------------------------------------------------------

  def list_shifts(conn, %{"hr_employee_id" => id} = params) do
    user = conn.assigns.current_user

    case HR.get_employee(user.company_id, id) do
      nil ->
        {:error, :not_found}

      employee ->
        {shifts, next_cursor} = HR.list_shifts_for_employee(employee, page_opts(params))

        json(conn, %{
          items: Enum.map(shifts, &Payloads.hr_employee_shift/1),
          next_cursor: next_cursor
        })
    end
  end

  @doc """
  Shift-detail proxy. PSP mirrors the shift envelope from vita-perf
  on close, but the session-level timeline + dashboard counters
  live on vp — this action calls vp's inbound endpoint with the
  shared secret and hands the response body straight to the FE.

  Route param `shift_uuid` is the PSP-side ``EmployeeShift.uuid``
  (public identifier); ``external_id`` on that row is the vp
  ``WorkerShift`` pk that vp keys off. Double-scoped by
  `(company, employee_uuid)` so a hostile shift_uuid can never
  leak another worker's detail through this endpoint.

  Silent-degrade posture: vp being unreachable / mid-boot / on a
  cold reload should surface as a specific error banner on the
  FE, not a spinner-forever. Returns 502 with a machine slug
  + human detail + debug string so `ErrorBanner` can render
  the full triage bundle.
  """
  def show_shift_detail(conn, %{"hr_employee_id" => emp_uuid, "shift_uuid" => shift_uuid}) do
    user = conn.assigns.current_user

    case HR.get_employee_shift(user.company_id, emp_uuid, shift_uuid) do
      nil ->
        {:error, :not_found}

      shift ->
        case shift.external_id do
          ext when is_binary(ext) and ext != "" ->
            fetch_shift_detail_from_vitaperf(conn, shift, ext)

          _ ->
            require Logger

            Logger.warning(
              "shift_detail: EmployeeShift #{shift.uuid} has no external_id — cannot proxy to vita-perf"
            )

            conn
            |> put_status(:unprocessable_entity)
            |> json(
              Errors.payload(
                "shift_detail_no_external_id",
                "This shift has no vita-perf linkage yet — nothing to render."
              )
            )
        end
    end
  end

  defp fetch_shift_detail_from_vitaperf(conn, _shift, external_id) do
    require Logger

    with {:ok, base_url} <- vitaperf_url(),
         {:ok, token} <- vitaperf_token() do
      request_url =
        String.trim_trailing(base_url, "/") <>
          "/api/kiosk/psp/shifts/" <> external_id <> "/detail/"

      req =
        Req.new(
          url: request_url,
          headers: [{"x-psp-publish-token", token}],
          receive_timeout: 10_000
        )

      case Req.get(req) do
        {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
          json(conn, body)

        {:ok, %Req.Response{status: 404}} ->
          Logger.warning(
            "shift_detail: vp returned 404 for external_id=#{external_id}"
          )

          conn
          |> put_status(:not_found)
          |> json(
            Errors.payload(
              "shift_detail_not_found_on_vitaperf",
              "vita-perf couldn't find this shift — it may have been deleted or the linkage is stale."
            )
          )

        {:ok, %Req.Response{status: status, body: body}} ->
          Logger.error(
            "shift_detail: vp returned status=#{status} body=#{inspect(body)}"
          )

          conn
          |> put_status(:bad_gateway)
          |> json(
            Errors.payload(
              "shift_detail_vitaperf_error",
              "vita-perf returned an unexpected status while loading the shift timeline."
            )
          )

        {:error, err} ->
          Logger.error("shift_detail: vp unreachable — #{inspect(err)}")

          conn
          |> put_status(:bad_gateway)
          |> json(
            Errors.payload(
              "shift_detail_vitaperf_unreachable",
              "vita-perf is unreachable — the timeline can't render right now."
            )
          )
      end
    else
      {:error, code, detail, debug} ->
        Logger.error("shift_detail: config error — #{debug}")

        conn
        |> put_status(:service_unavailable)
        |> json(Errors.payload(code, detail))
    end
  end

  defp vitaperf_url do
    case System.get_env("PSP_TO_VITAPERF_URL") do
      url when is_binary(url) and url != "" ->
        {:ok, url}

      _ ->
        {:error, "shift_detail_config_missing",
         "PSP is not configured to reach vita-perf.",
         "PSP_TO_VITAPERF_URL env var is unset"}
    end
  end

  defp vitaperf_token do
    case System.get_env("PSP_TO_VITAPERF_TOKEN") do
      token when is_binary(token) and token != "" ->
        {:ok, token}

      _ ->
        {:error, "shift_detail_config_missing",
         "PSP is not configured with a vita-perf shared secret.",
         "PSP_TO_VITAPERF_TOKEN env var is unset"}
    end
  end

  @doc """
  Company-wide shifts feed used by the /hr/shifts overview page.
  Accepts optional `?employee_uuid=` for per-worker filtering.
  """
  def list_all_shifts(conn, params) do
    user = conn.assigns.current_user

    {shifts, next_cursor} =
      HR.list_shifts_page(
        user.company_id,
        Keyword.merge(page_opts(params), employee_uuid: params["employee_uuid"])
      )

    json(conn, %{
      items: Enum.map(shifts, &Payloads.hr_employee_shift/1),
      next_cursor: next_cursor
    })
  end

  @doc """
  Company-wide wage-history feed used by the /hr/wages overview page.
  Accepts optional `?employee_uuid=` for per-worker filtering.
  """
  def list_all_wages(conn, params) do
    user = conn.assigns.current_user

    {wages, next_cursor} =
      HR.list_wages_page(
        user.company_id,
        Keyword.merge(page_opts(params), employee_uuid: params["employee_uuid"])
      )

    json(conn, %{
      items:
        Enum.map(wages, fn w ->
          w
          |> Payloads.hr_employee_wage()
          |> Map.put(
            :employee,
            case Map.get(w, :employee) do
              %Backend.HR.Employee{} = e ->
                %{id: e.id, uuid: e.uuid, name: e.full_name}

              _ ->
                nil
            end
          )
        end),
      next_cursor: next_cursor
    })
  end

  @doc """
  Company-wide reputation-event feed used by the /hr/reputation
  overview page. Accepts optional `?employee_uuid=`.
  """
  def list_all_reputation_events(conn, params) do
    user = conn.assigns.current_user

    {events, next_cursor} =
      HR.list_reputation_events_page(
        user.company_id,
        Keyword.merge(page_opts(params), employee_uuid: params["employee_uuid"])
      )

    json(conn, %{
      items:
        Enum.map(events, fn ev ->
          ev
          |> Payloads.hr_employee_reputation_event()
          |> Map.put(
            :employee,
            case Map.get(ev, :employee) do
              %Backend.HR.Employee{} = e ->
                %{id: e.id, uuid: e.uuid, name: e.full_name}

              _ ->
                nil
            end
          )
        end),
      next_cursor: next_cursor
    })
  end

  @doc """
  Aggregate HR statistics — one row per employee across the past
  `?days=` window (default 30). Powers the /hr/statistics page.
  """
  def statistics_summary(conn, params) do
    user = conn.assigns.current_user
    days = parse_int(params["days"]) || 30

    summary = HR.statistics_summary(user.company_id, days: days)

    json(conn, summary)
  end

  defp parse_int(nil), do: nil
  defp parse_int(v) when is_integer(v), do: v

  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, _} when n > 0 and n <= 365 -> n
      _ -> nil
    end
  end

  defp parse_int(_), do: nil

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
