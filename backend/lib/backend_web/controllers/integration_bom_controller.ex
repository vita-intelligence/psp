defmodule BackendWeb.IntegrationBomController do
  @moduledoc """
  Write-side endpoint for pushing a BOM snapshot from an upstream
  R&D system (NPD today). One HTTP verb — `PUT /api/integration/
  items/:uuid/bom` — upserts the primary BOM attached to the
  target Item + writes a fresh `bom_version` row under the hood
  (Production.create_bom / update_bom already snapshot on save)
  so PSP's version history captures every push.

  Actor: the integration token's ``created_by`` user. That ties
  the audit row + ``bom_version.created_by_id`` to the real human
  who minted the token, not a synthetic "system" account.

  Payload shape (JSON):

      {
        "name": "Vitamin C 500 mg — R&D v3",     // optional
        "notes": "Auto-pushed from NPD",         // optional
        "version_notes": "NPD formulation v3",   // optional
        "lines": [
          {"part_uuid": "...", "qty": "0.5000", "sort_order": 0},
          ...
        ]
      }

  Returns `{"bom": {"uuid": "...", "version_no": N}}` on 200.
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.Accounts.User
  alias Backend.Items.Item
  alias Backend.Production
  alias Backend.Production.{BOM, BOMVersion}
  alias Backend.Repo

  plug :require_integration_scope, "bom:write" when action == :upsert

  def upsert(conn, %{"uuid" => item_uuid} = params) do
    company_id = conn.assigns.current_company_id
    token = conn.assigns.current_integration_token

    with %Item{} = item <- fetch_item(company_id, item_uuid),
         %User{} = actor <- fetch_actor(token),
         {:ok, resolved_lines} <- translate_lines(company_id, params["lines"]),
         :ok <- require_non_empty(resolved_lines) do
      attrs = %{
        "item_id" => item.uuid,
        "name" => params["name"] || "#{item.name} BOM",
        "notes" => params["notes"],
        "version_notes" => params["version_notes"] || "Pushed via integration",
        "lines" => resolved_lines
      }

      run_upsert(conn, actor, item, attrs)
    else
      {:error, code, detail} -> unprocessable(conn, code, detail)
      nil -> unprocessable(conn, "item_not_found", item_uuid)
    end
  end

  # ---- internals ----

  defp run_upsert(conn, actor, item, attrs) do
    result =
      case existing_primary_bom(actor.company_id, item.id) do
        nil -> Production.create_bom(actor, attrs)
        %BOM{} = bom -> Production.update_bom(actor, bom, attrs)
      end

    case result do
      {:ok, bom} ->
        latest = latest_version_no(bom)

        conn
        |> put_status(:ok)
        |> json(%{bom: %{uuid: bom.uuid, version_no: latest}})

      {:error, %Ecto.Changeset{} = cs} ->
        unprocessable(conn, "validation_failed", format_changeset(cs))

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

  defp fetch_actor(%{created_by_id: nil}), do: {:error, "actor_missing", nil}

  defp fetch_actor(%{created_by_id: id}) do
    case Repo.get(User, id) do
      %User{} = user -> user
      _ -> {:error, "actor_missing", nil}
    end
  end

  # Resolve each line's ``part_uuid`` to an integer id, validate
  # ``qty``. Returns ``{:ok, lines}`` on success; ``{:error, code,
  # detail}`` on the first failure so the caller sees the exact
  # offending line index.
  defp translate_lines(company_id, lines) when is_list(lines) do
    lines
    |> Enum.with_index()
    |> Enum.reduce_while({:ok, []}, fn {line, index}, {:ok, acc} ->
      case translate_line(company_id, line, index) do
        {:ok, attrs} -> {:cont, {:ok, [attrs | acc]}}
        {:error, detail} -> {:halt, {:error, "invalid_line", detail}}
      end
    end)
    |> case do
      {:ok, list} -> {:ok, Enum.reverse(list)}
      other -> other
    end
  end

  defp translate_lines(_company_id, _), do: {:ok, []}

  defp translate_line(company_id, line, index) when is_map(line) do
    with {:ok, part_uuid} <- fetch_binary(line, "part_uuid", index, "missing part_uuid"),
         {:ok, part_id} <- resolve_part_id(company_id, part_uuid, index),
         {:ok, qty} <- to_decimal(line["qty"], index) do
      attrs =
        %{
          "part_id" => part_id,
          "qty" => qty,
          "sort_order" => line["sort_order"] || index,
          "is_fixed" => line["is_fixed"] || false,
          "notes" => line["notes"]
        }

      {:ok, attrs}
    end
  end

  defp translate_line(_company_id, _line, index),
    do: {:error, "line[#{index}]: not an object"}

  defp fetch_binary(map, key, index, msg) do
    case Map.get(map, key) do
      v when is_binary(v) and v != "" -> {:ok, v}
      _ -> {:error, "line[#{index}]: #{msg}"}
    end
  end

  defp resolve_part_id(company_id, uuid, index) do
    case Repo.one(
           from i in Item,
             where: i.company_id == ^company_id and i.uuid == ^uuid,
             select: i.id
         ) do
      nil -> {:error, "line[#{index}]: part_uuid #{uuid} not found"}
      id -> {:ok, id}
    end
  end

  defp to_decimal(nil, index), do: {:error, "line[#{index}]: qty is required"}

  defp to_decimal(value, index) do
    string =
      cond do
        is_binary(value) -> value
        is_number(value) -> to_string(value)
        true -> ""
      end

    case Decimal.parse(String.trim(string)) do
      {%Decimal{} = d, ""} ->
        if Decimal.positive?(d),
          do: {:ok, d},
          else: {:error, "line[#{index}]: qty must be > 0"}

      _ ->
        {:error, "line[#{index}]: qty must be a decimal"}
    end
  end

  defp existing_primary_bom(company_id, item_id) do
    Repo.one(
      from b in BOM,
        where:
          b.company_id == ^company_id and
            b.item_id == ^item_id and
            b.is_active == true,
        order_by: [desc: b.is_primary, desc: b.id],
        limit: 1
    )
  end

  defp latest_version_no(%BOM{} = bom) do
    Repo.one(
      from v in BOMVersion,
        where: v.bom_id == ^bom.id,
        select: max(v.version_no)
    ) || 1
  end

  defp require_non_empty([]),
    do: {:error, "empty_lines", "BOM push carried no lines."}

  defp require_non_empty(_), do: :ok

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
