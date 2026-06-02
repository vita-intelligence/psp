defmodule BackendWeb.AuditController do
  @moduledoc """
  Read-only history log for any audited entity.

      GET /api/audit?entity_type=warehouse&entity_id=42

  Permission is borrowed from the entity's own view permission — so
  anyone allowed to see the warehouse can read its history. This
  keeps the matrix flat (no separate `audit.view` to manage) and
  matches the "if you can see it, you can see how it got that way"
  intuition.
  """

  use BackendWeb, :controller

  alias Backend.{Audit, Accounts, RBAC, Warehouses}

  action_fallback BackendWeb.FallbackController

  @entity_view_perms %{
    "warehouse" => "warehouses.view",
    "user" => "users.view",
    "template" => "roles.view"
  }

  def index(conn, %{"entity_type" => entity_type, "entity_id" => entity_id_str} = params) do
    actor = conn.assigns.current_user

    with :ok <- check_view_perm(actor, entity_type),
         {entity_id, ""} <- Integer.parse(to_string(entity_id_str)),
         :ok <- check_entity_in_company(actor, entity_type, entity_id) do
      {items, next_cursor} =
        Audit.list_for_entity(actor.company_id, entity_type, entity_id,
          cursor: params["cursor"],
          limit: params["limit"]
        )

      json(conn, %{
        items: Enum.map(items, &payload/1),
        next_cursor: next_cursor
      })
    else
      :error -> {:error, :not_found}
      {:error, :unknown_entity} -> {:error, :not_found}
      {:error, :cross_company} -> {:error, :not_found}
      {:error, :forbidden} -> {:error, :forbidden}
    end
  end

  def index(_conn, _params), do: {:error, :bad_request}

  ## ------------------------------------------------------------------

  defp check_view_perm(actor, entity_type) do
    case Map.fetch(@entity_view_perms, entity_type) do
      {:ok, code} ->
        if RBAC.has_permission?(actor, code), do: :ok, else: {:error, :forbidden}

      :error ->
        {:error, :unknown_entity}
    end
  end

  defp check_entity_in_company(actor, "warehouse", entity_id) do
    case Backend.Repo.get(Warehouses.Warehouse, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "user", entity_id) do
    case Accounts.get_user(entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(actor, "template", entity_id) do
    case Backend.Repo.get(Backend.RBAC.Role, entity_id) do
      %{company_id: company_id} when company_id == actor.company_id -> :ok
      _ -> {:error, :cross_company}
    end
  end

  defp check_entity_in_company(_actor, _, _), do: {:error, :unknown_entity}

  defp payload(event) do
    %{
      id: event.id,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      entity_uuid: event.entity_uuid,
      event: event.event,
      changes: event.changes,
      state_after: event.state_after,
      at: event.at,
      actor: actor_payload(event)
    }
  end

  # Prefer the snapshot embedded at event time so a later rename /
  # deactivation doesn't rewrite history. Fall back to the live actor
  # row when the snapshot is absent (older rows).
  defp actor_payload(%{actor_snapshot: snap}) when map_size(snap) > 0 do
    %{
      id: snap["id"],
      name: snap["name"],
      email: snap["email"],
      avatar: snap["avatar"]
    }
  end

  defp actor_payload(%{actor: %Backend.Accounts.User{} = u}) do
    %{id: u.id, name: u.name, email: u.email, avatar: u.avatar}
  end

  defp actor_payload(_), do: nil
end
