defmodule BackendWeb.BOMController do
  @moduledoc """
  Bill of Materials REST surface — list / detail / create / update /
  delete + a dedicated `set_primary` action.

  Permission gates (`production.bom_*`) sit on every action via
  `BackendWeb.Plugs.RequirePermission`. The context layer enforces
  the deeper rule: only items whose `item_type` is finished_product
  or semi_finished can carry a BOM.
  """

  use BackendWeb, :controller

  alias Backend.Production
  alias Backend.Production.BOM
  alias BackendWeb.Errors
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  action_fallback BackendWeb.FallbackController

  plug RequirePermission, "production.bom_view" when action in [:index, :show, :versions]
  plug RequirePermission, "production.bom_create" when action in [:create]
  plug RequirePermission, "production.bom_edit" when action in [:update, :set_primary, :revert]
  plug RequirePermission, "production.bom_delete" when action in [:delete]

  # GET /api/production/boms
  def index(conn, params) do
    actor = conn.assigns.current_user

    opts =
      [
        cursor: params["cursor"],
        limit: params["limit"],
        sort: parse_sort(params["sort"]),
        search: params["search"],
        item_id: params["item_id"],
        is_active: params["is_active"]
      ]
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)

    {items, next_cursor} = Production.list_page(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(items, &Payloads.bom_summary/1),
      next_cursor: next_cursor
    })
  end

  # GET /api/production/boms/:id
  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %BOM{} = bom ->
        json(conn, %{bom: render_full_bom(actor, bom)})
    end
  end

  # GET /api/production/boms/:bom_id/versions
  def versions(conn, %{"bom_id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %BOM{} = bom ->
        json(conn, %{
          items:
            bom
            |> Production.list_versions()
            |> Enum.map(&Payloads.bom_version/1)
        })
    end
  end

  # POST /api/production/boms/:id/revert
  def revert(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with version_no when is_integer(version_no) <- parse_int(params["version_no"]),
         %BOM{} = bom <- Production.get(actor.company_id, uuid) do
      case Production.revert_to_version(actor, bom, version_no) do
        {:ok, updated} -> json(conn, %{bom: render_full_bom(actor, updated)})
        {:error, :version_not_found} -> not_found(conn)
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
        {:error, reason} -> unprocessable(conn, to_string(reason), "Revert failed.")
      end
    else
      nil ->
        unprocessable(conn, "bad_version_no", "Pick a version number to revert to.")
    end
  end

  # POST /api/production/boms
  def create(conn, params) do
    actor = conn.assigns.current_user

    case Production.create_bom(actor, params) do
      {:ok, %BOM{} = bom} ->
        conn
        |> put_status(:created)
        |> json(%{bom: Payloads.bom(bom)})

      {:error, :item_required} ->
        unprocessable(conn, "item_required", "Pick an output item to attach this BOM to.")

      {:error, :item_not_found} ->
        not_found(conn)

      {:error, :item_not_in_company} ->
        forbidden(conn, "Item belongs to a different company.")

      {:error, :bom_not_allowed_for_item_type} ->
        unprocessable(
          conn,
          "bom_not_allowed_for_item_type",
          "BOMs can only be attached to finished or semi-finished items. Raw materials and packaging are recipe inputs, never outputs."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  # PATCH /api/production/boms/:id
  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case Production.get(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %BOM{} = bom ->
        case Production.update_bom(actor, bom, params) do
          {:ok, updated} -> json(conn, %{bom: render_full_bom(actor, updated)})
          {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
          {:error, {:line_failed, idx, cs}} -> changeset_error(conn, cs, %{line_index: idx})
        end
    end
  end

  # POST /api/production/boms/:id/set-primary
  def set_primary(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %BOM{} = bom ->
        case Production.set_primary(actor, bom) do
          {:ok, updated} -> json(conn, %{bom: Payloads.bom(updated)})
          {:error, cs} -> changeset_error(conn, cs)
        end
    end
  end

  # DELETE /api/production/boms/:id
  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Production.get(actor.company_id, uuid) do
      nil ->
        not_found(conn)

      %BOM{} = bom ->
        case Production.delete_bom(actor, bom) do
          {:ok, _} -> send_resp(conn, :no_content, "")
          {:error, cs} -> changeset_error(conn, cs)
        end
    end
  end

  # ----- helpers -----------------------------------------------

  # Compose the detail payload — base BOM + per-line average cost +
  # the version history. Kept here (vs `Payloads.bom`) because the
  # extras are query-driven (cost lookup, version preload) and pure
  # payload helpers stay stateless.
  defp render_full_bom(actor, %BOM{} = bom) do
    part_ids = Enum.map(bom.lines, & &1.part_id) |> Enum.reject(&is_nil/1)
    costs = Production.average_unit_costs(actor.company_id, part_ids)
    versions = Production.list_versions(bom)

    bom
    |> Payloads.bom()
    |> Map.update!(:lines, fn lines ->
      Enum.map(lines, fn line ->
        Map.put(line, :average_unit_cost, Map.get(costs, line.part_id))
      end)
    end)
    |> Map.put(:versions, Enum.map(versions, &Payloads.bom_version/1))
  end

  defp parse_sort(nil), do: nil
  defp parse_sort(""), do: nil

  defp parse_sort(s) when is_binary(s) do
    case String.split(s, ":", parts: 2) do
      [field, "asc"] -> {String.to_existing_atom(field), :asc}
      [field, "desc"] -> {String.to_existing_atom(field), :desc}
      _ -> nil
    end
  rescue
    ArgumentError -> nil
  end

  defp parse_int(nil), do: nil
  defp parse_int(""), do: nil
  defp parse_int(n) when is_integer(n), do: n

  defp parse_int(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp parse_int(_), do: nil

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "BOM not found.", %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp forbidden(conn, detail) do
    conn
    |> put_status(:forbidden)
    |> json(Errors.payload("forbidden", detail, %{}))
  end

  defp changeset_error(conn, cs, extras \\ %{}) do
    payload =
      Errors.payload(
        "validation_failed",
        "One or more fields failed validation.",
        Errors.changeset_fields(cs)
      )
      |> Map.merge(extras)

    conn
    |> put_status(:unprocessable_entity)
    |> json(payload)
  end
end
