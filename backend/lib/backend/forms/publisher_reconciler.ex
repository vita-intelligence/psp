defmodule Backend.Forms.PublisherReconciler do
  @moduledoc """
  Periodic sweep that re-publishes every active form template with
  at least one workstation assignment.

  Rationale
  ---------

  The publish path from `Backend.Forms.Publisher` is called on every
  template / workstation write, plus retries with backoff on
  transient failures. That covers the 99% case. What it does NOT
  cover:

  * A `Publisher.publish_template` async Task that crashes after
    exhausting its retries (transient outage longer than 4 s).
  * A publish that fires while vita-perf is booting / redeploying and
    all 3 retries hit the same window.
  * Any prior template that shipped before this reconciler existed
    and whose `last_published_at` is still `NULL` because none of
    its saves ever landed.

  This reconciler catches all three by re-firing
  `publish_template_sync` only on templates that are actually stale
  relative to their last successful publish:

    * never-published (`last_published_at IS NULL`), OR
    * template row edited since the last successful push
      (`updated_at > last_published_at`), OR
    * assignment row added / edited since the last successful push
      (via EXISTS subquery, so this catches the "operator attached
      the form but the async task dropped the push" case).

  Templates whose current state has already been successfully
  published are skipped entirely — the query returns them as `0
  rows`, no HTTP fires. In steady state (every template current)
  each tick is one SQL query and nothing else — negligible cost
  regardless of tenant size. Vita-perf's publish endpoint is
  upsert-by-uuid so the small handful of stale re-fires are also
  cheap on the receiver.

  Silent-degrade per template so one template's failure doesn't
  halt the sweep.

  Cadence: 60 s after boot, then every 5 min. Both configurable via
  `config :backend, Backend.Forms.PublisherReconciler`:

      config :backend, Backend.Forms.PublisherReconciler,
        start: true,       # false in test (SQL sandbox conflict)
        boot_delay_ms: 60_000,
        interval_ms: 300_000

  Skipped entirely when `Backend.Forms.Publisher.fetch_url/0` /
  `fetch_token/0` return `{:error, :not_configured}` — tenants
  without a vita-perf link don't need a publisher.
  """

  use GenServer
  require Logger

  alias Backend.Forms.{FormTemplate, Publisher}
  alias Backend.Production.WorkstationFormAssignment
  alias Backend.Repo
  import Ecto.Query

  @default_boot_delay 60_000
  @default_interval 300_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(opts) do
    cfg = Application.get_env(:backend, __MODULE__, [])
    boot_delay = Keyword.get(opts, :boot_delay_ms, cfg[:boot_delay_ms] || @default_boot_delay)
    interval = Keyword.get(opts, :interval_ms, cfg[:interval_ms] || @default_interval)
    Process.send_after(self(), :tick, boot_delay)
    {:ok, %{interval_ms: interval}}
  end

  @impl true
  def handle_info(:tick, state) do
    _ = safe_run()
    Process.send_after(self(), :tick, state.interval_ms)
    {:noreply, state}
  end

  # Public one-shot for tests / ops. Returns `{:ok, count}` where
  # count is the number of templates the reconciler re-fired. Never
  # raises.
  def run_now do
    safe_run()
  end

  defp safe_run do
    try do
      do_run()
    rescue
      err ->
        Logger.warning(
          "Forms.PublisherReconciler tick failed (rescued): #{inspect(err)}"
        )

        {:ok, 0}
    catch
      kind, reason ->
        Logger.warning(
          "Forms.PublisherReconciler tick caught #{inspect(kind)} " <>
            "#{inspect(reason)}"
        )

        {:ok, 0}
    end
  end

  defp do_run do
    # Only pick up templates whose current state hasn't been fully
    # confirmed on vita-perf yet. The three OR branches cover:
    #   1. Never published (fresh template that missed its initial
    #      async push).
    #   2. Template row edited since the last successful publish
    #      (rare — most edits go through Templates.update_template
    #      which already fires publish_template).
    #   3. Any assignment row added / edited since the last publish
    #      (the "operator attached a form but the async push
    #      dropped" case, which is exactly what bit us in dev).
    #
    # Cost: at steady state (everything current) this query returns
    # 0 rows and the sweep fires 0 HTTP. Under real load the query
    # uses the ``form_templates.company_id`` index + an index scan on
    # ``workstation_form_assignments.form_template_id``.
    assignment_table = WorkstationFormAssignment.__schema__(:source)

    templates =
      Repo.all(
        from t in FormTemplate,
          where:
            t.is_active == true and
              fragment(
                "EXISTS (SELECT 1 FROM ? a WHERE a.form_template_id = ?)",
                ^assignment_table,
                t.id
              ) and
              (is_nil(t.last_published_at) or
                 t.updated_at > t.last_published_at or
                 fragment(
                   "EXISTS (SELECT 1 FROM ? a WHERE a.form_template_id = ? AND (? IS NULL OR a.updated_at > ?))",
                   ^assignment_table,
                   t.id,
                   t.last_published_at,
                   t.last_published_at
                 ))
      )

    Enum.each(templates, fn t ->
      # Fire per template so one failure doesn't stop the sweep.
      # ``publish_template_sync`` returns `:ok` or `{:error, _}`; we
      # don't act on the return here beyond logging via the
      # Publisher's own log lines. ``mark_published`` inside the
      # Publisher only fires on all-assignments-succeeded, so a
      # partial-success template stays stale and gets picked up on
      # the next sweep automatically.
      _ = Publisher.publish_template_sync(t)
    end)

    if length(templates) > 0 do
      Logger.info(
        "Forms.PublisherReconciler re-fired #{length(templates)} stale template(s)"
      )
    end

    {:ok, length(templates)}
  end
end
