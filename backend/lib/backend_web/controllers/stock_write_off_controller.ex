defmodule BackendWeb.StockWriteOffController do
  @moduledoc """
  Read + mutate endpoints for the three-signature stock write-off
  workflow. Every mutating action re-verifies the actor's password
  as an electronic signature; the response echoes the updated
  write-off with fresh sig timestamps so the FE state machine
  advances without a follow-up GET.

  Routes:

      GET    /api/stock/write-offs                (index)
      GET    /api/stock/write-offs/:uuid          (show)
      POST   /api/stock/write-offs                (create draft)
      PATCH  /api/stock/write-offs/:uuid          (edit draft)
      DELETE /api/stock/write-offs/:uuid          (delete draft)
      POST   /api/stock/write-offs/:uuid/submit   (creator → pending_approval)
      POST   /api/stock/write-offs/:uuid/approve  (approver → pending_authorisation)
      POST   /api/stock/write-offs/:uuid/authorise (authoriser → active)
      POST   /api/stock/write-offs/:uuid/reject   (any reviewer → draft)
      POST   /api/stock/write-offs/:uuid/revert   (undo an active write-off)

  RBAC (per action):

      view / list      → stock.view
      create / edit    → stock.writeoff.file
      submit           → stock.writeoff.file  (creator only)
      approve          → stock.writeoff.approve
      authorise        → stock.writeoff.authorise
      revert           → stock.writeoff.revert
  """

  use BackendWeb, :controller

  alias Backend.Repo
  alias Backend.Stock
  alias Backend.Stock.{Lot, WriteOff, WriteOffs}
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "stock.view" when action in [:index, :show]
  plug RequirePermission, "stock.writeoff.file"
       when action in [:create, :update, :delete, :submit]
  plug RequirePermission, "stock.writeoff.approve" when action == :approve
  plug RequirePermission, "stock.writeoff.authorise" when action == :authorise
  plug RequirePermission, "stock.writeoff.revert" when action == :revert
  # Reject can come from either the approver or the authoriser; the
  # context enforces "≠ creator". View permission is the minimum floor
  # so the plug pipeline compiles; the context checks the seniority
  # via password re-entry (only real approvers/authorisers know their
  # own password).
  plug RequirePermission, "stock.writeoff.approve" when action == :reject

  action_fallback BackendWeb.FallbackController

  # ------------------------------------------------------------------
  # Read
  # ------------------------------------------------------------------

  def index(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      cursor: params["cursor"],
      limit: parse_limit(params["limit"]),
      sort: parse_sort(params["sort"]),
      search: params["search"],
      status: params["status"],
      reason_category: params["reason_category"],
      from_at: params["from_at"],
      to_at: params["to_at"],
      created_by_id: parse_int(params["created_by_id"]),
      stock_lot_id: parse_int(params["stock_lot_id"]),
      column_filter: params["column_filter"]
    ]

    {rows, cursor} = WriteOffs.list(actor.company_id, opts)

    json(conn, %{
      items: Enum.map(rows, &Payloads.stock_write_off_row/1),
      next_cursor: cursor
    })
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case WriteOffs.get(actor.company_id, uuid) do
      nil ->
        not_found(conn, "write_off_not_found", "Write-off not found.")

      %WriteOff{} = wo ->
        json(conn, %{write_off: Payloads.stock_write_off(wo)})
    end
  end

  # ------------------------------------------------------------------
  # Draft lifecycle
  # ------------------------------------------------------------------

  def create(conn, %{"lot_uuid" => lot_uuid} = params) do
    actor = conn.assigns.current_user

    with {:ok, lot} <- fetch_lot(actor.company_id, lot_uuid),
         {:ok, wo} <-
           WriteOffs.create_draft(actor, lot, Map.delete(params, "lot_uuid")) do
      conn
      |> put_status(:created)
      |> json(%{write_off: Payloads.stock_write_off(Repo.preload(wo, WriteOffs.detail_preloads()))})
    else
      {:error, :lot_not_found} ->
        not_found(conn, "lot_not_found", "Lot not found.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def create(conn, _),
    do: unprocessable(conn, "lot_uuid_required", "lot_uuid is required.")

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %WriteOff{} = wo <- WriteOffs.get(actor.company_id, uuid),
         {:ok, updated} <-
           WriteOffs.update_draft(actor, wo, Map.delete(params, "id")) do
      json(conn, %{write_off: Payloads.stock_write_off(updated)})
    else
      nil ->
        not_found(conn, "write_off_not_found", "Write-off not found.")

      {:error, {:invalid_transition, msg}} ->
        unprocessable(conn, "invalid_transition", msg)

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %WriteOff{} = wo <- WriteOffs.get(actor.company_id, uuid),
         {:ok, _} <- WriteOffs.delete_draft(actor, wo) do
      send_resp(conn, :no_content, "")
    else
      nil ->
        not_found(conn, "write_off_not_found", "Write-off not found.")

      {:error, {:invalid_transition, msg}} ->
        unprocessable(conn, "invalid_transition", msg)
    end
  end

  # ------------------------------------------------------------------
  # State transitions
  # ------------------------------------------------------------------

  def submit(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %WriteOff{} = wo <- WriteOffs.get(actor.company_id, uuid),
         {:ok, updated} <- WriteOffs.submit_for_review(actor, wo) do
      json(conn, %{write_off: Payloads.stock_write_off(updated)})
    else
      nil -> not_found(conn, "write_off_not_found", "Write-off not found.")
      {:error, :not_creator} -> unprocessable(conn, "not_creator", "Only the creator can submit.")
      {:error, {:invalid_transition, msg}} -> unprocessable(conn, "invalid_transition", msg)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def approve(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %WriteOff{} = wo <- WriteOffs.get(actor.company_id, uuid),
         {:ok, updated} <-
           WriteOffs.approve(actor, wo, %{
             password: params["password"] || "",
             note: params["note"] || ""
           }) do
      json(conn, %{write_off: Payloads.stock_write_off(updated)})
    else
      nil -> not_found(conn, "write_off_not_found", "Write-off not found.")
      {:error, :bad_password} -> unprocessable(conn, "bad_password", "Password didn't match. Try again.")
      {:error, :actor_conflict} -> unprocessable(conn, "actor_conflict", "You already signed this write-off — a different reviewer has to approve.")
      {:error, {:invalid_transition, msg}} -> unprocessable(conn, "invalid_transition", msg)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def authorise(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %WriteOff{} = wo <- WriteOffs.get(actor.company_id, uuid),
         {:ok, updated} <-
           WriteOffs.authorise(actor, wo, %{
             password: params["password"] || "",
             note: params["note"] || ""
           }) do
      json(conn, %{write_off: Payloads.stock_write_off(updated)})
    else
      nil -> not_found(conn, "write_off_not_found", "Write-off not found.")
      {:error, :bad_password} -> unprocessable(conn, "bad_password", "Password didn't match. Try again.")
      {:error, :actor_conflict} -> unprocessable(conn, "actor_conflict", "You already signed this write-off earlier — a different reviewer has to authorise.")
      {:error, :ambiguous_placement} -> unprocessable(conn, "ambiguous_placement", "Lot is split across cells — the draft needs an explicit placement before it can authorise.")
      {:error, :no_stock_left} -> unprocessable(conn, "no_stock_left", "The lot has no on-hand stock left to write off.")
      {:error, :insufficient_qty} -> unprocessable(conn, "insufficient_qty", "The lot doesn't have enough on-hand qty to cover this write-off.")
      {:error, :placement_not_found} -> unprocessable(conn, "placement_not_found", "The stored placement no longer exists.")
      {:error, {:invalid_transition, msg}} -> unprocessable(conn, "invalid_transition", msg)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def reject(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %WriteOff{} = wo <- WriteOffs.get(actor.company_id, uuid),
         {:ok, updated} <-
           WriteOffs.reject(actor, wo, %{
             password: params["password"] || "",
             note: params["note"] || ""
           }) do
      json(conn, %{write_off: Payloads.stock_write_off(updated)})
    else
      nil -> not_found(conn, "write_off_not_found", "Write-off not found.")
      {:error, :bad_password} -> unprocessable(conn, "bad_password", "Password didn't match. Try again.")
      {:error, :actor_conflict} -> unprocessable(conn, "actor_conflict", "Creators can't reject their own write-off.")
      {:error, {:invalid_transition, msg}} -> unprocessable(conn, "invalid_transition", msg)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def revert(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %WriteOff{} = wo <- WriteOffs.get(actor.company_id, uuid),
         {:ok, updated} <-
           WriteOffs.revert(actor, wo, %{
             password: params["password"] || "",
             reason: params["reason"] || ""
           }) do
      json(conn, %{write_off: Payloads.stock_write_off(updated)})
    else
      nil -> not_found(conn, "write_off_not_found", "Write-off not found.")
      {:error, :bad_password} -> unprocessable(conn, "bad_password", "Password didn't match. Try again.")
      {:error, :revert_reason_too_short} -> unprocessable(conn, "revert_reason_too_short", "Give at least a short sentence explaining why you're reverting (≥ 10 characters).")
      {:error, {:invalid_transition, msg}} -> unprocessable(conn, "invalid_transition", msg)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  # ------------------------------------------------------------------
  # Helpers
  # ------------------------------------------------------------------

  defp fetch_lot(company_id, uuid) do
    case Repo.get_by(Lot, uuid: uuid) do
      %Lot{company_id: ^company_id} = l -> {:ok, l}
      _ -> {:error, :lot_not_found}
    end
  end

  defp parse_limit(nil), do: 25
  defp parse_limit(""), do: 25

  defp parse_limit(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, ""} when n > 0 -> min(n, 200)
      _ -> 25
    end
  end

  defp parse_limit(v) when is_integer(v) and v > 0, do: min(v, 200)
  defp parse_limit(_), do: 25

  defp parse_int(nil), do: nil
  defp parse_int(""), do: nil

  defp parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp parse_int(v) when is_integer(v), do: v
  defp parse_int(_), do: nil

  defp parse_sort(nil), do: nil
  defp parse_sort(""), do: nil

  defp parse_sort(spec) when is_binary(spec) do
    case String.split(spec, ":", parts: 2) do
      [field, dir] when dir in ["asc", "desc"] ->
        atom_field =
          case field do
            "inserted_at" -> :inserted_at
            "id" -> :id
            "status" -> :status
            "qty" -> :qty
            "reason_category" -> :reason_category
            _ -> nil
          end

        if atom_field, do: {atom_field, String.to_existing_atom(dir)}, else: nil

      _ ->
        nil
    end
  end

  defp parse_sort(_), do: nil

  defp not_found(conn, code, detail) do
    conn
    |> put_status(:not_found)
    |> json(BackendWeb.Errors.payload(code, detail, %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(BackendWeb.Errors.payload(code, detail, %{}))
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      BackendWeb.Errors.payload(
        "validation_failed",
        "Please correct the highlighted fields.",
        BackendWeb.Errors.changeset_fields(cs)
      )
    )
  end

  # Silence unused-alias warnings — these are consumed via
  # Payloads.stock_write_off/1 at runtime.
  _ = Stock
end
