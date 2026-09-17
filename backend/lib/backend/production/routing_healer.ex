defmodule Backend.Production.RoutingHealer do
  @moduledoc """
  Recomputes `RoutingStep.actual_setup_seconds` +
  `actual_cycle_seconds` from real `WorkstationSession` data. Runs
  nightly via `Backend.Production.RoutingHealJob`.

  ## Signal → target

  For each active `RoutingStep`:

    1. Pull every `WorkstationSession` in the last `@window_days` where
       the parent `manufacturing_order_step.routing_step_id` matches
       this step, `status = "completed"`, `quantity_produced > 0`,
       and `finished_at IS NOT NULL`.
    2. Trim outliers — drop top and bottom 10 % of the
       `duration / quantity` distribution so one dumped batch or one
       hero run doesn't skew the target.
    3. If ≥ `@min_samples` sessions AND the quantity distribution has
       real variance (`stddev(qty) / mean(qty) ≥ 0.15`), fit a linear
       regression `duration_seconds = setup + cycle × units` via
       least squares. This is the honest split of setup vs cycle.
    4. Otherwise, fall back to `cycle = median(duration / qty)` and
       keep the planner-authored setup (we can't infer it from flat
       quantity data).
    5. Blend with the authored value based on sample size:
       `effective = α × healed + (1-α) × authored`,
       `α = sample_size / (sample_size + @blend_pivot)`.
       Small samples stay close to planner intent.
    6. Write to the RoutingStep + emit a `RoutingHealEvent` row.

  Whole thing is idempotent — running it twice against the same
  window produces the same numbers.

  ## Safety

    * `manual_override_locked = true` → skip the write, emit a
      `"locked"` heartbeat so the UI stays honest about when we last
      looked.
    * When `< @min_samples`, we still emit an `"insufficient_data"`
      event so the routing UI can render "waiting on more data (3/5)".
    * Sudden > 25 % drift from the previously-healed value doesn't
      block the write — it flows through so scoring / costing stay
      current — but the event carries the delta and the UI raises a
      banner for the planner to investigate.

  ## Snapshot to MO steps

  Live MOs (`actual_start` still nil) get the fresh healed value
  copied down to their `manufacturing_order_step` mirror so a
  freshly-started session picks it up on start. In-flight MOs
  (already-started steps) keep their snapshotted target so
  scoring baselines don't drift mid-run.
  """

  import Ecto.Query, warn: false

  alias Backend.Production.{
    ManufacturingOrderStep,
    RoutingHealEvent,
    RoutingStep,
    WorkstationSession
  }

  alias Backend.Repo

  @window_days 30
  @min_samples 5
  @qty_variance_floor 0.15
  @blend_pivot 10
  @trim_pct 0.10

  @doc """
  Heal every active routing step across all companies. Called by the
  nightly job; also callable from IEx / a supervisor button as
  `RoutingHealer.heal_all()`.

  Returns a small stats map so the job can log a one-line summary
  instead of every step's details.
  """
  def heal_all(now \\ DateTime.utc_now() |> DateTime.truncate(:second)) do
    step_ids =
      Repo.all(
        from rs in RoutingStep, where: not is_nil(rs.workstation_group_id), select: rs.id
      )

    stats = %{
      total: length(step_ids),
      regression: 0,
      median: 0,
      insufficient: 0,
      locked: 0,
      errors: 0
    }

    Enum.reduce(step_ids, stats, fn id, acc ->
      case heal_step(id, now) do
        {:ok, %{method: m}} ->
          Map.update!(acc, method_bucket(m), &(&1 + 1))

        {:error, _reason} ->
          Map.update!(acc, :errors, &(&1 + 1))
      end
    end)
  end

  defp method_bucket("regression"), do: :regression
  defp method_bucket("median"), do: :median
  defp method_bucket("insufficient_data"), do: :insufficient
  defp method_bucket("locked"), do: :locked
  defp method_bucket(_), do: :errors

  @doc """
  Heal a single routing step by id. Returns `{:ok, event_map}` on
  success, `{:error, reason}` on unrecoverable errors. Silent-no-op
  on the two skip paths (still writes a heartbeat event and returns
  `{:ok, ...}`).
  """
  def heal_step(routing_step_id, now) do
    case Repo.get(RoutingStep, routing_step_id) do
      nil ->
        {:error, :not_found}

      %RoutingStep{manual_override_locked: true} = step ->
        emit_event(step, nil, nil, 0, nil, "locked", now)
        {:ok, %{method: "locked"}}

      %RoutingStep{} = step ->
        samples = load_samples(step)
        write_heal(step, samples, now)
    end
  end

  # -------------------------------------------------------------------
  # Sample loading
  # -------------------------------------------------------------------

  defp load_samples(%RoutingStep{id: rs_id, company_id: company_id}) do
    cutoff = DateTime.utc_now() |> DateTime.add(-@window_days * 86_400, :second)

    Repo.all(
      from ws in WorkstationSession,
        join: mo_step in ManufacturingOrderStep,
        on: mo_step.id == ws.manufacturing_order_step_id,
        where: ws.company_id == ^company_id,
        where: mo_step.routing_step_id == ^rs_id,
        where: ws.status == "completed",
        where: not is_nil(ws.finished_at),
        where: not is_nil(ws.started_at),
        where: not is_nil(ws.quantity_produced),
        where: ws.finished_at >= ^cutoff,
        select: %{
          duration_seconds:
            fragment("EXTRACT(EPOCH FROM (? - ?))", ws.finished_at, ws.started_at),
          quantity: ws.quantity_produced
        }
    )
    |> Enum.map(fn %{duration_seconds: d, quantity: q} ->
      %{
        duration_seconds: to_float(d),
        quantity: decimal_to_float(q)
      }
    end)
    |> Enum.filter(fn %{duration_seconds: d, quantity: q} ->
      is_number(d) and d > 0 and is_number(q) and q > 0
    end)
  end

  # -------------------------------------------------------------------
  # Heal decision + persistence
  # -------------------------------------------------------------------

  defp write_heal(%RoutingStep{} = step, samples, now) when length(samples) < @min_samples do
    emit_event(step, nil, nil, length(samples), nil, "insufficient_data", now)
    {:ok, %{method: "insufficient_data"}}
  end

  defp write_heal(%RoutingStep{} = step, samples, now) do
    trimmed = trim_outliers(samples)
    n = length(trimmed)

    # Regression / median both work in per-unit reality since sessions
    # carry (duration, quantity) — one row per session, quantity is
    # the units produced. We convert to per-cycle (per capacity units)
    # below so `actual_cycle_seconds` matches the authored shape:
    #   authored: cycle_time_min × 60  (seconds for `capacity` units)
    #   healed:   actual_cycle_seconds (seconds for `capacity` units)
    # Costing formula `cycle_seconds × qty / capacity` then works
    # identically against either branch.
    {method, setup_seconds, cycle_seconds_per_unit, r_squared} =
      if quantity_has_variance?(trimmed) do
        {a, b, r2} = linear_regression(trimmed)
        {"regression", max(0.0, a), max(0.0, b), r2}
      else
        median_cycle = median(Enum.map(trimmed, fn s -> s.duration_seconds / s.quantity end))
        authored_setup = decimal_to_float(step.setup_time_min || Decimal.new("0")) * 60
        {"median", authored_setup, median_cycle, nil}
      end

    capacity = decimal_to_float(step.capacity || Decimal.new("1"))
    capacity = if capacity > 0, do: capacity, else: 1.0
    cycle_seconds_per_cycle = cycle_seconds_per_unit * capacity

    confidence = calc_confidence(n, r_squared)

    {blended_setup, blended_cycle} =
      blend_with_authored(step, setup_seconds, cycle_seconds_per_cycle, n)

    previous_setup = decimal_to_float(step.actual_setup_seconds)
    previous_cycle = decimal_to_float(step.actual_cycle_seconds)

    Repo.transaction(fn ->
      step
      |> Ecto.Changeset.change(%{
        actual_setup_seconds: to_decimal(blended_setup, 2),
        actual_cycle_seconds: to_decimal(blended_cycle, 4),
        sample_size: n,
        confidence: to_decimal(confidence, 3),
        heal_computed_at: now
      })
      |> Repo.update!()

      emit_event(
        step,
        previous_setup,
        blended_setup,
        n,
        confidence,
        method,
        now,
        previous_cycle,
        blended_cycle
      )

      # Snapshot fresh values onto in-flight MO steps that haven't
      # started yet — the ones already running keep their at-start
      # snapshot so the operator's scoring baseline stays stable.
      from(m in ManufacturingOrderStep,
        where: m.routing_step_id == ^step.id,
        where: is_nil(m.actual_start),
        where: m.manual_override_locked == false
      )
      |> Repo.update_all(
        set: [
          actual_setup_seconds: to_decimal(blended_setup, 2),
          actual_cycle_seconds: to_decimal(blended_cycle, 4),
          sample_size: n,
          confidence: to_decimal(confidence, 3),
          heal_computed_at: now
        ]
      )
    end)

    {:ok, %{method: method, sample_size: n, confidence: confidence}}
  end

  # -------------------------------------------------------------------
  # Stats
  # -------------------------------------------------------------------

  # Trim the top/bottom 10 % of `duration/qty` ratios. Guards against
  # one dropped batch (very high ratio) or one hero run (very low)
  # jerking the median. Skip for very small samples where dropping
  # points would leave us < min_samples.
  defp trim_outliers(samples) when length(samples) < 10, do: samples

  defp trim_outliers(samples) do
    n = length(samples)
    drop = trunc(n * @trim_pct)

    samples
    |> Enum.sort_by(& &1.duration_seconds / &1.quantity)
    |> Enum.drop(drop)
    |> Enum.drop(-drop)
  end

  defp quantity_has_variance?(samples) do
    qtys = Enum.map(samples, & &1.quantity)
    mean_qty = mean(qtys)

    cond do
      mean_qty <= 0 ->
        false

      true ->
        stddev(qtys, mean_qty) / mean_qty >= @qty_variance_floor
    end
  end

  # Ordinary least squares — `y = a + b*x`. Returns `{a, b, r_squared}`.
  # r_squared feeds the confidence blend.
  defp linear_regression(samples) do
    xs = Enum.map(samples, & &1.quantity)
    ys = Enum.map(samples, & &1.duration_seconds)
    n = length(samples)
    mean_x = mean(xs)
    mean_y = mean(ys)

    covariance =
      xs
      |> Enum.zip(ys)
      |> Enum.reduce(0.0, fn {x, y}, acc -> acc + (x - mean_x) * (y - mean_y) end)

    variance =
      Enum.reduce(xs, 0.0, fn x, acc ->
        d = x - mean_x
        acc + d * d
      end)

    b =
      if variance == 0 do
        0.0
      else
        covariance / variance
      end

    a = mean_y - b * mean_x

    ss_res =
      xs
      |> Enum.zip(ys)
      |> Enum.reduce(0.0, fn {x, y}, acc ->
        pred = a + b * x
        d = y - pred
        acc + d * d
      end)

    ss_tot =
      Enum.reduce(ys, 0.0, fn y, acc ->
        d = y - mean_y
        acc + d * d
      end)

    r_squared =
      cond do
        ss_tot == 0 -> 1.0
        true -> max(0.0, 1.0 - ss_res / ss_tot)
      end

    _ = n
    {a, b, r_squared}
  end

  defp calc_confidence(n, r_squared) do
    base = n / (n + @blend_pivot)

    case r_squared do
      nil -> base * 0.7
      r when r >= 0 and r <= 1 -> base * (0.3 + 0.7 * r)
      _ -> base * 0.5
    end
  end

  defp blend_with_authored(step, healed_setup, healed_cycle, n) do
    alpha = n / (n + @blend_pivot)
    authored_setup = decimal_to_float(step.setup_time_min || Decimal.new("0")) * 60
    authored_cycle = decimal_to_float(step.cycle_time_min || Decimal.new("0")) * 60

    {
      alpha * healed_setup + (1.0 - alpha) * authored_setup,
      alpha * healed_cycle + (1.0 - alpha) * authored_cycle
    }
  end

  # -------------------------------------------------------------------
  # Audit
  # -------------------------------------------------------------------

  defp emit_event(
         %RoutingStep{} = step,
         from_setup,
         to_setup,
         sample_size,
         confidence,
         method,
         now,
         from_cycle \\ nil,
         to_cycle \\ nil
       ) do
    %RoutingHealEvent{}
    |> RoutingHealEvent.changeset(%{
      routing_step_id: step.id,
      company_id: step.company_id,
      from_setup_seconds: to_decimal(from_setup, 2),
      to_setup_seconds: to_decimal(to_setup, 2),
      from_cycle_seconds: to_decimal(from_cycle, 4),
      to_cycle_seconds: to_decimal(to_cycle, 4),
      sample_size: sample_size,
      confidence: to_decimal(confidence, 3),
      method: method,
      window_days: @window_days,
      computed_at: now
    })
    |> Repo.insert!()
  end

  # -------------------------------------------------------------------
  # Small numeric helpers
  # -------------------------------------------------------------------

  defp mean([]), do: 0.0
  defp mean(list), do: Enum.sum(list) / length(list)

  defp stddev(list, mu) do
    n = length(list)

    if n < 2 do
      0.0
    else
      var =
        list
        |> Enum.reduce(0.0, fn x, acc ->
          d = x - mu
          acc + d * d
        end)
        |> Kernel./(n - 1)

      :math.sqrt(var)
    end
  end

  defp median([]), do: 0.0

  defp median(list) do
    sorted = Enum.sort(list)
    n = length(sorted)

    if rem(n, 2) == 1 do
      Enum.at(sorted, div(n, 2))
    else
      lo = Enum.at(sorted, div(n, 2) - 1)
      hi = Enum.at(sorted, div(n, 2))
      (lo + hi) / 2
    end
  end

  defp to_float(nil), do: nil
  defp to_float(x) when is_number(x), do: x * 1.0
  defp to_float(%Decimal{} = d), do: Decimal.to_float(d)

  defp decimal_to_float(nil), do: nil
  defp decimal_to_float(%Decimal{} = d), do: Decimal.to_float(d)
  defp decimal_to_float(x) when is_number(x), do: x * 1.0

  defp to_decimal(nil, _dp), do: nil

  defp to_decimal(x, dp) when is_number(x) do
    x
    |> Float.round(dp)
    |> Decimal.from_float()
    |> Decimal.round(dp)
  end
end
