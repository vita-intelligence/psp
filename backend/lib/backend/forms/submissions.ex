defmodule Backend.Forms.Submissions do
  @moduledoc """
  Boundary for the FormSubmission read model.

  Two responsibilities:

    * ``upsert_from_vp/2`` — receive one submission from the vp
      outbox and mirror it onto PSP, resolving cross-service uuids
      (workstation session, form template, workstation, equipment,
      submitter) into local FKs. Idempotent on
      ``(company_id, vp_response_id)``.

    * ``list/2`` + ``get_by_uuid/2`` — read model powering the
      ``/production/sessions`` audit page. All filters are additive
      and use the composite indexes on the mirror table.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Equipment.Equipment
  alias Backend.Forms.{FormTemplate, Submission}
  alias Backend.ListQueries
  alias Backend.Production.{Workstation, WorkstationSession}
  alias Backend.Repo

  @default_limit 25
  @max_limit 100

  @sort_spec {:submitted_at, :desc}

  # ── Reads ────────────────────────────────────────────────────────

  @doc """
  List submissions for a tenant, newest first, with additive filters.
  Keyset-paginated on ``(submitted_at desc, id desc)`` — no COUNT so
  the endpoint stays O(log n) regardless of table size.

  Filters (all optional):

    * ``:workstation_uuid``     — string uuid
    * ``:equipment_uuid``       — string uuid
    * ``:form_template_uuid``   — string uuid
    * ``:submitted_by_id``      — integer User.id
    * ``:submitted_by_uuid``    — string worker uuid (vp Worker.uuid)
    * ``:workstation_session_uuid`` — string uuid
    * ``:trigger``              — form trigger string
    * ``:activity_kind``        — mo / cleaning / maintenance / other
    * ``:from``                 — DateTime; keeps rows with submitted_at ≥ from
    * ``:to``                   — DateTime; keeps rows with submitted_at ≤ to
    * ``:search``               — substring match on form_name / submitted_by_name
    * ``:cursor``               — opaque continuation token
    * ``:limit``                — clamped to [1, #{@max_limit}]
  """
  def list(company_id, filters \\ %{}) when is_integer(company_id) do
    limit = clamp_limit(Map.get(filters, :limit))
    cursor = Map.get(filters, :cursor)

    base =
      Submission
      |> where([s], s.company_id == ^company_id)
      |> apply_filters(filters)
      |> ListQueries.apply_sort(@sort_spec, [:submitted_at, :id], @sort_spec)
      |> preload([
        :workstation,
        :equipment,
        :submitted_by,
        :form_template,
        workstation_session: [:manufacturing_order_step]
      ])

    {items, next_cursor} = ListQueries.paginate(Repo, base, @sort_spec, limit, cursor)

    %{items: items, next_cursor: next_cursor, limit: limit}
  end

  def get_by_uuid(company_id, uuid) when is_integer(company_id) and is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Submission
        |> where([s], s.company_id == ^company_id and s.uuid == ^cast)
        |> preload([
          :workstation,
          :equipment,
          :submitted_by,
          :form_template,
          workstation_session: [:manufacturing_order_step]
        ])
        |> Repo.one()

      _ ->
        nil
      end
  end

  @lookup_limit_default 20
  @lookup_limit_max 50

  @doc """
  Typeahead lookups for the four filter facets on the explorer page.

  ``type`` is one of ``:workstation | :equipment | :form | :submitter``.
  Params support:

    * ``:q``     — free-text needle, ilike-matched on the label field
    * ``:uuid``  — resolve exactly one row by uuid (used to hydrate the
                    chip label for a preselected filter without loading
                    the whole list)
    * ``:limit`` — 1..#{@lookup_limit_max}, default #{@lookup_limit_default}

  Returns a list of ``%{key, uuid, label, sublabel}`` maps ready for
  the FE combobox. ``key`` is the value the FE writes back to the
  URL — usually the uuid, but ``submitter`` returns ``"u:<id>"`` /
  ``"w:<uuid>"`` matching the existing filter contract.
  """
  def lookup(company_id, type, params \\ %{}) when is_integer(company_id) do
    q = trim(Map.get(params, :q))
    uuid = trim(Map.get(params, :uuid))
    limit = clamp_lookup_limit(Map.get(params, :limit))

    do_lookup(type, company_id, q, uuid, limit)
  end

  # ── Workstations ────────────────────────────────────────────────

  defp do_lookup(:workstation, company_id, q, uuid, limit) do
    base =
      from w in Workstation,
        where: w.company_id == ^company_id

    base
    |> maybe_filter_uuid(uuid)
    |> maybe_ilike(:name, q)
    |> order_by([w], asc: w.name)
    |> limit(^limit)
    |> select([w], %{uuid: w.uuid, name: w.name})
    |> Repo.all()
    |> Enum.map(fn w ->
      %{key: w.uuid, uuid: w.uuid, label: w.name, sublabel: nil}
    end)
  end

  # ── Equipment ───────────────────────────────────────────────────

  defp do_lookup(:equipment, company_id, q, uuid, limit) do
    base =
      from e in Equipment,
        where: e.company_id == ^company_id

    base
    |> maybe_filter_uuid(uuid)
    |> maybe_ilike_multi([:serial_number, :model, :manufacturer], q)
    |> order_by([e], asc: e.serial_number)
    |> limit(^limit)
    |> select([e], %{
      uuid: e.uuid,
      serial_number: e.serial_number,
      model: e.model,
      manufacturer: e.manufacturer
    })
    |> Repo.all()
    |> Enum.map(fn e ->
      label = e.serial_number || e.model || String.slice(e.uuid, 0, 8)
      sublabel = [e.manufacturer, e.model] |> Enum.reject(&is_nil/1) |> Enum.join(" · ")
      %{key: e.uuid, uuid: e.uuid, label: label, sublabel: emptystr_to_nil(sublabel)}
    end)
  end

  # ── Form templates ──────────────────────────────────────────────

  defp do_lookup(:form, company_id, q, uuid, limit) do
    base =
      from t in FormTemplate,
        where: t.company_id == ^company_id

    base
    |> maybe_filter_uuid(uuid)
    |> maybe_ilike(:name, q)
    |> order_by([t], asc: t.name)
    |> limit(^limit)
    |> select([t], %{uuid: t.uuid, name: t.name, trigger: t.trigger})
    |> Repo.all()
    |> Enum.map(fn t ->
      %{key: t.uuid, uuid: t.uuid, label: t.name, sublabel: t.trigger}
    end)
  end

  # ── Submitters (distinct from the mirror table) ─────────────────

  # Two flavours in the mirror: submissions with a resolved User
  # (``submitted_by_id`` set — keyed as ``u:<id>``), and submissions
  # where only the worker uuid landed (keyed as ``w:<worker_uuid>``).
  # The combobox writes the same ``key`` back to the URL, matching
  # the ``submitted_by_id`` / ``submitted_by_uuid`` filter contract.
  defp do_lookup(:submitter, company_id, q, uuid, limit) do
    base =
      from s in Submission,
        where: s.company_id == ^company_id and not is_nil(s.submitted_by_name)

    base = maybe_ilike(base, :submitted_by_name, q)

    # ``uuid`` resolves a preselected worker-uuid filter. Also accepts
    # the composite key ``u:<id>`` / ``w:<uuid>`` written to the URL by
    # the FE so the RSC can hydrate the picker label with the same key
    # it wrote.
    base = maybe_filter_submitter(base, uuid)

    from(s in base,
      distinct: true,
      select: %{
        user_id: s.submitted_by_id,
        worker_uuid: s.submitted_by_uuid,
        name: s.submitted_by_name
      },
      order_by: [asc: s.submitted_by_name],
      limit: ^limit
    )
    |> Repo.all()
    |> Enum.map(fn r ->
      key =
        cond do
          not is_nil(r.user_id) -> "u:#{r.user_id}"
          is_binary(r.worker_uuid) and r.worker_uuid != "" -> "w:#{r.worker_uuid}"
          true -> nil
        end

      %{key: key, uuid: r.worker_uuid, label: r.name, sublabel: nil}
    end)
    |> Enum.reject(&is_nil(&1.key))
  end

  defp do_lookup(_type, _company_id, _q, _uuid, _limit), do: []

  defp maybe_filter_uuid(query, nil), do: query
  defp maybe_filter_uuid(query, ""), do: query

  defp maybe_filter_uuid(query, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} -> where(query, [row], row.uuid == ^cast)
      _ -> query
    end
  end

  defp maybe_filter_submitter(query, nil), do: query
  defp maybe_filter_submitter(query, ""), do: query

  defp maybe_filter_submitter(query, "u:" <> id_str) do
    case Integer.parse(id_str) do
      {id, ""} -> where(query, [s], s.submitted_by_id == ^id)
      _ -> query
    end
  end

  defp maybe_filter_submitter(query, "w:" <> uuid),
    do: where(query, [s], s.submitted_by_uuid == ^uuid)

  defp maybe_filter_submitter(query, raw) when is_binary(raw) do
    # Bare uuid — treat as worker uuid (matches how the ``uuid=`` param
    # is used for the other three lookup types).
    where(query, [s], s.submitted_by_uuid == ^raw)
  end

  defp maybe_ilike(query, _field, nil), do: query
  defp maybe_ilike(query, _field, ""), do: query

  defp maybe_ilike(query, field, term) when is_binary(term) do
    needle = "%" <> escape_like(term) <> "%"
    where(query, [row], ilike(field(row, ^field), ^needle))
  end

  defp maybe_ilike_multi(query, _fields, nil), do: query
  defp maybe_ilike_multi(query, _fields, ""), do: query

  defp maybe_ilike_multi(query, fields, term) when is_binary(term) and is_list(fields) do
    needle = "%" <> escape_like(term) <> "%"

    or_clause =
      Enum.reduce(fields, false, fn field, dyn ->
        dynamic([row], ilike(field(row, ^field), ^needle) or ^dyn)
      end)

    from row in query, where: ^or_clause
  end

  defp escape_like(s) do
    s
    |> String.replace("\\", "\\\\")
    |> String.replace("%", "\\%")
    |> String.replace("_", "\\_")
  end

  defp trim(nil), do: nil
  defp trim(s) when is_binary(s), do: String.trim(s)
  defp trim(_), do: nil

  defp emptystr_to_nil(""), do: nil
  defp emptystr_to_nil(s), do: s

  defp clamp_lookup_limit(nil), do: @lookup_limit_default
  defp clamp_lookup_limit(n) when is_integer(n) and n > 0, do: min(@lookup_limit_max, n)

  defp clamp_lookup_limit(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} when n > 0 -> min(@lookup_limit_max, n)
      _ -> @lookup_limit_default
    end
  end

  defp clamp_lookup_limit(_), do: @lookup_limit_default

  # ── Writes ───────────────────────────────────────────────────────

  @doc """
  Upsert one submission from the vp outbox. ``attrs`` is the raw
  JSON payload — string keys.

  Resolves cross-service uuids to local FKs. Returns
  ``{:ok, submission}`` or ``{:error, reason}``.
  """
  def upsert_from_vp(company_id, %{} = attrs) when is_integer(company_id) do
    with {:ok, workstation} <- fetch_workstation(company_id, attrs["workstation_uuid"]),
         {:ok, template} <- fetch_template(company_id, attrs["form_template_uuid"]),
         {:ok, vp_response_id} <- parse_int(attrs["vp_response_id"], :vp_response_id),
         {:ok, submitted_at} <- parse_dt(attrs["submitted_at"], :submitted_at) do
      # These are best-effort resolutions — a submission with a
      # missing equipment / session / user still lands (so audit
      # data never gets dropped), just with a null FK.
      session = fetch_session(company_id, attrs["workstation_session_uuid"])
      equipment = fetch_equipment(company_id, attrs["equipment_uuid"])
      submitter = fetch_submitter(company_id, attrs["submitted_by_uuid"])

      insert_attrs = %{
        company_id: company_id,
        workstation_session_id: session && session.id,
        workstation_session_uuid: attrs["workstation_session_uuid"],
        form_template_id: template.id,
        form_template_uuid: template.uuid,
        form_name: template.name,
        form_trigger: attrs["form_trigger"] || template.trigger,
        schema_snapshot: attrs["schema_snapshot"] || template.schema,
        schema_version: attrs["schema_version"] || template.version,
        workstation_id: workstation.id,
        workstation_uuid: workstation.uuid,
        equipment_id: equipment && equipment.id,
        equipment_uuid: attrs["equipment_uuid"],
        activity_kind: attrs["activity_kind"],
        submitted_by_id: submitter && submitter.id,
        submitted_by_uuid: attrs["submitted_by_uuid"],
        submitted_by_name: attrs["submitted_by_name"],
        submitted_at: submitted_at,
        answers: attrs["answers"] || %{},
        vp_response_id: vp_response_id
      }

      case Repo.get_by(Submission, company_id: company_id, vp_response_id: vp_response_id) do
        %Submission{} = existing ->
          existing
          |> Submission.create_changeset(insert_attrs)
          |> Repo.update()

        nil ->
          %Submission{}
          |> Submission.create_changeset(insert_attrs)
          |> Repo.insert()
      end
    end
  end

  # ── Filter application ───────────────────────────────────────────

  defp apply_filters(query, filters) do
    query
    |> maybe_uuid(:workstation_uuid, filters)
    |> maybe_uuid(:equipment_uuid, filters)
    |> maybe_uuid(:form_template_uuid, filters)
    |> maybe_uuid(:workstation_session_uuid, filters)
    |> maybe_int(:submitted_by_id, filters)
    |> maybe_str(:submitted_by_uuid, filters)
    |> maybe_trigger(filters)
    |> maybe_activity_kind(filters)
    |> maybe_from(filters)
    |> maybe_to(filters)
    |> maybe_search(filters)
  end

  defp maybe_uuid(query, key, filters) do
    case Map.get(filters, key) do
      nil ->
        query

      "" ->
        query

      raw when is_binary(raw) ->
        case Ecto.UUID.cast(raw) do
          {:ok, cast} -> where(query, [s], field(s, ^key) == ^cast)
          _ -> query
        end

      _ ->
        query
    end
  end

  defp maybe_int(query, key, filters) do
    case Map.get(filters, key) do
      nil ->
        query

      "" ->
        query

      val when is_integer(val) ->
        where(query, [s], field(s, ^key) == ^val)

      raw when is_binary(raw) ->
        case Integer.parse(raw) do
          {n, ""} -> where(query, [s], field(s, ^key) == ^n)
          _ -> query
        end

      _ ->
        query
    end
  end

  defp maybe_str(query, key, filters) do
    case Map.get(filters, key) do
      raw when is_binary(raw) and raw != "" ->
        where(query, [s], field(s, ^key) == ^raw)

      _ ->
        query
    end
  end

  defp maybe_trigger(query, filters) do
    case Map.get(filters, :trigger) do
      raw when is_binary(raw) and raw != "" ->
        if raw in FormTemplate.triggers() do
          where(query, [s], s.form_trigger == ^raw)
        else
          query
        end

      _ ->
        query
    end
  end

  defp maybe_activity_kind(query, filters) do
    case Map.get(filters, :activity_kind) do
      raw when is_binary(raw) and raw != "" ->
        if raw in Submission.activity_kinds() do
          where(query, [s], s.activity_kind == ^raw)
        else
          query
        end

      _ ->
        query
    end
  end

  defp maybe_from(query, filters) do
    case coerce_dt(Map.get(filters, :from)) do
      %DateTime{} = dt -> where(query, [s], s.submitted_at >= ^dt)
      _ -> query
    end
  end

  defp maybe_to(query, filters) do
    case coerce_dt(Map.get(filters, :to)) do
      %DateTime{} = dt -> where(query, [s], s.submitted_at <= ^dt)
      _ -> query
    end
  end

  defp maybe_search(query, filters) do
    case Map.get(filters, :search) do
      raw when is_binary(raw) and raw != "" ->
        term = "%" <> String.trim(raw) <> "%"
        where(query, [s], ilike(s.form_name, ^term) or ilike(s.submitted_by_name, ^term))

      _ ->
        query
    end
  end

  # ── Resolvers ────────────────────────────────────────────────────

  defp fetch_workstation(_company_id, nil), do: {:error, :missing_workstation_uuid}
  defp fetch_workstation(_company_id, ""), do: {:error, :missing_workstation_uuid}

  defp fetch_workstation(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        case Repo.get_by(Workstation, company_id: company_id, uuid: cast) do
          %Workstation{} = ws -> {:ok, ws}
          nil -> {:error, :workstation_not_found}
        end

      _ ->
        {:error, :invalid_workstation_uuid}
    end
  end

  defp fetch_workstation(_company_id, _), do: {:error, :invalid_workstation_uuid}

  defp fetch_template(_company_id, nil), do: {:error, :missing_form_template_uuid}
  defp fetch_template(_company_id, ""), do: {:error, :missing_form_template_uuid}

  defp fetch_template(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        case Repo.get_by(FormTemplate, company_id: company_id, uuid: cast) do
          %FormTemplate{} = t -> {:ok, t}
          nil -> {:error, :form_template_not_found}
        end

      _ ->
        {:error, :invalid_form_template_uuid}
    end
  end

  defp fetch_template(_company_id, _), do: {:error, :invalid_form_template_uuid}

  # Nullable resolvers — return the row if found, nil otherwise. A
  # missing parent session or a not-yet-mirrored user doesn't block
  # the submission itself from landing.
  defp fetch_session(_company_id, nil), do: nil
  defp fetch_session(_company_id, ""), do: nil

  defp fetch_session(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} -> Repo.get_by(WorkstationSession, company_id: company_id, uuid: cast)
      _ -> nil
    end
  end

  defp fetch_session(_company_id, _), do: nil

  defp fetch_equipment(_company_id, nil), do: nil
  defp fetch_equipment(_company_id, ""), do: nil

  defp fetch_equipment(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} -> Repo.get_by(Equipment, company_id: company_id, uuid: cast)
      _ -> nil
    end
  end

  defp fetch_equipment(_company_id, _), do: nil

  # Worker uuid is the vp Worker.uuid mirrored via Employee.external_id
  # on PSP. Resolve through Employee → User.
  defp fetch_submitter(_company_id, nil), do: nil
  defp fetch_submitter(_company_id, ""), do: nil

  defp fetch_submitter(company_id, uuid) when is_binary(uuid) do
    from(u in User,
      join: e in Backend.HR.Employee,
      on: e.user_id == u.id,
      where: e.company_id == ^company_id and e.external_id == ^uuid
    )
    |> Repo.one()
  end

  defp fetch_submitter(_company_id, _), do: nil

  # ── Coercers ─────────────────────────────────────────────────────

  defp parse_int(nil, key), do: {:error, {:missing, key}}
  defp parse_int("", key), do: {:error, {:missing, key}}
  defp parse_int(n, _key) when is_integer(n), do: {:ok, n}

  defp parse_int(s, key) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} -> {:ok, n}
      _ -> {:error, {:invalid, key}}
    end
  end

  defp parse_int(_, key), do: {:error, {:invalid, key}}

  defp parse_dt(nil, key), do: {:error, {:missing, key}}
  defp parse_dt("", key), do: {:error, {:missing, key}}
  defp parse_dt(%DateTime{} = dt, _key), do: {:ok, DateTime.truncate(dt, :second)}

  defp parse_dt(s, key) when is_binary(s) do
    case DateTime.from_iso8601(s) do
      {:ok, dt, _} -> {:ok, DateTime.truncate(dt, :second)}
      _ -> {:error, {:invalid, key}}
    end
  end

  defp parse_dt(_, key), do: {:error, {:invalid, key}}

  defp coerce_dt(nil), do: nil
  defp coerce_dt(%DateTime{} = dt), do: dt

  defp coerce_dt(s) when is_binary(s) and s != "" do
    case DateTime.from_iso8601(s) do
      {:ok, dt, _} -> dt
      _ -> nil
    end
  end

  defp coerce_dt(_), do: nil

  defp clamp_limit(nil), do: @default_limit
  defp clamp_limit(n) when is_integer(n) and n > 0, do: min(@max_limit, n)

  defp clamp_limit(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} when n > 0 -> min(@max_limit, n)
      _ -> @default_limit
    end
  end

  defp clamp_limit(_), do: @default_limit
end
