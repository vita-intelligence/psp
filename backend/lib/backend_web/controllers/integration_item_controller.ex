defmodule BackendWeb.IntegrationItemController do
  @moduledoc """
  Write-side endpoint for creating catalog Items from an upstream
  R&D system (NPD today). Only `semi_finished` and `finished_product`
  types are creatable through this surface — raw materials, packaging,
  consumables, and equipment stay operator-managed on PSP where the
  compliance sub-tables live.

  Semi-finished items are the anchor for a multi-stage BOM push: a
  capsule product = "Powder Blend" (semi_finished, its own BOM +
  routing) consumed by "Filled Capsules" (semi_finished) consumed by
  the finished-product SKU. NPD auto-creates the intermediate items
  the first time it pushes; subsequent pushes hit the same rows via
  the idempotency key.

  Idempotency: `external_sku` is the natural key. A repeated POST
  with the same `external_sku` returns the existing row (200) instead
  of erroring out. This lets NPD safely retry / re-push without
  duplicate ghost items.

  Payload shape (JSON):

      {
        "name": "Powder Blend — Vitamin C 500mg",
        "item_type": "semi_finished",
        "external_sku": "NPD-STAGE-<formulation_uuid>-1",
        "description": "Stage 1 output of formulation ...",
        "attributes": {}                 // optional
      }

  Returns:

      {"item": {"uuid": "...", "name": "...", "item_type": "...",
                "external_sku": "...", "created": true|false}}

  `created: false` means "an existing row matched your `external_sku`
  — nothing was inserted, here's the pre-existing uuid".
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.Accounts.User
  alias Backend.Items
  alias Backend.Items.Item
  alias Backend.Repo

  # The write surface is intentionally narrow: NPD pushes stage
  # outputs (the semi-finished items each production stage produces)
  # and, optionally, the finished-product SKU when it wasn't
  # pre-created by an operator. Everything else stays out.
  @allowed_types ~w(semi_finished finished_product)

  plug :require_integration_scope, "item:write" when action == :create

  def create(conn, params) do
    company_id = conn.assigns.current_company_id
    token = conn.assigns.current_integration_token

    with {:ok, %User{} = actor} <- fetch_actor(token),
         {:ok, attrs} <- normalise(params) do
      case existing_by_sku(company_id, attrs["external_sku"]) do
        %Item{} = existing ->
          conn
          |> put_status(:ok)
          |> json(%{item: payload(existing, created: false)})

        nil ->
          case Items.create(actor, company_id, attrs) do
            {:ok, item} ->
              conn
              |> put_status(:created)
              |> json(%{item: payload(item, created: true)})

            {:error, %Ecto.Changeset{} = cs} ->
              unprocessable(conn, "validation_failed", format_changeset(cs))

            {:error, reason} when is_atom(reason) ->
              unprocessable(conn, to_string(reason), nil)

            {:error, reason} ->
              unprocessable(conn, "unknown_error", inspect(reason))
          end
      end
    else
      {:error, code, detail} -> unprocessable(conn, code, detail)
    end
  end

  # ---- internals ----

  defp fetch_actor(%{created_by_id: nil}), do: {:error, "actor_missing", nil}

  defp fetch_actor(%{created_by_id: id}) do
    case Repo.get(User, id) do
      %User{} = user -> {:ok, user}
      _ -> {:error, "actor_missing", nil}
    end
  end

  defp normalise(params) when is_map(params) do
    with {:ok, name} <- fetch_string(params, "name", "missing name"),
         {:ok, item_type} <- fetch_string(params, "item_type", "missing item_type"),
         :ok <- ensure_allowed_type(item_type),
         {:ok, sku} <- fetch_string(params, "external_sku", "missing external_sku") do
      attrs = %{
        "name" => name,
        "item_type" => item_type,
        "external_sku" => sku,
        "description" => Map.get(params, "description"),
        "attributes" => Map.get(params, "attributes") || %{}
      }

      {:ok, attrs}
    end
  end

  defp normalise(_), do: {:error, "invalid_payload", "expected an object"}

  defp fetch_string(map, key, missing_msg) do
    case Map.get(map, key) do
      v when is_binary(v) ->
        trimmed = String.trim(v)
        if trimmed == "",
          do: {:error, "invalid_payload", missing_msg},
          else: {:ok, trimmed}

      _ ->
        {:error, "invalid_payload", missing_msg}
    end
  end

  defp ensure_allowed_type(type) when type in @allowed_types, do: :ok

  defp ensure_allowed_type(type),
    do: {:error, "item_type_not_allowed",
         "only #{Enum.join(@allowed_types, ", ")} may be created via integration (got #{inspect(type)})"}

  defp existing_by_sku(company_id, sku) do
    Repo.one(
      from i in Item,
        where:
          i.company_id == ^company_id and i.external_sku == ^sku and
            i.is_active == true,
        limit: 1
    )
  end

  defp payload(%Item{} = item, created: created?) do
    %{
      uuid: item.uuid,
      name: item.name,
      item_type: item.item_type,
      external_sku: item.external_sku,
      description: item.description,
      is_active: item.is_active,
      created: created?
    }
  end

  defp format_changeset(%Ecto.Changeset{errors: errors}) do
    errors
    |> Enum.map(fn {field, {msg, _}} -> "#{field}: #{msg}" end)
    |> Enum.join("; ")
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: code, detail: detail})
  end
end
