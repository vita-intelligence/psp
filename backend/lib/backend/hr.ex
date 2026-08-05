defmodule Backend.HR do
  @moduledoc """
  Boundary for the shop-floor workforce record. Owns Employees,
  their wage history, and their reputation-event stream.

  ## Wage intervals

  `add_wage/3` is the load-bearing write path. Wages are stored as
  half-open intervals `[effective_from, effective_to]` where the row
  with `effective_to == nil` is the currently effective rate. When a
  new wage is inserted the previous "open" row is atomically closed
  (`effective_to = new.effective_from - 1 day`) inside the same
  `Repo.transaction/1`, so a point-in-time lookup (`wage_at/2`) always
  finds exactly one row spanning any date. Payroll math (holiday
  accrual, cost-breakdown at session.start_time) relies on that
  invariant.

  ## Reputation projection

  `reputation_score` on the employee row is a cached **projection** of
  `EmployeeReputationEvent`. It is never mutated directly; every
  `record_reputation_event/3` call recomputes it inside the same
  transaction. Formula: `650 + Σ(delta × max(0, 1 − age_days / 180))`
  clamped to `[300, 850]` — mirrors vita-performance's algorithm so
  both sides project to the same number regardless of who computes it.

  Deferred (follow-up PR): `EmployeeSkill` (workstation-group
  certification), `EmployeeShift` (weekly pattern), `EmployeeAbsence`
  (holiday / sick), `EmployeePayrollProfile` (Cloak-encrypted NI +
  sort code + tax code).
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Broadcasts
  alias Backend.HR.{Employee, EmployeeReputationEvent, EmployeeShift, EmployeeWage}
  alias Backend.ListQueries
  alias Backend.Repo

  # Surface the audit log treats as meaningful. Bookkeeping columns
  # (created_by_id, updated_by_id, reputation_score) are excluded so
  # history rows only show operator-visible changes.
  @audit_fields ~w(full_name preferred_name email phone hire_date termination_date
                   external_id employee_number is_active is_qa)a

  @sortable_fields ~w(id full_name employee_number email is_active is_qa
                      reputation_score hire_date inserted_at updated_at)a
  @filter_fields ~w(is_active is_qa)a
  @search_fields ~w(full_name preferred_name email employee_number external_id)a
  @default_sort {:inserted_at, :desc}

  ## Employees ------------------------------------------------------

  @doc """
  Paginated, sortable, filterable list. Same opts shape as every other
  ledger endpoint (`:cursor`, `:limit`, `:sort`, `:filters`, `:search`,
  `:column_filter`). Preloads audit actors so payloads render without
  N+1 fetches.
  """
  def list_employees_page(company_id, opts \\ []) do
    sort = Keyword.get(opts, :sort, @default_sort)

    base =
      Employee
      |> where([e], e.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @search_fields)
      |> ListQueries.apply_filter(opts[:filters], @filter_fields)
      |> ListQueries.apply_column_filters(opts[:column_filter], @sortable_fields)
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)
      |> preload([:created_by, :updated_by, :user])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  @doc "Static config the FE reads to drive its column controls."
  def list_config do
    %{
      sortable_fields: Enum.map(@sortable_fields, &Atom.to_string/1),
      filter_fields: Enum.map(@filter_fields, &Atom.to_string/1),
      search_fields: Enum.map(@search_fields, &Atom.to_string/1),
      default_sort: %{
        field: Atom.to_string(elem(@default_sort, 0)),
        direction: Atom.to_string(elem(@default_sort, 1))
      }
    }
  end

  @doc """
  Fetch one employee by public UUID, scoped to `company_id`. Returns
  `nil` when not found or the UUID doesn't parse — controllers render
  a clean 404 instead of an Ecto crash.
  """
  def get_employee(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Employee
        |> Repo.get_by(uuid: cast, company_id: company_id)
        |> case do
          nil -> nil
          emp -> Repo.preload(emp, [:created_by, :updated_by, :user])
        end

      :error ->
        nil
    end
  end

  def get_employee(_company_id, _), do: nil

  @doc """
  Legacy lookup used by the mobile kiosk / integration path — a
  company-scoped lookup by numeric primary key.
  """
  def get_employee_by_id(company_id, id) when is_integer(id) do
    Repo.one(from e in Employee, where: e.company_id == ^company_id and e.id == ^id)
  end

  def get_employee_by_external_id(company_id, external_id) do
    Repo.one(
      from e in Employee,
        where: e.company_id == ^company_id and e.external_id == ^external_id
    )
  end

  @doc """
  Active-only lookup, mostly for pickers. Kept behind the same
  paginated API so the mobile kiosk selector can stay simple.
  """
  def list_active_employees(company_id) do
    Repo.all(
      from e in Employee,
        where: e.company_id == ^company_id and e.is_active == true,
        order_by: [asc: e.full_name]
    )
  end

  @doc """
  Legacy unpaginated list used by the integration-read controller.
  Kept in-place so the vita-performance forwarder keeps working while
  the HR settings surface migrates to the paginated `list_employees_page/2`.
  """
  def list_employees(company_id, opts \\ []) do
    active_only = Keyword.get(opts, :active_only, true)

    query =
      from e in Employee,
        where: e.company_id == ^company_id,
        order_by: [asc: e.full_name]

    query =
      if active_only, do: from(e in query, where: e.is_active == true), else: query

    Repo.all(query)
  end

  ## Mutation --------------------------------------------------------

  @doc """
  Create an employee. `actor` stamps `created_by_id` + `updated_by_id`
  and appears in the audit event. Broadcasts + audits on success.
  """
  def create_employee(%User{} = actor, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => actor.company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %Employee{}
    |> Employee.create_changeset(attrs)
    |> Repo.insert()
    |> after_create(actor)
  end

  @doc """
  Integration-path create. Same audit / broadcast plumbing as
  `create_employee/2` but goes through
  `Employee.integration_create_changeset/2` so a pre-hashed
  `kiosk_pin_hash` (from vita-performance's Django user store)
  can be persisted verbatim.
  """
  def create_employee_from_integration(%User{} = actor, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => actor.company_id,
        "created_by_id" => actor.id
      })

    %Employee{}
    |> Employee.integration_create_changeset(attrs)
    |> Repo.insert()
    |> after_create(actor)
  end

  @doc """
  Update an employee. Only the audited surface is diffed into the
  audit log; the kiosk PIN hash is intentionally excluded from
  `@audit_fields` so a rotate doesn't leak the bcrypt hash into
  history rows.
  """
  def update_employee(%User{} = actor, %Employee{} = employee, attrs) do
    before_state = audit_snapshot(employee)

    employee
    |> Employee.update_changeset(
      attrs
      |> stringify_keys()
      |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> after_update(actor, before_state)
  end

  @doc """
  Soft-archive an employee. Sets `is_active = false` and stamps
  `termination_date` (defaults to today) so downstream pickers /
  active-only queries hide the row while sessions can still resolve
  their historical operator FK.
  """
  def archive_employee(%User{} = actor, %Employee{} = employee, opts \\ []) do
    termination = Keyword.get(opts, :termination_date, Date.utc_today())

    update_employee(actor, employee, %{
      "is_active" => false,
      "termination_date" => termination
    })
  end

  defp after_create({:ok, employee}, actor) do
    Audit.record_created(actor, "hr_employee", employee, audit_snapshot(employee))

    Broadcasts.entity_changed(
      "hr-employee",
      employee.uuid,
      employee.company_id,
      "created"
    )

    {:ok, Repo.preload(employee, [:created_by, :updated_by, :user])}
  end

  defp after_create(other, _actor), do: other

  defp after_update({:ok, employee}, actor, before_state) do
    Audit.record_updated(
      actor,
      "hr_employee",
      employee,
      before_state,
      audit_snapshot(employee)
    )

    Broadcasts.entity_changed(
      "hr-employee",
      employee.uuid,
      employee.company_id,
      "updated"
    )

    {:ok, Repo.preload(employee, [:created_by, :updated_by, :user])}
  end

  defp after_update(other, _actor, _before_state), do: other

  defp audit_snapshot(%Employee{} = e),
    do: Map.new(@audit_fields, fn k -> {k, Map.get(e, k)} end)

  ## Kiosk PIN ------------------------------------------------------

  @doc "Verify a bcrypt-hashed kiosk PIN. Used by kiosk auth."
  def verify_pin(%Employee{kiosk_pin_hash: nil}, _), do: {:error, :no_pin_set}

  def verify_pin(%Employee{kiosk_pin_hash: hash} = e, pin)
      when is_binary(hash) and is_binary(pin) do
    if Bcrypt.verify_pass(pin, hash), do: {:ok, e}, else: {:error, :invalid_pin}
  end

  def verify_pin(_, _), do: {:error, :invalid_pin}

  @doc "Set (rotate) the kiosk PIN."
  def set_pin(%Employee{} = e, pin) do
    e
    |> Employee.set_pin_changeset(pin)
    |> Repo.update()
  end

  ## Wages ----------------------------------------------------------

  @doc """
  Wage history, newest first. Used by the detail page's timeline card
  and the dedicated "/hr/employees/:uuid/wages" infinite-scroll page.

  Accepts `:limit` (default 5, clamped [1, 100]) + `:cursor` for keyset
  pagination — same shape every ledger uses. Returns
  `{items, next_cursor}` where `next_cursor` is `nil` when the last
  page has been served.
  """
  def list_wages_for_employee(employee_or_id, opts \\ [])

  def list_wages_for_employee(%Employee{id: id}, opts),
    do: list_wages_for_employee(id, opts)

  def list_wages_for_employee(employee_id, opts) when is_integer(employee_id) do
    sort = {:effective_from, :desc}

    base =
      from w in EmployeeWage,
        where: w.employee_id == ^employee_id,
        preload: [:approved_by]

    base = ListQueries.apply_sort(base, sort, [:effective_from, :id], sort)

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  @doc """
  Record a new wage effective from `attrs.effective_from`. Atomically
  closes any existing open interval (`effective_to = new.effective_from
  - 1 day`) then inserts the new row with `effective_to = nil`. Wraps
  the whole thing in `Repo.transaction/1` so a mid-write crash leaves
  the interval chain consistent.

  Actor stamps `approved_by_id` so payroll investigators can trace who
  signed off which raise.
  """
  def add_wage(%User{} = actor, %Employee{} = employee, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => employee.company_id,
        "employee_id" => employee.id,
        "approved_by_id" => actor.id
      })

    Repo.transaction(fn ->
      close_open_wage(employee, attrs["effective_from"])

      changeset = EmployeeWage.create_changeset(%EmployeeWage{}, attrs)

      case Repo.insert(changeset) do
        {:ok, wage} ->
          Audit.record_created(actor, "employee_wage", wage, wage_audit_snapshot(wage))

          Broadcasts.entity_changed(
            "hr-employee",
            employee.uuid,
            employee.company_id,
            "wage_added"
          )

          Repo.preload(wage, :approved_by)

        {:error, cs} ->
          Repo.rollback(cs)
      end
    end)
  end

  # Legacy 2-arity call site — the mobile kiosk seeder still uses this.
  def add_wage(%Employee{} = employee, attrs) do
    Repo.transaction(fn ->
      close_open_wage(employee, attrs[:effective_from] || attrs["effective_from"])

      case %EmployeeWage{}
           |> EmployeeWage.create_changeset(
             Map.merge(stringify_keys(attrs), %{
               "company_id" => employee.company_id,
               "employee_id" => employee.id
             })
           )
           |> Repo.insert() do
        {:ok, wage} -> wage
        {:error, cs} -> Repo.rollback(cs)
      end
    end)
  end

  defp close_open_wage(employee, effective_from) when not is_nil(effective_from) do
    prior_date =
      case effective_from do
        %Date{} -> Date.add(effective_from, -1)
        s when is_binary(s) -> s |> Date.from_iso8601!() |> Date.add(-1)
      end

    from(w in EmployeeWage,
      where: w.employee_id == ^employee.id and is_nil(w.effective_to)
    )
    |> Repo.update_all(set: [effective_to: prior_date])
  end

  defp close_open_wage(_, _), do: :ok

  defp wage_audit_snapshot(%EmployeeWage{} = w) do
    %{
      effective_from: w.effective_from,
      effective_to: w.effective_to,
      hourly_rate: w.hourly_rate,
      currency_code: w.currency_code,
      tax_treatment: w.tax_treatment,
      source_kind: w.source_kind,
      reason: w.reason
    }
  end

  @doc """
  Resolve the wage row that applied to `employee` at `date_or_datetime`.
  Returns `nil` if no interval covers that moment.

  Accepts a `Date` or a `DateTime` — the cost-breakdown report passes
  session start_times, so we accept both to avoid double-conversion.
  """
  def wage_at(%Employee{} = e, at), do: wage_at(e.id, at)

  def wage_at(employee_id, %DateTime{} = dt) when is_integer(employee_id) do
    wage_at(employee_id, DateTime.to_date(dt))
  end

  def wage_at(employee_id, %Date{} = date) when is_integer(employee_id) do
    Repo.one(
      from w in EmployeeWage,
        where:
          w.employee_id == ^employee_id and
            w.effective_from <= ^date and
            (is_nil(w.effective_to) or w.effective_to >= ^date),
        order_by: [desc: w.effective_from],
        limit: 1
    )
  end

  def wage_at(_, _), do: nil

  @doc "The currently effective wage row (the one with `effective_to == nil`)."
  def current_wage(%Employee{id: id}) do
    Repo.one(
      from w in EmployeeWage,
        where: w.employee_id == ^id and is_nil(w.effective_to),
        order_by: [desc: w.effective_from],
        limit: 1
    )
  end

  ## Reputation -----------------------------------------------------

  @doc """
  Chronological (newest-first) reputation events. Backs the profile-page
  sidebar card (top 5) AND the dedicated
  "/hr/employees/:uuid/reputation" infinite-scroll page.

  Accepts `:limit` (default 5, clamped [1, 100]) + `:cursor` for keyset
  pagination. Returns `{items, next_cursor}` where `next_cursor` is `nil`
  when the tail of the stream has been served. Workers who trigger
  hundreds of auto-perf events would otherwise crush the profile-page
  render — the paginated API is mandatory for that path.
  """
  def list_reputation_events_for_employee(employee_or_id, opts \\ [])

  def list_reputation_events_for_employee(%Employee{id: id}, opts),
    do: list_reputation_events_for_employee(id, opts)

  def list_reputation_events_for_employee(employee_id, opts) when is_integer(employee_id) do
    sort = {:inserted_at, :desc}

    base =
      from e in EmployeeReputationEvent,
        where: e.employee_id == ^employee_id,
        preload: [:created_by_user, :created_by_employee]

    base = ListQueries.apply_sort(base, sort, [:inserted_at, :id], sort)

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  @doc """
  Insert a reputation event and recompute the cached score on the
  employee row atomically.
  """
  def record_reputation_event(%User{} = actor, %Employee{} = employee, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => employee.company_id,
        "employee_id" => employee.id,
        "created_by_user_id" => actor.id
      })

    Repo.transaction(fn ->
      changeset = EmployeeReputationEvent.create_changeset(%EmployeeReputationEvent{}, attrs)

      case Repo.insert(changeset) do
        {:ok, event} ->
          case recompute_reputation_score(employee) do
            {:ok, _} -> :ok
            {:error, cs} -> Repo.rollback(cs)
          end

          Broadcasts.entity_changed(
            "hr-employee",
            employee.uuid,
            employee.company_id,
            "reputation_event"
          )

          Repo.preload(event, [:created_by_user, :created_by_employee])

        {:error, cs} ->
          Repo.rollback(cs)
      end
    end)
  end

  # Legacy 2-arity call site kept for the integration path — the
  # vita-performance forwarder posts events via `add_reputation_event/2`.
  def add_reputation_event(%Employee{} = employee, attrs) do
    Repo.transaction(fn ->
      case %EmployeeReputationEvent{}
           |> EmployeeReputationEvent.create_changeset(
             Map.merge(stringify_keys(attrs), %{
               "company_id" => employee.company_id,
               "employee_id" => employee.id
             })
           )
           |> Repo.insert() do
        {:ok, event} ->
          recompute_reputation_score(employee)
          event

        {:error, cs} ->
          Repo.rollback(cs)
      end
    end)
  end

  @doc """
  Rebuild `employee.reputation_score` from the event stream. Linear
  decay over 180 days mirrors vita-performance's algorithm so both
  sides project to the same number regardless of who computes it.

  Baseline 650. Clamped to [300, 850].
  """
  def recompute_reputation_score(%Employee{} = employee) do
    events =
      Repo.all(
        from e in EmployeeReputationEvent,
          where: e.employee_id == ^employee.id,
          order_by: [asc: e.inserted_at]
      )

    now = DateTime.utc_now()

    decayed_sum =
      events
      |> Enum.reduce(0, fn e, acc ->
        age_days = DateTime.diff(now, e.inserted_at, :second) / 86_400
        weight = max(0.0, 1.0 - age_days / 180)
        acc + e.score_delta * weight
      end)

    score = 650 + trunc(decayed_sum)
    clamped = min(850, max(300, score))

    employee
    |> Ecto.Changeset.change(reputation_score: clamped)
    |> Repo.update()
  end

  ## Company-wide timeline pages ------------------------------------

  @doc """
  Company-wide wage-history feed, newest-first. Optional
  ``employee_uuid`` filter narrows to a single worker (matches the FE
  wage-page filter dropdown). Preloads the employee so the row can
  render the worker link.
  """
  def list_wages_page(company_id, opts \\ []) do
    sort = {:inserted_at, :desc}
    employee_uuid = opts[:employee_uuid]

    base =
      from w in EmployeeWage,
        join: e in assoc(w, :employee),
        where: e.company_id == ^company_id,
        preload: [:employee, :approved_by]

    base =
      if is_binary(employee_uuid) and employee_uuid != "" do
        from [w, e] in base, where: e.uuid == ^employee_uuid
      else
        base
      end

    base = ListQueries.apply_sort(base, sort, [:inserted_at, :id], sort)

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  @doc """
  Company-wide reputation-event feed, newest-first. Optional
  ``employee_uuid`` narrows to one worker. Preloads actors + employee
  so the row payload carries names without an N+1 fetch.
  """
  def list_reputation_events_page(company_id, opts \\ []) do
    sort = {:inserted_at, :desc}
    employee_uuid = opts[:employee_uuid]

    base =
      from ev in EmployeeReputationEvent,
        join: e in assoc(ev, :employee),
        where: e.company_id == ^company_id,
        preload: [:employee, :created_by_user, :created_by_employee]

    base =
      if is_binary(employee_uuid) and employee_uuid != "" do
        from [ev, e] in base, where: e.uuid == ^employee_uuid
      else
        base
      end

    base = ListQueries.apply_sort(base, sort, [:inserted_at, :id], sort)

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  @doc """
  Aggregate HR statistics for the /hr/statistics page. Rolls up shifts,
  sessions, wage totals per employee across the past ``days`` (default
  30). Values are computed live off the same tables the ledgers read,
  so the numbers stay in sync with the timelines.
  """
  def statistics_summary(company_id, opts \\ []) do
    days = opts[:days] || 30
    cutoff = DateTime.add(DateTime.utc_now(), -days * 86_400, :second)

    employees =
      Repo.all(
        from e in Employee,
          where: e.company_id == ^company_id and e.is_active == true,
          order_by: [asc: e.full_name]
      )

    shifts_by_employee =
      Repo.all(
        from s in EmployeeShift,
          where:
            s.company_id == ^company_id and
              s.started_at >= ^cutoff and
              not is_nil(s.duration_seconds),
          group_by: s.employee_id,
          select:
            {s.employee_id,
             %{
               shift_count: count(s.id),
               total_seconds: sum(s.duration_seconds)
             }}
      )
      |> Map.new()

    sessions_by_employee = sessions_stats_by_employee(company_id, cutoff)

    employees
    |> Enum.map(fn e ->
      shift_stats = Map.get(shifts_by_employee, e.id, %{shift_count: 0, total_seconds: 0})
      session_stats =
        Map.get(sessions_by_employee, e.id, %{
          session_count: 0,
          total_produced: nil,
          avg_performance: nil
        })

      wage = fetch_current_wage(e.id)

      %{
        employee: %{
          id: e.id,
          uuid: e.uuid,
          name: e.full_name,
          reputation_score: e.reputation_score,
          is_qa: e.is_qa
        },
        shift_count: shift_stats.shift_count || 0,
        shift_seconds: shift_stats.total_seconds || 0,
        session_count: session_stats.session_count,
        avg_performance: session_stats.avg_performance,
        total_produced: session_stats.total_produced,
        hourly_rate:
          case wage do
            %EmployeeWage{hourly_rate: r, currency_code: c} ->
              %{hourly_rate: r && to_string(r), currency_code: c}

            _ ->
              nil
          end,
        estimated_labour_cost: estimate_labour_cost(shift_stats.total_seconds, wage)
      }
    end)
    |> then(fn rows ->
      %{
        days: days,
        rows: rows,
        totals: %{
          employees: length(rows),
          shift_count: Enum.reduce(rows, 0, &(&2 + &1.shift_count)),
          shift_seconds: Enum.reduce(rows, 0, &(&2 + (&1.shift_seconds || 0))),
          session_count: Enum.reduce(rows, 0, &(&2 + &1.session_count))
        }
      }
    end)
  end

  defp sessions_stats_by_employee(company_id, cutoff) do
    # WorkstationSession stores `employee_uuids :: {array, Ecto.UUID}`
    # — one session can have N workers. Unnest so each employee gets
    # their share (they all get the full session duration, not a
    # fraction, so the numbers match what the operator saw on the kiosk).
    query = """
      SELECT e.id,
             COUNT(*) AS session_count,
             SUM(s.quantity_produced) AS total_produced,
             AVG(s.performance_percentage) AS avg_performance
      FROM workstation_sessions s
      JOIN LATERAL unnest(s.employee_uuids) AS uid ON TRUE
      JOIN employees e ON e.uuid = uid::text::uuid AND e.company_id = $1
      WHERE s.company_id = $1
        AND s.started_at >= $2
      GROUP BY e.id
    """

    %{rows: rows} = Repo.query!(query, [company_id, cutoff])

    Enum.reduce(rows, %{}, fn [emp_id, session_count, produced, avg_perf], acc ->
      Map.put(acc, emp_id, %{
        session_count: session_count || 0,
        total_produced: produced && to_string(produced),
        avg_performance: avg_perf && Float.round(avg_perf * 1.0, 1)
      })
    end)
  end

  defp fetch_current_wage(employee_id) do
    Repo.one(
      from w in EmployeeWage,
        where: w.employee_id == ^employee_id and is_nil(w.effective_to),
        limit: 1
    )
  end

  defp estimate_labour_cost(nil, _), do: nil
  defp estimate_labour_cost(0, _), do: nil
  defp estimate_labour_cost(_seconds, nil), do: nil

  defp estimate_labour_cost(seconds, %EmployeeWage{hourly_rate: %Decimal{} = rate}) do
    hours =
      seconds
      |> Decimal.new()
      |> Decimal.div(Decimal.new(3600))

    rate
    |> Decimal.mult(hours)
    |> Decimal.round(2)
    |> to_string()
  end

  defp estimate_labour_cost(_, _), do: nil

  ## Shifts ---------------------------------------------------------

  @doc """
  Paginated shifts for a single employee, newest-first. Matches the
  wage / reputation timeline pattern so the FE consumer looks the
  same across all three streams.
  """
  def list_shifts_for_employee(employee_or_id, opts \\ [])

  def list_shifts_for_employee(%Employee{id: id}, opts),
    do: list_shifts_for_employee(id, opts)

  def list_shifts_for_employee(employee_id, opts) when is_integer(employee_id) do
    sort = {:started_at, :desc}

    base =
      from s in EmployeeShift,
        where: s.employee_id == ^employee_id

    base = ListQueries.apply_sort(base, sort, [:started_at, :id], sort)

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  @doc """
  Company-wide shifts feed, newest-first. Optional ``employee_uuid``
  narrows to one worker (matches the FE shifts-page filter dropdown).
  Powers the /hr/shifts overview page.
  """
  def list_shifts_page(company_id, opts \\ []) do
    sort = {:started_at, :desc}
    employee_uuid = opts[:employee_uuid]

    base =
      from s in EmployeeShift,
        join: e in assoc(s, :employee),
        where: s.company_id == ^company_id,
        preload: [:employee]

    base =
      if is_binary(employee_uuid) and employee_uuid != "" do
        from [s, e] in base, where: e.uuid == ^employee_uuid
      else
        base
      end

    base = ListQueries.apply_sort(base, sort, [:started_at, :id], sort)

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  @doc """
  Upsert a shift by (`company_id`, `external_id`). Called by the
  integration endpoint on every vp writeback so an open shift's
  clock-out mutates the existing row instead of duplicating.
  """
  def upsert_shift_from_integration(%Employee{} = employee, attrs) do
    external_id = Map.get(attrs, "external_id") || Map.get(attrs, :external_id)

    existing =
      case external_id do
        id when is_binary(id) and id != "" ->
          Repo.one(
            from s in EmployeeShift,
              where:
                s.company_id == ^employee.company_id and
                  s.external_id == ^id
          )

        _ ->
          nil
      end

    result =
      case existing do
        %EmployeeShift{} = row ->
          row
          |> EmployeeShift.update_changeset(stringify_keys(attrs))
          |> Repo.update()
          |> case do
            {:ok, updated} -> {:ok, %{row: updated, matched: true}}
            other -> other
          end

        nil ->
          attrs =
            attrs
            |> stringify_keys()
            |> Map.merge(%{
              "company_id" => employee.company_id,
              "employee_id" => employee.id
            })

          %EmployeeShift{}
          |> EmployeeShift.create_changeset(attrs)
          |> Repo.insert()
          |> case do
            {:ok, row} -> {:ok, %{row: row, matched: false}}
            other -> other
          end
      end

    case result do
      {:ok, %{row: row}} = ok ->
        Broadcasts.entity_changed(
          "hr-employee",
          employee.uuid,
          employee.company_id,
          "shift"
        )

        Broadcasts.entity_changed(
          "hr-employee-shifts",
          nil,
          employee.company_id,
          "changed"
        )

        _ = row
        ok

      other ->
        other
    end
  end

  ## ------------------------------------------------------------------

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
