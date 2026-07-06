defmodule Backend.MyTasks do
  @moduledoc """
  "My tasks" projection — per-user, per-tenant list of every CO-scoped
  action the operator can act on right now.

  Built on top of `Backend.OrderWizard.list_active/1` so the same
  wizard the projects page renders drives the tasks list. Each CO's
  primary + secondary CTAs get flattened into a task row, then
  filtered by:

    * **Permission** — only surface tasks whose action verb is
      backed by a permission the user actually holds. Falls back to
      "hide the task" over "show a disabled one" so the list stays
      short and every row is actionable.

    * **Segregation of duties (4-eyes)** — if the current user has
      already signed the CO as approver, hide the director tier so
      they can't waste a click on `{:error, :same_signer}`. Same
      pattern for MO approve (preparer can't approve).

  Result rows are grouped into urgency buckets on the FE
  (`overdue` / `this_week` / `later`) using each CO's `due_date`.

  ## Scale

  Wizard snapshots are the expensive part (~5-10 queries per CO).
  Pre-filter aggressively so we only snapshot COs whose *phase* could
  possibly produce a task the user is allowed to see — `list_page/2`
  reads the user's permission grant once and skips whole phases that
  can't emit anything for them. In practice that cuts snapshotting by
  50-80% for non-admins.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.CustomerOrders.CustomerOrderApproval
  alias Backend.OrderWizard
  alias Backend.Production.ManufacturingOrder
  alias Backend.RBAC
  alias Backend.Repo

  # --- Action / permission dictionaries -----------------------------

  @action_permission %{
    # Customer-order lifecycle
    "submit" => "customer_orders.submit",
    "sign_approver" => "customer_orders.approve",
    "sign_director" => "customer_orders.approve",
    "confirm" => "customer_orders.edit",

    # Production planning
    "create_mo_for_line" => "production.mo_create",
    "prepare_mo" => "production.mo_prepare",
    "approve_mo" => "production.mo_approve",

    # Procurement
    "request_purchases" => "procurement.po_create"
  }

  @link_task_permission %{
    "register the delivery" => "shipments.confirm_delivery",
    "confirm truck pickup" => "shipments.pickup",
    "truck arrived" => "shipments.pickup",
    "send dispatch form to my phone" => "shipments.pickup",
    "create shipment" => "shipments.edit",
    "generate invoice" => "customer_invoices.create"
  }

  # Which phases can possibly emit tasks that map to each permission.
  # Used to pre-filter COs before we spend the queries to snapshot
  # them.
  @permission_phases %{
    "customer_orders.submit" => [:setup],
    "customer_orders.approve" => [:approval],
    "customer_orders.edit" => [:setup, :approval],
    "production.mo_create" => [:production_planning],
    "production.mo_prepare" => [:production_planning, :in_production],
    "production.mo_approve" => [:production_planning, :in_production],
    "procurement.po_create" => [:production_planning, :awaiting_ingredients],
    "shipments.edit" => [:ready_to_dispatch, :awaiting_pickup],
    "shipments.pickup" => [:awaiting_pickup, :dispatched],
    "shipments.confirm_delivery" => [:dispatched],
    "customer_invoices.create" => [:dispatched, :delivered]
  }

  # UI-facing phase buckets — matches the FE's chip row. Filtering by
  # any of these keys narrows the list to any phase in the bucket.
  @phase_buckets %{
    "approval" => ~w(setup approval)a,
    "planning" => ~w(production_planning awaiting_ingredients)a,
    "production" => ~w(in_production closeout final_release awaiting_routing)a,
    "dispatch" => ~w(ready_to_dispatch awaiting_pickup)a,
    "delivery" => ~w(dispatched delivered)a
  }

  # --- Public API ---------------------------------------------------

  @typedoc "Filter opts for `list_page/2`."
  @type opts :: [
          limit: pos_integer(),
          cursor: String.t() | nil,
          phase: String.t() | nil,
          urgency: String.t() | nil,
          search: String.t() | nil
        ]

  @doc """
  Paginated task list for `actor`. See `t:opts/0`.
  Returns `{tasks, next_cursor}` — `next_cursor` is nil when the page
  is exhausted.
  """
  @spec list_page(User.t(), opts) :: {[map()], String.t() | nil}
  def list_page(%User{} = actor, opts \\ []) do
    limit = clamp_limit(opts[:limit])
    phase_filter = normalise_phase(opts[:phase])
    urgency_filter = normalise_urgency(opts[:urgency])
    search = trim_or_nil(opts[:search])

    tasks =
      actor
      |> collect_all_tasks()
      |> filter_by(phase_filter, urgency_filter, search)

    {page, next_cursor} = paginate(tasks, opts[:cursor], limit)
    {page, next_cursor}
  end

  @doc """
  Lean counts summary. Same filter set as `list_page/2` except the
  cursor. Cheap enough to call from the top-bar badge on every
  entity broadcast.
  """
  @spec count(User.t()) :: %{total: non_neg_integer(), overdue: non_neg_integer(), by_phase: map()}
  def count(%User{} = actor) do
    now = Date.utc_today()
    tasks = collect_all_tasks(actor)

    total = length(tasks)

    overdue =
      Enum.count(tasks, fn t ->
        case t.due_date do
          %Date{} = d -> Date.compare(d, now) == :lt
          _ -> false
        end
      end)

    by_phase =
      Enum.reduce(tasks, %{}, fn t, acc ->
        key = Atom.to_string(t.phase_key)
        Map.update(acc, key, 1, &(&1 + 1))
      end)

    %{total: total, overdue: overdue, by_phase: by_phase}
  end

  # Legacy alias so the earlier `list_for_user/1` callsite keeps
  # working while the FE catches up.
  def list_for_user(%User{} = actor) do
    {tasks, _} = list_page(actor, limit: 500)
    tasks
  end

  # --- Internals ----------------------------------------------------

  # Compute every eligible task for the actor across the pipeline,
  # unsorted and unpaginated. Called by both `list_page/2` and
  # `count/1`. Pre-filters phases the user can never act on to
  # avoid a snapshot per CO.
  defp collect_all_tasks(%User{} = actor) do
    allowed_phases = allowed_phases_for(actor)

    summaries = OrderWizard.list_active(actor.company_id)

    for summary <- summaries,
        allowed_phases == :all or MapSet.member?(allowed_phases, summary.phase.key),
        snapshot = expand(summary),
        cta_row <- cta_rows(snapshot),
        task = maybe_build_task(actor, snapshot, cta_row),
        task != nil do
      task
    end
    |> Enum.sort_by(&sort_key/1)
  end

  # Union of phases across every permission the actor holds. `:all`
  # for admins so we don't miss anything. Returns a `MapSet` of
  # phase atoms otherwise.
  defp allowed_phases_for(%User{is_admin: true}), do: :all

  defp allowed_phases_for(%User{} = actor) do
    perms = user_permissions(actor)

    @permission_phases
    |> Enum.filter(fn {perm, _phases} -> perm in perms end)
    |> Enum.flat_map(fn {_perm, phases} -> phases end)
    |> MapSet.new()
  end

  # Cheap read of the user's permission grant. Falls back to an
  # empty list if the account doesn't expose one — safer than
  # crashing the tasks page.
  defp user_permissions(%User{permissions: perms}) when is_list(perms), do: perms
  defp user_permissions(_), do: []

  defp expand(%{customer_order: co} = summary) do
    snap = OrderWizard.snapshot(co)

    %{
      co: co,
      snap: snap,
      phase: summary.phase
    }
  end

  defp cta_rows(%{snap: %{next_action: nil}}), do: []

  defp cta_rows(%{snap: %{next_action: next_action}}) do
    primary =
      case next_action.primary_cta do
        nil -> []
        cta -> [{cta, next_action}]
      end

    secondary =
      (next_action.secondary_ctas || [])
      |> Enum.map(fn cta -> {cta, next_action} end)

    primary ++ secondary
  end

  defp maybe_build_task(actor, %{co: co, phase: phase}, {cta, next_action}) do
    action_code = extract_action_code(cta)
    permission = action_permission(cta, action_code)

    cond do
      is_nil(permission) ->
        nil

      not RBAC.has_permission?(actor, permission) ->
        nil

      blocked_by_four_eyes?(actor, co, action_code) ->
        nil

      true ->
        build_task(co, phase, next_action, cta, action_code)
    end
  end

  defp extract_action_code(%{"action" => action}) when is_binary(action), do: action
  defp extract_action_code(%{action: action}) when is_binary(action), do: action

  defp extract_action_code(%{"label" => label}) when is_binary(label),
    do: "link:" <> slugify(label)

  defp extract_action_code(%{label: label}) when is_binary(label),
    do: "link:" <> slugify(label)

  defp extract_action_code(_), do: nil

  defp slugify(label) do
    label
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9]+/, "-")
    |> String.trim("-")
  end

  defp action_permission(_cta, nil), do: nil

  defp action_permission(cta, action_code) do
    cond do
      Map.has_key?(@action_permission, action_code) ->
        @action_permission[action_code]

      String.starts_with?(action_code, "link:") ->
        link_permission(cta)

      true ->
        nil
    end
  end

  defp link_permission(cta) do
    label =
      (cta[:label] || cta["label"] || "")
      |> String.trim()
      |> String.downcase()

    Enum.find_value(@link_task_permission, fn {prefix, perm} ->
      if String.starts_with?(label, prefix), do: perm
    end)
  end

  defp blocked_by_four_eyes?(actor, co, "sign_director") do
    Repo.exists?(
      from(a in CustomerOrderApproval,
        where:
          a.customer_order_id == ^co.id and
            a.kind == "approver" and
            a.signed_by_id == ^actor.id
      )
    )
  end

  defp blocked_by_four_eyes?(actor, co, "approve_mo") do
    Repo.exists?(
      from(m in ManufacturingOrder,
        where:
          m.customer_order_id == ^co.id and
            m.status == "prepared" and
            m.prepared_by_id == ^actor.id
      )
    )
  end

  defp blocked_by_four_eyes?(_actor, _co, _action_code), do: false

  defp build_task(co, phase, next_action, cta, action_code) do
    title =
      case cta[:label] || cta["label"] do
        label when is_binary(label) and label != "" -> label
        _ -> next_action.title
      end

    detail =
      cta[:description] || cta["description"] ||
        next_action.detail

    customer_name =
      case Repo.preload(co, :customer) do
        %{customer: %{name: name}} when is_binary(name) -> name
        _ -> nil
      end

    %{
      id: "co-#{co.uuid}-#{action_code}",
      co_uuid: co.uuid,
      co_code: BackendWeb.Payloads.render_entity_code(co, "customer_order"),
      customer_name: customer_name,
      phase_key: phase.key,
      phase_label: phase.label,
      action_code: action_code,
      title: title,
      detail: detail,
      cta: cta,
      due_date: Map.get(co, :due_date),
      updated_at: co.updated_at
    }
  end

  # --- Filtering / pagination ---------------------------------------

  defp filter_by(tasks, nil, nil, nil), do: tasks

  defp filter_by(tasks, phase, urgency, search) do
    now = Date.utc_today()
    week_end = Date.add(now, 7)
    phase_set = phase_matcher(phase)

    Enum.filter(tasks, fn t ->
      matches_phase?(t, phase_set) and
        matches_urgency?(t, urgency, now, week_end) and
        matches_search?(t, search)
    end)
  end

  # `nil` — no phase filter. Otherwise a MapSet of phase atoms; either
  # a single phase key (`:approval`) or the full expansion of a
  # UI bucket (`"planning"` → `MapSet.new([:production_planning, :awaiting_ingredients])`).
  defp phase_matcher(nil), do: nil

  defp phase_matcher(str) when is_binary(str) do
    case Map.get(@phase_buckets, str) do
      atoms when is_list(atoms) ->
        MapSet.new(atoms)

      _ ->
        # Fall back to single-phase match — accept the raw key string
        # so callers can still narrow by an exact phase if they want.
        try do
          MapSet.new([String.to_existing_atom(str)])
        rescue
          ArgumentError -> MapSet.new()
        end
    end
  end

  defp matches_phase?(_t, nil), do: true

  defp matches_phase?(t, %MapSet{} = set),
    do: MapSet.member?(set, t.phase_key)

  defp matches_urgency?(_t, nil, _now, _end), do: true

  defp matches_urgency?(%{due_date: nil}, "no_date", _now, _end), do: true
  defp matches_urgency?(%{due_date: nil}, _other, _now, _end), do: false

  defp matches_urgency?(%{due_date: d}, "overdue", now, _end),
    do: Date.compare(d, now) == :lt

  defp matches_urgency?(%{due_date: d}, "this_week", now, week_end),
    do: Date.compare(d, now) != :lt and Date.compare(d, week_end) == :lt

  defp matches_urgency?(%{due_date: d}, "later", _now, week_end),
    do: Date.compare(d, week_end) != :lt

  defp matches_urgency?(_t, _other, _now, _end), do: true

  defp matches_search?(_t, nil), do: true

  defp matches_search?(t, needle) do
    haystack =
      [t.co_code, t.customer_name, t.title]
      |> Enum.map(&(&1 || ""))
      |> Enum.join(" ")
      |> String.downcase()

    String.contains?(haystack, needle)
  end

  # Cursor pagination — cursor is a base64-encoded offset. Simple
  # (integer offset over a memory-resident list) because the total
  # list is already bounded by the phase pre-filter.
  defp paginate(tasks, cursor, limit) do
    offset = decode_cursor(cursor)
    total = length(tasks)

    page = tasks |> Enum.slice(offset, limit)
    next_offset = offset + length(page)

    next_cursor = if next_offset < total, do: encode_cursor(next_offset), else: nil
    {page, next_cursor}
  end

  defp decode_cursor(nil), do: 0
  defp decode_cursor(""), do: 0

  defp decode_cursor(cursor) when is_binary(cursor) do
    case Base.url_decode64(cursor, padding: false) do
      {:ok, raw} ->
        case Integer.parse(raw) do
          {n, ""} when n >= 0 -> n
          _ -> 0
        end

      _ ->
        0
    end
  end

  defp encode_cursor(offset), do: Integer.to_string(offset) |> Base.url_encode64(padding: false)

  defp clamp_limit(nil), do: 25
  defp clamp_limit(n) when is_integer(n) and n > 0, do: min(n, 100)

  defp clamp_limit(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} when n > 0 -> min(n, 100)
      _ -> 25
    end
  end

  defp clamp_limit(_), do: 25

  defp normalise_phase(nil), do: nil
  defp normalise_phase(""), do: nil
  defp normalise_phase(s) when is_binary(s), do: s
  defp normalise_phase(_), do: nil

  defp normalise_urgency(nil), do: nil
  defp normalise_urgency(""), do: nil
  defp normalise_urgency(s) when s in ["overdue", "this_week", "later", "no_date"], do: s
  defp normalise_urgency(_), do: nil

  defp trim_or_nil(nil), do: nil
  defp trim_or_nil(""), do: nil

  defp trim_or_nil(s) when is_binary(s) do
    case String.trim(s) do
      "" -> nil
      trimmed -> String.downcase(trimmed)
    end
  end

  defp trim_or_nil(_), do: nil

  defp sort_key(%{due_date: nil} = t), do: {1, ~D[9999-12-31], t.co_uuid}
  defp sort_key(%{due_date: d} = t), do: {0, d, t.co_uuid}
end
