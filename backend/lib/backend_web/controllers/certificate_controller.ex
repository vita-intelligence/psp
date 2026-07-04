defmodule BackendWeb.CertificateController do
  @moduledoc """
  Company-scoped certificate registry.

  RBAC: `certificates.view` for reads, `certificates.manage` for writes.
  """

  use BackendWeb, :controller

  alias Backend.Certificates
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "certificates.view" when action in [:index, :show]
  plug RequirePermission, "certificates.manage"
       when action in [:create, :update, :delete]

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    case params["picker"] do
      "true" ->
        items = Certificates.list_for_company(actor.company_id)
        json(conn, %{items: Enum.map(items, &Payloads.certificate/1)})

      _ ->
        opts = list_opts_from_params(params)
        {items, next_cursor} = Certificates.list_page(actor.company_id, opts)

        json(conn, %{
          items: Enum.map(items, &Payloads.certificate/1),
          next_cursor: next_cursor
        })
    end
  end

  def show(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Certificates.get_for_company(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      cert -> json(conn, %{certificate: Payloads.certificate(cert)})
    end
  end

  def create(conn, params) do
    actor = conn.assigns.current_user

    case Certificates.create(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, cert} ->
        conn
        |> put_status(:created)
        |> json(%{certificate: Payloads.certificate(cert)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = cert <- Certificates.get_for_company(actor.company_id, uuid) do
      case Certificates.update(actor, cert, Map.drop(params, ["id"])) do
        {:ok, updated} -> json(conn, %{certificate: Payloads.certificate(updated)})
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = cert <- Certificates.get_for_company(actor.company_id, uuid),
         {:ok, _} <- Certificates.delete(actor, cert) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  defp list_opts_from_params(params) do
    [
      cursor: params["cursor"],
      limit: params["limit"],
      sort: parse_sort(params["sort"]),
      search: params["search"],
      column_filter: params["column_filter"]
    ]
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

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload(
        "validation_failed",
        "Please correct the highlighted fields.",
        Errors.changeset_fields(cs)
      )
    )
  end
end
