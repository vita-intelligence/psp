defmodule Backend.Forms.Publisher do
  @moduledoc """
  PSP → vita-performance form publisher.

  On every form-template write PSP resolves the template for each
  workstation it's assigned to (`Backend.Forms.Resolver`) and POSTs
  the flat DynamicForm shape to vita-perf's
  `/api/dynamic-forms/publish/` endpoint. Idempotency + monotonic
  version guards live on the vita-perf side (see
  `dynamic_forms/views/publish.py`); this module is fire-and-forget
  with silent degrade — a transient vita-perf outage leaves the
  mirror stale, not the PSP data.

  ## Wiring

  * `Backend.Forms.Templates.create / update / deactivate / reactivate`
    call `publish_template/1` after their Repo write succeeds — the
    call re-publishes for every workstation that carries this template.
  * `Backend.Production.update_workstation` calls `publish_workstation/1`
    after a successful update so a fresh assignment lands on the kiosk
    immediately.
  * Follow-up: equipment attach/detach on a workstation should also
    call `publish_workstation/1` so cleaning per-equipment sections
    stay fresh. Not yet wired — see docs/PSP_FORMS_INTEGRATION.md.

  ## Config

  Two env vars:

    * ``PSP_TO_VITAPERF_URL``  — base URL of vita-perf (e.g.
                                 http://localhost:8001)
    * ``PSP_TO_VITAPERF_TOKEN`` — shared secret; presented as
                                 X-PSP-Publish-Token.

  When either is unset the publisher logs a warning and returns
  `:not_configured`. That's the default state on a fresh dev
  checkout, and it's not a bug — the FE `dirty_since_publish`
  indicator surfaces the drift so a human can notice.
  """

  require Logger

  alias Backend.Forms.FormTemplate
  alias Backend.Forms.Resolver
  alias Backend.Forms.Templates
  alias Backend.Production.Workstation
  alias Backend.Repo

  import Ecto.Query, warn: false

  # PSP trigger enum maps 1:1 to what vita-perf's publish endpoint
  # expects (with `cleaning` added there in migration 0002).
  @valid_triggers ~w(
    workstation_start
    workstation_end
    cleaning_start
    cleaning_end
    maintenance_start
    maintenance_end
    equipment_cleaning_start
    equipment_cleaning_end
    equipment_maintenance_start
    equipment_maintenance_end
  )

  # Cleaning + maintenance triggers that ALSO carry the cadence
  # scalars in their publish payload — the ``_end`` phases are what
  # bump next-due after a session completes, so those are the ones
  # the vp mirror uses for its due-soon chips. The ``_start`` phases
  # don't need cadence context.
  @cleaning_end_triggers ~w(cleaning_end equipment_cleaning_end)
  @maintenance_end_triggers ~w(maintenance_end equipment_maintenance_end)

  @doc """
  Fire-and-forget publish for `template` across every workstation it
  is assigned to. Runs off the caller's thread via
  `Task.Supervisor` so the calling transaction commits before the
  HTTP happens — DB row is durable even if vita-perf is unreachable.
  """
  @spec publish_template(FormTemplate.t()) :: :ok
  def publish_template(%FormTemplate{} = template) do
    async(fn -> do_publish_template(template) end)
  end

  @doc """
  Fire-and-forget publish for every form template assigned to
  `workstation`. Used after workstation form-assignment or cleaning
  cadence changes so the kiosk sees fresh copies.
  """
  @spec publish_workstation(Workstation.t()) :: :ok
  def publish_workstation(%Workstation{} = ws) do
    async(fn -> do_publish_workstation(ws) end)
  end

  # ── sync callable (used from callback endpoint) ───────────────────

  @doc """
  Synchronous variant — resolves + POSTs immediately. Callers that
  need the round-trip result (e.g. the cleaning-complete callback
  which must reflect the fresh schedule back) use this directly.
  Returns `:ok` on 2xx / drop, `{:error, reason}` otherwise.
  """
  @spec publish_template_sync(FormTemplate.t()) ::
          :ok | {:error, term()}
  def publish_template_sync(%FormTemplate{} = template) do
    do_publish_template(template)
  end

  @spec publish_workstation_sync(Workstation.t()) ::
          :ok | {:error, term()}
  def publish_workstation_sync(%Workstation{} = ws) do
    do_publish_workstation(ws)
  end

  # ── internals ────────────────────────────────────────────────────

  defp async(fun) when is_function(fun, 0) do
    case Task.Supervisor.start_child(Backend.AsyncSupervisor, fun) do
      {:ok, _pid} ->
        :ok

      {:error, reason} ->
        Logger.warning(
          "Forms.Publisher async spawn failed (#{inspect(reason)}); " <>
            "running inline"
        )

        _ = fun.()
        :ok
    end
  end

  defp do_publish_template(%FormTemplate{} = template) do
    assignments = assignments_referencing(template)

    if assignments == [] do
      # Template not yet assigned anywhere — nothing to publish. The
      # first workstation assignment will fire another publish and
      # this template lands then.
      Logger.debug(
        "Forms.Publisher: template #{template.uuid} not assigned to any " <>
          "workstation; skipping publish"
      )

      :ok
    else
      results =
        Enum.map(assignments, fn {ws, sort_order} ->
          push_one(template, ws, sort_order)
        end)

      if Enum.all?(results, &(&1 == :ok)) do
        mark_published(template)
        :ok
      else
        first_error = Enum.find(results, &(&1 != :ok))
        first_error
      end
    end
  end

  defp do_publish_workstation(%Workstation{} = ws) do
    ws =
      Repo.preload(ws, [
        {:form_assignments, :form_template},
        {:equipment, [:item, category: [form_assignments: :form_template]]}
      ])

    # 1. Workstation-scoped forms — one push per assignment.
    ws_results =
      ws.form_assignments
      |> Enum.reject(fn a -> is_nil(a.form_template) end)
      |> Enum.map(fn a -> push_one(a.form_template, ws, a.sort_order) end)

    # 2. Equipment-scoped forms — for every active machine on this
    #    workstation, walk its category's form assignments and push
    #    each one keyed by the machine's uuid.
    eq_results =
      ws.equipment
      |> Enum.filter(fn e -> e.status not in ["retired", "disposed", "canceled"] end)
      |> Enum.flat_map(&resolve_equipment_form_pushes(&1, ws))

    (ws_results ++ eq_results)
    |> Enum.find(&(&1 != :ok))
    |> case do
      nil -> :ok
      err -> err
    end
  end

  # Return the list of push results for one equipment unit. Each
  # push includes the equipment_uuid so vp keys the mirror row on
  # (workstation, equipment, trigger) instead of just (workstation,
  # trigger).
  defp resolve_equipment_form_pushes(equipment, %Workstation{} = ws) do
    case equipment.category do
      %Backend.Equipment.Category{form_assignments: assignments}
      when is_list(assignments) ->
        assignments
        |> Enum.reject(fn a -> is_nil(a.form_template) end)
        |> Enum.map(fn a ->
          push_one(a.form_template, ws, a.sort_order, equipment: equipment)
        end)

      _ ->
        []
    end
  end

  # One HTTP call for one (template × workstation × maybe-equipment)
  # tuple. Workstation-scoped forms omit ``equipment_uuid`` in the
  # payload; equipment-scoped forms set it so the vp mirror keys on
  # (workstation, equipment, trigger) and the kiosk pulls the right
  # forms per session scope.
  defp push_one(template, ws), do: push_one(template, ws, 0, [])
  defp push_one(template, ws, sort_order), do: push_one(template, ws, sort_order, [])

  defp push_one(
         %FormTemplate{trigger: trigger} = template,
         %Workstation{} = ws,
         sort_order,
         opts
       )
       when trigger in @valid_triggers do
    with {:ok, url} <- fetch_url(),
         {:ok, token} <- fetch_token() do
      ws = Repo.preload(ws, equipment: :item)
      equipment = Keyword.get(opts, :equipment)

      # Equipment-scoped forms are already targeted at one machine;
      # per_equipment_fields expansion doesn't apply. Fall through
      # to the simple `fields` list. Workstation-scoped forms still
      # use the Resolver to expand equipment sections at publish
      # time.
      resolved =
        if FormTemplate.equipment_scoped?(trigger) do
          fields = Map.get(template.schema || %{}, "fields", [])
          if is_list(fields), do: fields, else: []
        else
          Resolver.resolve(template, ws)
        end

      payload = %{
        "psp_uuid" => template.uuid,
        "psp_version" => template.version,
        "name" => template.name,
        "trigger" => template.trigger,
        "schema" => %{"fields" => resolved},
        "is_active" => template.is_active,
        # Empty array = every worker on the assigned station gets it;
        # non-empty = kiosk audience gate. Vita-perf stores it as-is
        # and enforces on inject.
        "worker_uuids" => template.worker_uuids || [],
        "workstation_external_id" => ws.uuid,
        "equipment_uuid" =>
          case equipment do
            %Backend.Equipment.Equipment{uuid: uuid} -> uuid
            _ -> nil
          end,
        "sort_order" => sort_order || 0
      }

      payload =
        cond do
          trigger == "cleaning_end" ->
            Map.put(payload, "workstation_cleaning_schedule", %{
              "last_cleaning_at" => encode_datetime(ws.last_cleaning_at),
              "next_cleaning_due_at" => encode_date(ws.next_cleaning_due_at)
            })

          trigger == "maintenance_end" ->
            Map.put(payload, "workstation_maintenance_schedule", %{
              "last_maintenance_at" => encode_datetime(ws.last_maintenance_at),
              "next_maintenance_due_at" => encode_date(ws.next_maintenance_due_at)
            })

          trigger == "equipment_cleaning_end" ->
            case equipment do
              %Backend.Equipment.Equipment{
                last_cleaning_at: last_at,
                next_cleaning_due_at: next_due
              } ->
                Map.put(payload, "equipment_cleaning_schedule", %{
                  "last_cleaning_at" => encode_datetime(last_at),
                  "next_cleaning_due_at" => encode_date(next_due)
                })

              _ ->
                payload
            end

          trigger == "equipment_maintenance_end" ->
            case equipment do
              %Backend.Equipment.Equipment{
                last_maintenance_at: last_at,
                next_maintenance_at: next_due
              } ->
                Map.put(payload, "equipment_maintenance_schedule", %{
                  "last_maintenance_at" => encode_datetime(last_at),
                  "next_maintenance_at" => encode_datetime(next_due)
                })

              _ ->
                payload
            end

          trigger in @cleaning_end_triggers or trigger in @maintenance_end_triggers ->
            payload

          true ->
            payload
        end

      request_url = String.trim_trailing(url, "/") <> "/api/dynamic-forms/publish/"

      req =
        Req.new(
          url: request_url,
          json: payload,
          headers: [{"x-psp-publish-token", token}],
          receive_timeout: 10_000
        )

      post_with_retries(req, template, ws)
    end
  end

  # Send the publish POST with exponential backoff for transient
  # failures (transport errors, 5xx). Doesn't retry 4xx — those are
  # bugs (auth, validation) that a retry can't fix.
  #
  # This is the first line of defence against dev-server hiccups
  # (Django reloading mid-request, Daphne cold-start), transient
  # networking (retryable connection resets), and vita-perf boot
  # windows. The PublisherReconciler is the second line — it sweeps
  # every N minutes and re-fires any template whose publish path
  # never got through, so even a total dropped push eventually
  # self-heals without an operator having to re-save on the UI.
  @publish_max_attempts 3
  @publish_backoff_ms [250, 1_000, 4_000]
  defp post_with_retries(req, template, ws) do
    Enum.reduce_while(1..@publish_max_attempts, {:error, :unknown}, fn attempt, _acc ->
      case Req.post(req) do
        {:ok, %Req.Response{status: status}} when status in 200..204 ->
          Logger.debug(
            "Forms.Publisher pushed #{template.trigger} template " <>
              "#{template.uuid} v#{template.version} to workstation " <>
              "#{ws.uuid} — #{status} (attempt #{attempt})"
          )

          {:halt, :ok}

        {:ok, %Req.Response{status: status, body: body}}
        when status >= 500 and attempt < @publish_max_attempts ->
          Logger.warning(
            "Forms.Publisher 5xx from vita-perf (attempt #{attempt}/" <>
              "#{@publish_max_attempts}); retrying — " <>
              "template=#{template.uuid}, ws=#{ws.uuid}, status=#{status}"
          )

          sleep_backoff(attempt)
          {:cont, {:error, {:http, status, body}}}

        {:ok, %Req.Response{status: status, body: body}} ->
          Logger.warning(
            "Forms.Publisher push rejected by vita-perf " <>
              "(status=#{status}, template=#{template.uuid}, ws=#{ws.uuid}, " <>
              "body=#{inspect(body)})"
          )

          {:halt, {:error, {:http, status, body}}}

        {:error, reason} when attempt < @publish_max_attempts ->
          Logger.warning(
            "Forms.Publisher transport failure (attempt #{attempt}/" <>
              "#{@publish_max_attempts}); retrying — " <>
              "template=#{template.uuid}, ws=#{ws.uuid}, reason=#{inspect(reason)}"
          )

          sleep_backoff(attempt)
          {:cont, {:error, {:transport, reason}}}

        {:error, reason} ->
          Logger.warning(
            "Forms.Publisher transport failure (final attempt) — " <>
              "template=#{template.uuid}, ws=#{ws.uuid}, reason=#{inspect(reason)}"
          )

          {:halt, {:error, {:transport, reason}}}
      end
    end)
  end

  defp sleep_backoff(attempt) do
    Enum.at(@publish_backoff_ms, attempt - 1, 4_000)
    |> Process.sleep()
  end

  # Unknown trigger — nothing to do. Guardrail in case a future
  # migration adds a value the publisher doesn't understand yet.
  defp push_one(%FormTemplate{trigger: trigger, uuid: uuid}, _, _sort_order) do
    Logger.warning(
      "Forms.Publisher: template #{uuid} has unsupported trigger " <>
        "'#{trigger}'; skipping"
    )

    :ok
  end

  # Returns `[{workstation, sort_order}]` — the same template may
  # be attached to a single workstation under multiple slots (e.g.
  # start AND end); publish each attachment separately with its own
  # sort_order so the kiosk walk-through order lines up.
  defp assignments_referencing(%FormTemplate{id: id}) do
    from(a in Backend.Production.WorkstationFormAssignment,
      join: w in Workstation,
      on: w.id == a.workstation_id,
      where: a.form_template_id == ^id,
      preload: [workstation: [equipment: :item]],
      select: {a, w}
    )
    |> Repo.all()
    |> Enum.map(fn {a, _w} -> {a.workstation, a.sort_order} end)
  end

  # Only mark published once — if the template has already been
  # bumped past this version between our async start and now, don't
  # regress it.
  defp mark_published(%FormTemplate{version: version} = template) do
    now = DateTime.utc_now()
    case Templates.mark_published(template, version, now) do
      {:ok, _} -> :ok
      _ -> :ok
    end
  end

  defp fetch_url do
    case System.get_env("PSP_TO_VITAPERF_URL") do
      url when is_binary(url) and url != "" ->
        {:ok, url}

      _ ->
        Logger.info(
          "Forms.Publisher not configured: PSP_TO_VITAPERF_URL unset; " <>
            "skipping publish"
        )

        :not_configured
    end
  end

  defp fetch_token do
    case System.get_env("PSP_TO_VITAPERF_TOKEN") do
      token when is_binary(token) and token != "" ->
        {:ok, token}

      _ ->
        Logger.info(
          "Forms.Publisher not configured: PSP_TO_VITAPERF_TOKEN unset; " <>
            "skipping publish"
        )

        :not_configured
    end
  end

  defp encode_datetime(nil), do: nil
  defp encode_datetime(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp encode_datetime(%NaiveDateTime{} = ndt), do: NaiveDateTime.to_iso8601(ndt)

  defp encode_date(nil), do: nil
  defp encode_date(%Date{} = d), do: Date.to_iso8601(d)
end
