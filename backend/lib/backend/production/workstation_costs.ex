defmodule Backend.Production.WorkstationCosts do
  @moduledoc """
  Cost + throughput lookups for NPD's stage cost calculator.

  Powers vita-cff's real-time per-unit routing cost estimate: given a
  list of workstation-group uuids from a formulation's stages, return
  per-group `machine_hourly_rate`, `avg_labour_hourly_rate`,
  `avg_seconds_per_unit`, and the sample size those averages came from.

  Design notes:

    * Machine rate is the WSG's static `hourly_rate` (only when
      `hourly_rate_enabled`). It's the same number PSP's own MO-cost
      report uses when a specific `Workstation.hourly_rate` isn't
      overriding it.
    * Labour rate is the mean of per-session `Σ HR.wage_at(employee,
      started_at)` across the last 90 days of *completed / verified*
      MO sessions on any workstation in the group. This captures the
      realistic hourly labour cost of running that group given the
      team that actually staffs it, not a company-wide average.
    * Throughput is `mean((finished_at - started_at) / quantity_produced)`
      across the same session set, filtered to sessions with a
      positive `quantity_produced` so a bad row (0 units, 30 min
      logged) doesn't send the average to `+inf`.
    * `session_count` is exposed so the caller can dim rows with too
      few samples to trust (e.g. render "N=2" in italic).

  Everything is a single-request roll-up — nothing memoised or
  cached; the vita-cff FE calls this once per formulation per open
  and computes the routing cost client-side against the returned
  numbers. That keeps the shape of the API dead simple + means a
  recently-updated WSG rate propagates within one page navigation.
  """

  import Ecto.Query

  alias Backend.HR
  alias Backend.HR.Employee
  alias Backend.Production.{Workstation, WorkstationGroup, WorkstationSession}
  alias Backend.Repo

  # Session lookback window. 90 days smooths out per-week noise while
  # still moving the average when a shift's real throughput changes;
  # older data is likely stale (staff turnover, machine upgrades).
  @lookback_days 90

  # Session statuses that count toward the average. Excludes `active`
  # (still running — `finished_at` is nil, duration is a moving
  # target) and any future draft-like status.
  @counted_statuses ~w(completed verified)

  @doc """
  Bulk cost + throughput lookup. Returns one row per resolvable
  workstation-group uuid; unknown uuids silently drop out (the caller
  diffs input vs output to detect stale references).

  Response row shape:

      %{
        uuid:                     Ecto.UUID.t(),
        name:                     String.t(),
        machine_hourly_rate:      Decimal.t() | nil,   # nil = disabled / unset
        avg_labour_hourly_rate:   Decimal.t() | nil,   # nil = no session data
        avg_seconds_per_unit:     Decimal.t() | nil,   # nil = no session data
        session_count:            non_neg_integer(),
        currency_code:            String.t()           # inferred from wages, defaults to company base
      }
  """
  def bulk_costs(company_id, wsg_uuids)
      when is_integer(company_id) and is_list(wsg_uuids) do
    cleaned =
      wsg_uuids
      |> Enum.filter(&is_binary/1)
      |> Enum.uniq()

    if cleaned == [] do
      []
    else
      groups =
        Repo.all(
          from g in WorkstationGroup,
            where:
              g.company_id == ^company_id and
                g.uuid in ^cleaned and
                g.is_active == true
        )

      if groups == [] do
        []
      else
        group_ids = Enum.map(groups, & &1.id)

        # One query to pull every relevant session across every WSG
        # in the request. Joining through `Workstation` gets us the
        # group-level scope; PG's index on
        # `(company_id, finished_at)` keeps this cheap.
        sessions = load_sessions(company_id, group_ids)

        sessions_by_group = Enum.group_by(sessions, & &1.workstation_group_id)

        # Pre-resolve every (employee_id, started_at_date) pair that
        # the aggregates need. Wages don't change often so memoising
        # per date keeps HR.wage_at calls minimal.
        employee_wage_cache = build_wage_cache(sessions)

        Enum.map(groups, fn group ->
          group_sessions = Map.get(sessions_by_group, group.id, [])

          {avg_labour, avg_seconds, count} =
            aggregate_group(group_sessions, employee_wage_cache)

          %{
            uuid: group.uuid,
            name: group.name,
            machine_hourly_rate: effective_machine_rate(group),
            avg_labour_hourly_rate: avg_labour,
            avg_seconds_per_unit: avg_seconds,
            session_count: count,
            currency_code: currency_for(group)
          }
        end)
      end
    end
  end

  # ----- Session batch load ---------------------------------------

  defp load_sessions(company_id, group_ids) do
    cutoff =
      DateTime.utc_now()
      |> DateTime.add(-@lookback_days * 86_400, :second)
      |> DateTime.truncate(:second)

    from(s in WorkstationSession,
      join: w in Workstation,
      on: w.id == s.workstation_id,
      where:
        s.company_id == ^company_id and
          w.workstation_group_id in ^group_ids and
          s.activity_kind == "mo" and
          s.status in ^@counted_statuses and
          not is_nil(s.finished_at) and
          s.finished_at >= ^cutoff and
          not is_nil(s.quantity_produced) and
          s.quantity_produced > 0,
      select: %{
        workstation_group_id: w.workstation_group_id,
        started_at: s.started_at,
        finished_at: s.finished_at,
        quantity_produced: s.quantity_produced,
        employee_uuids: s.employee_uuids
      }
    )
    |> Repo.all()
  end

  # ----- Wage cache prewarm ---------------------------------------

  # Build `{employee_id, date} => %EmployeeWage{}` for every distinct
  # pair reachable from the session set. Uses `HR.wage_at/2` under the
  # hood — same source PSP's own MO cost breakdown reads.
  defp build_wage_cache(sessions) do
    pairs =
      sessions
      |> Enum.flat_map(fn s ->
        date = DateTime.to_date(s.started_at)
        Enum.map(s.employee_uuids || [], &{&1, date})
      end)
      |> Enum.uniq()

    if pairs == [] do
      %{}
    else
      # Batch-resolve employee_uuid -> employee_id so the wage lookup
      # can key on the internal id (what HR.wage_at wants).
      uuids = pairs |> Enum.map(&elem(&1, 0)) |> Enum.uniq()

      employees =
        Repo.all(
          from e in Employee,
            where: e.uuid in ^uuids,
            select: {e.uuid, e.id}
        )
        |> Map.new()

      Enum.reduce(pairs, %{}, fn {uuid, date}, acc ->
        case Map.get(employees, uuid) do
          nil ->
            acc

          employee_id ->
            case HR.wage_at(employee_id, date) do
              nil -> acc
              wage -> Map.put(acc, {uuid, date}, wage)
            end
        end
      end)
    end
  end

  # ----- Per-group aggregation ------------------------------------

  defp aggregate_group([], _cache), do: {nil, nil, 0}

  defp aggregate_group(sessions, cache) do
    # For each session:
    #   labour_hourly = Σ over employees on the session of their
    #                   effective hourly wage on session.started_at.
    #   seconds_per_unit = (finished_at - started_at) / quantity_produced.
    #
    # A session where no employee has a resolvable wage contributes
    # only to seconds_per_unit — dropping it entirely would over-
    # penalise groups where wages haven't been captured on file yet.
    {labour_sum, labour_count, seconds_sum, session_count} =
      Enum.reduce(sessions, {Decimal.new(0), 0, Decimal.new(0), 0}, fn session,
                                                                      {ls, lc, ss,
                                                                       sc} ->
        labour_hourly = session_labour_hourly(session, cache)
        seconds = session_seconds_per_unit(session)

        {new_ls, new_lc} =
          case labour_hourly do
            nil -> {ls, lc}
            value -> {Decimal.add(ls, value), lc + 1}
          end

        {new_ls, new_lc, Decimal.add(ss, seconds), sc + 1}
      end)

    avg_labour =
      if labour_count > 0 do
        Decimal.div(labour_sum, Decimal.new(labour_count))
      else
        nil
      end

    avg_seconds =
      if session_count > 0 do
        Decimal.div(seconds_sum, Decimal.new(session_count))
      else
        nil
      end

    {avg_labour, avg_seconds, session_count}
  end

  # Sum every employee's wage_at(started_at) — total hourly labour
  # cost of running the session at that moment.
  defp session_labour_hourly(session, cache) do
    date = DateTime.to_date(session.started_at)

    resolved =
      session.employee_uuids
      |> Enum.map(fn uuid -> Map.get(cache, {uuid, date}) end)
      |> Enum.reject(&is_nil/1)

    case resolved do
      [] ->
        nil

      wages ->
        Enum.reduce(wages, Decimal.new(0), fn wage, acc ->
          Decimal.add(acc, wage.hourly_rate)
        end)
    end
  end

  defp session_seconds_per_unit(%{
         started_at: started,
         finished_at: finished,
         quantity_produced: qty
       }) do
    seconds = DateTime.diff(finished, started, :second)
    seconds_dec = Decimal.new(seconds)
    Decimal.div(seconds_dec, qty)
  end

  # ----- Small helpers --------------------------------------------

  defp effective_machine_rate(%WorkstationGroup{
         hourly_rate_enabled: true,
         hourly_rate: %Decimal{} = rate
       }),
       do: rate

  defp effective_machine_rate(_), do: nil

  # Wages carry their own `currency_code`; company base is the safe
  # default for a WSG with no session data (no wage to inspect).
  defp currency_for(%WorkstationGroup{} = _group) do
    # Reserved for a future per-group currency preference; today every
    # WSG rolls up to the company base currency (GBP for Vita) since
    # payroll is denominated there.
    "GBP"
  end
end
