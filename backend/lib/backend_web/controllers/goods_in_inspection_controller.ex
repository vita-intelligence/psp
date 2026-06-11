defmodule BackendWeb.GoodsInInspectionController do
  @moduledoc """
  Goods-In Inspection endpoints — BRCGS / FSSC 22000 incoming-goods
  inspection workflow.

  Two-signature flow (segregation of duties):

    * `goods_in.inspect` — creates draft, fills sections + line
      decisions, signs as the goods-in operator.
    * `goods_in.approve` — signs as the quality approver. Must be a
      different user from the operator.
  """

  use BackendWeb, :controller

  import Ecto.Query, only: [from: 2]

  alias Backend.GoodsIn
  alias Backend.GoodsIn.Inspection
  alias Backend.Purchasing
  alias Backend.Purchasing.PurchaseOrderLine
  alias Backend.Repo
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "goods_in.view"
       when action in [:index, :show]

  plug RequirePermission, "goods_in.inspect"
       when action in [
              :create,
              :update,
              :upsert_item,
              :sign_operator
            ]

  plug RequirePermission, "goods_in.approve"
       when action in [:sign_quality]

  action_fallback BackendWeb.FallbackController

  # ----- list / show ------------------------------------------------

  @doc """
  List inspections for one PO (multi-delivery view).
  """
  def index(conn, %{"purchase_order_id" => po_uuid}) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, po_uuid) do
      inspections = GoodsIn.list_for_po(actor.company_id, po.id)
      json(conn, %{items: Enum.map(inspections, &Payloads.goods_in_inspection/1)})
    else
      _ -> {:error, :not_found}
    end
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case GoodsIn.get(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      inspection -> json(conn, %{goods_in_inspection: Payloads.goods_in_inspection(inspection)})
    end
  end

  # ----- create draft ----------------------------------------------

  def create(conn, %{"purchase_order_id" => po_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = po <- Purchasing.get_for_company(actor.company_id, po_uuid),
         {:ok, inspection} <-
           GoodsIn.create_draft(actor, po, Map.drop(params, ["purchase_order_id"])) do
      conn
      |> put_status(:created)
      |> json(%{goods_in_inspection: Payloads.goods_in_inspection(inspection)})
    else
      nil -> {:error, :not_found}
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  # ----- update (delivery info + section JSONBs) -------------------

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    case GoodsIn.get(actor.company_id, uuid) do
      nil ->
        {:error, :not_found}

      inspection ->
        update_dispatch(conn, actor, inspection, Map.drop(params, ["id"]))
    end
  end

  # If the body carries a `section` + `value`, we patch one of the
  # JSONB section columns. Otherwise we patch delivery-info section 1.
  defp update_dispatch(conn, actor, %Inspection{} = i, %{"section" => section_str, "value" => value})
       when is_map(value) do
    section = String.to_existing_atom(section_str)

    case GoodsIn.update_section(actor, i, section, value) do
      {:ok, updated} ->
        json(conn, %{goods_in_inspection: Payloads.goods_in_inspection(updated)})

      {:error, :not_editable} ->
        conflict(conn, "not_editable", "Inspection is no longer in draft.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  rescue
    ArgumentError ->
      unprocessable(conn, "bad_section", "Unknown section name.")
  end

  defp update_dispatch(conn, actor, %Inspection{} = i, attrs) do
    case GoodsIn.update_delivery_info(actor, i, attrs) do
      {:ok, updated} ->
        json(conn, %{goods_in_inspection: Payloads.goods_in_inspection(updated)})

      {:error, :not_editable} ->
        conflict(conn, "not_editable", "Inspection is no longer in draft.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  # ----- per-line item decisions -----------------------------------

  def upsert_item(conn, %{"goods_in_inspection_id" => uuid, "line_uuid" => line_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = inspection <- GoodsIn.get(actor.company_id, uuid),
         %{} = line <- fetch_po_line(inspection.purchase_order_id, line_uuid),
         {:ok, item} <-
           GoodsIn.upsert_item_decision(
             actor,
             inspection,
             line,
             Map.drop(params, ["goods_in_inspection_id", "line_uuid"])
           ) do
      json(conn, %{inspection_item: Payloads.goods_in_inspection_item(item)})
    else
      nil ->
        {:error, :not_found}

      {:error, :not_editable} ->
        conflict(conn, "not_editable", "Inspection is no longer in draft.")

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  # ----- signatures ------------------------------------------------

  def sign_operator(conn, %{"goods_in_inspection_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = inspection <- GoodsIn.get(actor.company_id, uuid),
         {:ok, signed} <-
           GoodsIn.sign_operator(
             actor,
             inspection,
             Map.drop(params, ["goods_in_inspection_id"])
           ) do
      json(conn, %{goods_in_inspection: Payloads.goods_in_inspection(signed)})
    else
      nil ->
        {:error, :not_found}

      {:error, :not_editable} ->
        conflict(
          conn,
          "not_editable",
          "Inspection is no longer in draft — can't operator-sign."
        )

      {:error, {:lines_undecided, missing}} ->
        unprocessable(
          conn,
          "lines_undecided",
          "Decide every PO line before signing as operator (#{length(missing)} undecided)."
        )

      {:error, {:sections_incomplete, missing}} ->
        unprocessable(
          conn,
          "sections_incomplete",
          "Fill every section before signing as operator (missing: #{Enum.join(Enum.map(missing, &Atom.to_string/1), ", ")})."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def sign_quality(conn, %{"goods_in_inspection_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = inspection <- GoodsIn.get(actor.company_id, uuid),
         {:ok, signed} <-
           GoodsIn.sign_quality_approver(
             actor,
             inspection,
             Map.drop(params, ["goods_in_inspection_id"])
           ) do
      json(conn, %{goods_in_inspection: Payloads.goods_in_inspection(signed)})
    else
      nil ->
        {:error, :not_found}

      {:error, :not_submitted} ->
        conflict(
          conn,
          "not_submitted",
          "Inspection isn't awaiting quality sign-off."
        )

      {:error, :same_signer_as_operator} ->
        conflict(
          conn,
          "same_signer_as_operator",
          "Quality approver must be a different user from the goods-in operator (segregation of duties)."
        )

      {:error, {:illegal_transition, info}} ->
        unprocessable(
          conn,
          "illegal_transition",
          "Couldn't transition a linked lot: #{inspect(info)}."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  # ----- helpers ---------------------------------------------------

  defp fetch_po_line(po_id, line_uuid) when is_binary(line_uuid) do
    case Ecto.UUID.cast(line_uuid) do
      {:ok, cast} ->
        Repo.one(
          from(l in PurchaseOrderLine,
            where: l.purchase_order_id == ^po_id and l.uuid == ^cast
          )
        )

      :error ->
        nil
    end
  end

  defp fetch_po_line(_, _), do: nil

  defp changeset_error(conn, %Ecto.Changeset{} = cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload("validation_failed", "Please correct the highlighted fields.", %{errors: format_errors(cs)}))
  end

  defp format_errors(%Ecto.Changeset{} = cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end

  defp conflict(conn, code, detail) do
    conn
    |> put_status(:conflict)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
  end
end
