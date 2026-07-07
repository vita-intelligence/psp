defmodule Backend.HR do
  @moduledoc """
  Boundary for the shop-floor workforce record. Owns Employees,
  their wage history, and their reputation-event stream.

  Deferred (follow-up PR): `EmployeeSkill` (workstation-group
  certification), `EmployeeShift` (weekly pattern),
  `EmployeeAbsence` (holiday / sick), `EmployeePayrollProfile`
  (Cloak-encrypted NI + sort code + tax code). None of these gate
  the E2E integration test.
  """

  import Ecto.Query, warn: false

  alias Backend.Repo
  alias Backend.HR.{Employee, EmployeeWage, EmployeeReputationEvent}

  ## Employees ------------------------------------------------------

  def create_employee(attrs, company_id, actor_id \\ nil) do
    attrs =
      attrs
      |> Map.put(:company_id, company_id)
      |> Map.put(:created_by_id, actor_id)

    %Employee{}
    |> Employee.create_changeset(attrs)
    |> Repo.insert()
  end

  def update_employee(%Employee{} = employee, attrs, actor_id \\ nil) do
    attrs = Map.put(attrs, :updated_by_id, actor_id)

    employee
    |> Employee.update_changeset(attrs)
    |> Repo.update()
  end

  def get_employee(company_id, uuid) do
    Repo.one(
      from e in Employee,
        where: e.company_id == ^company_id and e.uuid == ^uuid
    )
  end

  def get_employee_by_external_id(company_id, external_id) do
    Repo.one(
      from e in Employee,
        where: e.company_id == ^company_id and e.external_id == ^external_id
    )
  end

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

  def verify_pin(%Employee{kiosk_pin_hash: nil}, _), do: {:error, :no_pin_set}

  def verify_pin(%Employee{kiosk_pin_hash: hash} = e, pin)
      when is_binary(hash) and is_binary(pin) do
    if Bcrypt.verify_pass(pin, hash), do: {:ok, e}, else: {:error, :invalid_pin}
  end

  def verify_pin(_, _), do: {:error, :invalid_pin}

  def set_pin(%Employee{} = e, pin) do
    e
    |> Employee.set_pin_changeset(pin)
    |> Repo.update()
  end

  ## Wages ----------------------------------------------------------

  @doc """
  Record a new wage effective from `effective_from`. Automatically
  closes the previous open interval (if any) by setting its
  `effective_to = effective_from - 1 day`.
  """
  def add_wage(%Employee{} = employee, attrs) do
    Repo.transaction(fn ->
      close_open_wage(employee, attrs[:effective_from] || attrs["effective_from"])

      case %EmployeeWage{}
           |> EmployeeWage.create_changeset(
             Map.merge(attrs, %{
               company_id: employee.company_id,
               employee_id: employee.id
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

  @doc """
  Resolve the hourly rate that applied to `employee` at `datetime`.
  Returns `nil` if no wage row covers that moment.
  """
  def wage_at(%Employee{id: id}, %DateTime{} = datetime) do
    date = DateTime.to_date(datetime)

    Repo.one(
      from w in EmployeeWage,
        where:
          w.employee_id == ^id and
            w.effective_from <= ^date and
            (is_nil(w.effective_to) or w.effective_to >= ^date),
        order_by: [desc: w.effective_from],
        limit: 1
    )
  end

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
  Record a reputation event and recompute the cached score on the
  employee row atomically.
  """
  def add_reputation_event(%Employee{} = employee, attrs) do
    Repo.transaction(fn ->
      case %EmployeeReputationEvent{}
           |> EmployeeReputationEvent.create_changeset(
             Map.merge(attrs, %{
               company_id: employee.company_id,
               employee_id: employee.id
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
end
