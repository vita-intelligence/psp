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
  @valid_triggers ~w(workstation_start workstation_end cleaning)

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
    ws = Repo.preload(ws, [form_assignments: :form_template, equipment: :item])

    ws.form_assignments
    |> Enum.reject(fn a -> is_nil(a.form_template) end)
    |> Enum.map(fn a -> push_one(a.form_template, ws, a.sort_order) end)
    |> Enum.find(&(&1 != :ok))
    |> case do
      nil -> :ok
      err -> err
    end
  end

  # One HTTP call for one (template × workstation) pair.
  defp push_one(template, ws, sort_order \\ 0)

  defp push_one(%FormTemplate{trigger: trigger} = template, %Workstation{} = ws, sort_order)
       when trigger in @valid_triggers do
    with {:ok, url} <- fetch_url(),
         {:ok, token} <- fetch_token() do
      ws = Repo.preload(ws, equipment: :item)
      resolved = Resolver.resolve(template, ws)

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
        "sort_order" => sort_order || 0
      }

      payload =
        if trigger == "cleaning" do
          Map.put(payload, "workstation_cleaning_schedule", %{
            "last_cleaning_at" => encode_datetime(ws.last_cleaning_at),
            "next_cleaning_due_at" => encode_date(ws.next_cleaning_due_at)
          })
        else
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

      case Req.post(req) do
        {:ok, %Req.Response{status: status}} when status in 200..204 ->
          Logger.debug(
            "Forms.Publisher pushed #{template.trigger} template " <>
              "#{template.uuid} v#{template.version} to workstation " <>
              "#{ws.uuid} — #{status}"
          )

          :ok

        {:ok, %Req.Response{status: status, body: body}} ->
          Logger.warning(
            "Forms.Publisher push rejected by vita-perf " <>
              "(status=#{status}, template=#{template.uuid}, ws=#{ws.uuid}, " <>
              "body=#{inspect(body)})"
          )

          {:error, {:http, status, body}}

        {:error, reason} ->
          Logger.warning(
            "Forms.Publisher transport failure " <>
              "(template=#{template.uuid}, ws=#{ws.uuid}, " <>
              "reason=#{inspect(reason)})"
          )

          {:error, {:transport, reason}}
      end
    end
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
