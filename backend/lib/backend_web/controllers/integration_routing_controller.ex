defmodule BackendWeb.IntegrationRoutingController do
  @moduledoc """
  Write-side endpoint for pushing a Routing snapshot from an upstream
  R&D system (NPD today). One HTTP verb — `PUT /api/integration/
  items/:uuid/routing` — upserts the routing attached to the target
  Item + wholesale-replaces its ordered step list inside a single
  transaction (matches PSP's own detail-page semantics — the step
  list is replaced atomically on every save).

  Actor: the integration token's `created_by` user. Ties the audit
  row to the human who minted the token, not a synthetic account.

  Upsert key: `(company_id, item_id, name)`. NPD picks a stable name
  per formulation stage so subsequent pushes hit the same routing
  row and just replace its steps. If no `name` is supplied and no
  routing exists yet, PSP defaults to ``"<item.name> — Routing"``.

  Payload shape (JSON):

      {
        "name": "Powder Blend — Routing",       // optional
        "notes": "Auto-pushed from NPD",        // optional
        "steps": [
          {
            "workstation_group_uuid": "...",   // required
            "sort_order": 0,                    // optional (0-indexed)
            "operation_description": "Blend",   // optional
            "setup_time_min": "5",              // optional (Decimal)
            "cycle_time_min": "45",             // optional (Decimal)
            "fixed_cost": "0",                  // optional (Decimal)
            "variable_cost": "0",               // optional (Decimal)
            "capacity": "1"                     // optional (Decimal > 0)
          }
        ]
      }

  Item must be `finished_product` or `semi_finished` — matches PSP's
  own "routings target BOMmable items only" gate.

  Returns `{"routing": {"uuid": "...", "step_count": N}}` on 200.
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.Accounts.User
  alias Backend.Items.Item
  alias Backend.Production
  alias Backend.Production.Routing
  alias Backend.Repo

  plug :require_integration_scope, "routing:write" when action == :upsert
  plug :require_integration_scope, "routing:read" when action == :list_templates

  @doc """
  List template routings (`item_id IS NULL`) available to NPD's
  formulation builder stage picker. Returns the full step shape per
  template so NPD can hydrate stages one-per-step without a second
  round-trip.

      {"templates": [
        {
          "uuid": "...",
          "name": "Capsule — standard",
          "notes": "...",
          "is_active": true,
          "steps": [
            {
              "uuid": "...",
              "sort_order": 0,
              "operation_description": "Blend",
              "setup_time_min": "5",
              "cycle_time_min": "45",
              "capacity": "1",
              "fixed_cost": "0",
              "variable_cost": "0",
              "workstation_group_uuid": "...",
              "workstation_group_name": "Powder Blender",
              "workstation_group_color": "#aab7f9"
            }, ...
          ]
        }, ...
      ]}
  """
  def list_templates(conn, _params) do
    company_id = conn.assigns.current_company_id

    templates =
      company_id
      |> Production.list_routing_templates()
      |> Enum.filter(& &1.is_active)
      |> Enum.map(&template_payload/1)

    json(conn, %{templates: templates})
  end

  defp template_payload(%Routing{} = r) do
    %{
      uuid: r.uuid,
      name: r.name,
      notes: r.notes,
      is_active: r.is_active,
      other_fixed_cost: decimal_str(r.other_fixed_cost),
      other_variable_cost: decimal_str(r.other_variable_cost),
      other_variable_cost_basis: decimal_str(r.other_variable_cost_basis),
      steps: Enum.map(r.steps, &template_step_payload/1)
    }
  end

  defp template_step_payload(step) do
    %{
      uuid: step.uuid,
      sort_order: step.sort_order,
      operation_description: step.operation_description,
      setup_time_min: decimal_str(step.setup_time_min),
      cycle_time_min: decimal_str(step.cycle_time_min),
      capacity: decimal_str(step.capacity),
      fixed_cost: decimal_str(step.fixed_cost),
      variable_cost: decimal_str(step.variable_cost),
      workstation_group_uuid:
        case step.workstation_group do
          %{uuid: u} -> u
          _ -> nil
        end,
      workstation_group_name:
        case step.workstation_group do
          %{name: n} -> n
          _ -> nil
        end,
      workstation_group_color:
        case step.workstation_group do
          %{color: c} -> c
          _ -> nil
        end
    }
  end

  defp decimal_str(nil), do: nil
  defp decimal_str(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp decimal_str(other), do: to_string(other)

  def upsert(conn, %{"uuid" => item_uuid} = params) do
    company_id = conn.assigns.current_company_id
    token = conn.assigns.current_integration_token

    with %Item{} = item <- fetch_item(company_id, item_uuid),
         :ok <- ensure_bommable(item),
         %User{} = actor <- fetch_actor(token),
         {:ok, source_template_id} <-
           resolve_source_template(company_id, params["source_template_uuid"]),
         {:ok, resolved_steps} <- translate_steps(company_id, params["steps"]) do
      name = normalise_name(params["name"], item)
      notes = params["notes"]

      overhead = %{
        "other_fixed_cost" => params["other_fixed_cost"],
        "other_variable_cost" => params["other_variable_cost"],
        "other_variable_cost_basis" => params["other_variable_cost_basis"],
        "source_template_id" => source_template_id
      }

      run_upsert(conn, actor, item, name, notes, resolved_steps, overhead)
    else
      {:error, code, detail} -> unprocessable(conn, code, detail)
      nil -> unprocessable(conn, "item_not_found", item_uuid)
    end
  end

  defp resolve_source_template(_company_id, nil), do: {:ok, nil}
  defp resolve_source_template(_company_id, ""), do: {:ok, nil}

  defp resolve_source_template(company_id, uuid) when is_binary(uuid) do
    case Repo.one(
           from r in Routing,
             where:
               r.company_id == ^company_id and r.uuid == ^uuid and
                 is_nil(r.item_id),
             select: r.id
         ) do
      nil -> {:error, "source_template_not_found", uuid}
      id -> {:ok, id}
    end
  end

  defp resolve_source_template(_company_id, other),
    do: {:error, "source_template_uuid_invalid", inspect(other)}

  # ---- internals ----

  defp run_upsert(conn, actor, item, name, notes, steps_attrs, overhead) do
    # Only forward non-nil overhead so update calls don't clobber
    # operator-set values with a re-push that didn't include them.
    attrs =
      %{
        "name" => name,
        "notes" => notes,
        "steps" => steps_attrs
      }
      |> Map.merge(
        overhead
        |> Enum.reject(fn {_k, v} -> is_nil(v) end)
        |> Map.new()
      )

    result =
      case existing_routing(actor.company_id, item.id, name) do
        nil ->
          Production.create_routing(actor, Map.put(attrs, "item_id", item.id))

        %Routing{} = routing ->
          Production.update_routing(actor, routing, attrs)
      end

    case result do
      {:ok, routing} ->
        step_count = length(Map.get(routing, :steps) || [])

        conn
        |> put_status(:ok)
        |> json(%{routing: %{uuid: routing.uuid, step_count: step_count}})

      {:error, %Ecto.Changeset{} = cs} ->
        unprocessable(conn, "validation_failed", format_changeset(cs))

      {:error, {:step_failed, idx, cs}} ->
        unprocessable(
          conn,
          "step_validation_failed",
          "step[#{idx}]: " <> format_changeset(cs)
        )

      {:error, reason} when is_atom(reason) ->
        unprocessable(conn, to_string(reason), nil)

      {:error, reason} ->
        unprocessable(conn, "unknown_error", inspect(reason))
    end
  end

  defp fetch_item(company_id, uuid) when is_binary(uuid) do
    Repo.one(
      from i in Item,
        where:
          i.company_id == ^company_id and i.uuid == ^uuid and
            i.is_active == true
    )
  end

  defp fetch_item(_company_id, _), do: nil

  defp ensure_bommable(%Item{item_type: t}) when t in ["finished_product", "semi_finished"],
    do: :ok

  defp ensure_bommable(%Item{item_type: t}),
    do:
      {:error, "bom_not_allowed_for_item_type",
       "Routings can only target finished or semi-finished items (got #{inspect(t)})"}

  defp fetch_actor(%{created_by_id: nil}), do: {:error, "actor_missing", nil}

  defp fetch_actor(%{created_by_id: id}) do
    case Repo.get(User, id) do
      %User{} = user -> user
      _ -> {:error, "actor_missing", nil}
    end
  end

  defp normalise_name(raw, item) do
    case raw do
      s when is_binary(s) ->
        trimmed = String.trim(s)
        if trimmed == "", do: default_name(item), else: trimmed

      _ ->
        default_name(item)
    end
  end

  defp default_name(%Item{name: name}), do: "#{name} — Routing"

  # ``name`` is the natural upsert key. Routings carry a unique
  # constraint on ``(company_id, name)``, so we key off that plus
  # Lookup is by ``(company_id, item_id)`` only. The DB enforces one
  # routing per item (``routings_item_snapshot_index`` unique on the
  # same tuple), so matching on ``name`` on top of that would always
  # be redundant — and actively harmful when NPD re-pushes with a
  # renamed stage: the lookup would miss, the fallback would fall
  # through to ``create_routing``, and the unique constraint would
  # bounce with "this item already has a routing snapshot". Keeping
  # the lookup aligned with the constraint makes the upsert actually
  # idempotent, which the caller contract has always assumed.
  defp existing_routing(company_id, item_id, _name) do
    Repo.one(
      from r in Routing,
        where: r.company_id == ^company_id and r.item_id == ^item_id,
        limit: 1
    )
  end

  defp translate_steps(company_id, steps) when is_list(steps) do
    steps
    |> Enum.with_index()
    |> Enum.reduce_while({:ok, []}, fn {step, index}, {:ok, acc} ->
      case translate_step(company_id, step, index) do
        {:ok, attrs} -> {:cont, {:ok, [attrs | acc]}}
        {:error, detail} -> {:halt, {:error, "invalid_step", detail}}
      end
    end)
    |> case do
      {:ok, list} -> {:ok, Enum.reverse(list)}
      other -> other
    end
  end

  defp translate_steps(_company_id, _), do: {:ok, []}

  defp translate_step(company_id, step, index) when is_map(step) do
    with {:ok, group_uuid} <-
           fetch_binary(step, "workstation_group_uuid", index, "missing workstation_group_uuid"),
         {:ok, group_id} <- resolve_group_id(company_id, group_uuid, index),
         {:ok, source_step_id} <-
           resolve_source_step_id(company_id, step["source_routing_step_uuid"], index),
         {:ok, worker_ids} <-
           resolve_worker_ids(company_id, step["default_worker_uuids"], index) do
      attrs =
        %{
          "workstation_group_id" => group_id,
          "source_routing_step_id" => source_step_id,
          "sort_order" => step["sort_order"] || index,
          "operation_description" => step["operation_description"],
          "setup_time_min" => step["setup_time_min"],
          "cycle_time_min" => step["cycle_time_min"],
          "fixed_cost" => step["fixed_cost"],
          "variable_cost" => step["variable_cost"],
          "capacity" => step["capacity"]
        }
        |> Enum.reject(fn {_k, v} -> is_nil(v) end)
        |> Map.new()

      # ``default_worker_ids`` is what ``Production.replace_routing_steps``
      # already knows how to consume — it does the M2M insert against
      # ``routing_step_workers``. Pass an empty list explicitly when the
      # payload omits workers so a re-push clears any prior assignments
      # (matches how ``steps`` themselves are wholesale-replaced).
      attrs = Map.put(attrs, "default_worker_ids", worker_ids)

      {:ok, attrs}
    end
  end

  defp resolve_source_step_id(_company_id, nil, _index), do: {:ok, nil}
  defp resolve_source_step_id(_company_id, "", _index), do: {:ok, nil}

  defp resolve_source_step_id(company_id, uuid, index) when is_binary(uuid) do
    case Repo.one(
           from s in Backend.Production.RoutingStep,
             join: r in assoc(s, :routing),
             where:
               s.company_id == ^company_id and s.uuid == ^uuid and
                 is_nil(r.item_id),
             select: s.id
         ) do
      # Silently drop unknown template-step UUIDs — same cross-repo
      # drift tolerance ``resolve_worker_ids`` uses. The snapshot
      # still gets written, just without the provenance link.
      nil -> {:ok, nil}
      id -> {:ok, id}
    end
  end

  defp resolve_source_step_id(_company_id, _other, index),
    do: {:error, "step[#{index}]: source_routing_step_uuid must be a string"}

  defp translate_step(_company_id, _step, index),
    do: {:error, "step[#{index}]: not an object"}

  defp fetch_binary(map, key, index, msg) do
    case Map.get(map, key) do
      v when is_binary(v) and v != "" -> {:ok, v}
      _ -> {:error, "step[#{index}]: #{msg}"}
    end
  end

  defp resolve_worker_ids(_company_id, nil, _index), do: {:ok, []}

  defp resolve_worker_ids(_company_id, [], _index), do: {:ok, []}

  defp resolve_worker_ids(company_id, uuids, index) when is_list(uuids) do
    # Coerce to strings so a payload with mixed strings + UUID structs
    # (unlikely but cheap) still resolves. Unknown uuids drop out
    # silently rather than hard-failing the whole push — matches how
    # the BOM push handles cross-company drift.
    strings =
      uuids
      |> Enum.map(fn v -> to_string(v || "") end)
      |> Enum.reject(&(&1 == ""))

    if strings == [] do
      {:ok, []}
    else
      ids =
        Repo.all(
          from u in Backend.Accounts.User,
            where: u.company_id == ^company_id and u.uuid in ^strings and u.is_active == true,
            select: u.id
        )

      {:ok, ids}
    end
  end

  defp resolve_worker_ids(_company_id, _other, index),
    do: {:error, "step[#{index}]: default_worker_uuids must be an array"}

  defp resolve_group_id(company_id, uuid, index) do
    case Repo.one(
           from g in Backend.Production.WorkstationGroup,
             where:
               g.company_id == ^company_id and g.uuid == ^uuid and g.is_active == true,
             select: g.id
         ) do
      nil -> {:error, "step[#{index}]: workstation_group_uuid #{uuid} not found"}
      id -> {:ok, id}
    end
  end

  defp format_changeset(%Ecto.Changeset{errors: errors}) do
    errors
    |> Enum.map(fn {field, {msg, opts}} ->
      "#{field}: #{interpolate_message(msg, opts)}"
    end)
    |> Enum.join("; ")
  end

  # Ecto's built-in validation messages carry ``%{key}`` placeholders
  # (e.g. ``should be at most %{count} character(s)``) with the actual
  # values in the error's ``opts`` list. Without interpolation the
  # upstream (NPD) sees the raw template — misleading when debugging
  # "why did routing_push 422?" for a length overrun. Same pattern
  # Ecto docs recommend for the ``traverse_errors`` message-mapper.
  defp interpolate_message(msg, opts) when is_binary(msg) and is_list(opts) do
    Enum.reduce(opts, msg, fn {key, value}, acc ->
      String.replace(acc, "%{#{key}}", to_string(value))
    end)
  end

  defp interpolate_message(msg, _opts), do: msg

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: code, detail: detail})
  end
end
