defmodule BackendWeb.IntegrationCustomerOrderController do
  @moduledoc """
  Sync surface for NPD (vita-cff) → PSP CustomerOrders.

  Called by NPD's ``save_version`` cascade every time a scientist saves
  a version of a formulation. Idempotent by ``npd_formulation_uuid`` —
  a fresh formulation becomes a new draft CustomerOrder; a re-save on
  an existing formulation refreshes the mirrored identity fields.

  Scoped by :setting:`customer_order:sync:npd` — a token minted on
  ``/settings/integrations`` on the PSP side carries that scope.
  """

  use BackendWeb, :controller

  import BackendWeb.IntegrationScopePlug

  alias Backend.CustomerOrders.NpdSync
  alias Backend.CustomerOrders.ProposalMerge

  plug :require_integration_scope,
       "customer_order:sync:npd"
       when action in [:sync, :from_proposal, :unmerge_from_proposal]

  action_fallback BackendWeb.FallbackController

  def sync(conn, params) do
    company_id = conn.assigns.current_company_id

    case NpdSync.upsert_from_npd(company_id, params) do
      {:ok, co} ->
        conn
        |> put_status(:ok)
        |> json(%{
          customer_order: %{
            uuid: co.uuid,
            npd_formulation_uuid: co.npd_formulation_uuid,
            status: co.status,
            inserted_at: co.inserted_at
          }
        })

      {:error, :missing_uuid} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "missing_npd_formulation_uuid"})

      {:error, :invalid_uuid} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "invalid_npd_formulation_uuid"})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          error: "validation_failed",
          fields: BackendWeb.Errors.changeset_fields(cs)
        })

      {:error, reason} ->
        conn
        |> put_status(:internal_server_error)
        |> json(%{error: to_string(reason)})
    end
  end

  @doc """
  Merge N R&D draft COs into ONE on proposal-create.

  Payload:

      %{
        "npd_proposal_uuid" => "…",
        "npd_proposal_code" => "PROP-0421",
        "npd_proposal_url"  => "https://…",
        "lines" => [
          %{"npd_formulation_uuid" => "…",
            "psp_finished_product_uuid" => "…",
            "quantity" => 1,
            "unit_price" => "12.34",
            "line_subtotal" => "12.34"}
        ]
      }

  Idempotent — a re-fire on the same ``npd_proposal_uuid`` refreshes
  the primary's lines rather than re-merging.
  """
  def from_proposal(conn, params) do
    company_id = conn.assigns.current_company_id

    case ProposalMerge.merge_from_proposal(company_id, params) do
      {:ok, co} ->
        conn
        |> put_status(:ok)
        |> json(%{
          customer_order: %{
            uuid: co.uuid,
            status: co.status,
            npd_proposal_uuid: co.npd_proposal_uuid,
            npd_proposal_code: co.npd_proposal_code,
            lines_count: length(co.lines || [])
          }
        })

      {:error, :bad_proposal_uuid} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "bad_proposal_uuid"})

      {:error, :no_lines} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "no_lines"})

      {:error, :bad_formulation_uuid} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "bad_formulation_uuid"})

      {:error, {:missing_formulation, uuid}} ->
        # NPD sent a formulation UUID we don't have a CO for yet. The
        # caller retries after re-firing the save_version sync.
        conn
        |> put_status(:conflict)
        |> json(%{error: "missing_formulation", npd_formulation_uuid: uuid})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          error: "validation_failed",
          fields: BackendWeb.Errors.changeset_fields(cs)
        })

      {:error, reason} ->
        conn
        |> put_status(:internal_server_error)
        |> json(%{error: to_string(reason)})
    end
  end

  @doc """
  Reverse a proposal-driven merge.

  Called when NPD deletes the underlying Proposal. Fans comments
  back to their home CustomerOrder, clears ``merged_into_id`` on
  every secondary, and wipes the proposal identity + proposal-derived
  lines on the primary so the wizard snaps the primary back to
  ``:r_and_d``.

  Idempotent — a re-fire on an already-unmerged proposal_uuid
  responds 200 with ``no_op: true``.
  """
  def unmerge_from_proposal(conn, %{"proposal_uuid" => proposal_uuid}) do
    company_id = conn.assigns.current_company_id

    case ProposalMerge.unmerge_from_proposal(company_id, proposal_uuid) do
      {:ok, :no_op} ->
        conn |> put_status(:ok) |> json(%{no_op: true})

      {:ok, %{primary_uuid: primary_uuid, unmerged_secondaries: secondaries}} ->
        conn
        |> put_status(:ok)
        |> json(%{
          primary_uuid: primary_uuid,
          unmerged_secondaries: secondaries
        })

      {:error, :bad_proposal_uuid} ->
        conn |> put_status(:bad_request) |> json(%{error: "bad_proposal_uuid"})

      {:error, reason} ->
        conn
        |> put_status(:internal_server_error)
        |> json(%{error: to_string(reason)})
    end
  end
end
