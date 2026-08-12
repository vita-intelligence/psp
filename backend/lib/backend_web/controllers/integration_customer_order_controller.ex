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

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.CustomerInvoices.CustomerInvoice
  alias Backend.CustomerOrders.CustomerOrder
  alias Backend.CustomerOrders.NpdSync
  alias Backend.CustomerOrders.ProposalMerge
  alias Backend.OrderWizard
  alias Backend.Repo

  plug :require_integration_scope,
       "customer_order:sync:npd"
       when action in [
              :sync,
              :sync_sample,
              :from_proposal,
              :unmerge_from_proposal
            ]

  # Read-only snapshot for the NPD portal — same scope as the write
  # actions since the sample sync + snapshot read are a matched pair
  # (NPD pushes the CO, then reads back its live phase to show the
  # customer where their sample is).
  plug :require_integration_scope,
       "customer_order:sync:npd"
       when action in [:snapshot, :invoices]

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
  Upsert a sample-fulfilment CO from an NPD sample-payment payload.

  Sibling of :func:`sync/2`. Keyed on ``npd_sample_payment_uuid`` so
  each customer's sample gets its own CO (unlike the formulation
  sync which dedupes on formulation and would collide for RTG
  products ordered by multiple customers).

  Payload — see ``Backend.CustomerOrders.NpdSync.upsert_sample_from_npd/2``
  docstring for the full shape. Minimum: ``npd_sample_payment_uuid``,
  ``customer_uuid``, ``customer_display_name``, ``item_uuid``,
  ``quantity``.

  Response mirrors the ``:sync`` shape with an extra ``sample_kind``
  flag so the caller can confirm the CO landed as a sample.
  """
  def sync_sample(conn, params) do
    company_id = conn.assigns.current_company_id

    case NpdSync.upsert_sample_from_npd(company_id, params) do
      {:ok, co} ->
        conn
        |> put_status(:ok)
        |> json(%{
          customer_order: %{
            uuid: co.uuid,
            status: co.status,
            sample_kind: co.sample_kind,
            customer_reference: co.customer_reference,
            inserted_at: co.inserted_at
          }
        })

      {:error, :missing_sample_uuid} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "missing_npd_sample_payment_uuid"})

      {:error, :invalid_sample_uuid} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "invalid_npd_sample_payment_uuid"})

      {:error, :item_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "item_not_found"})

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

  @doc """
  GET /api/integration/customer-orders/:uuid/snapshot

  Returns a lean customer-safe subset of ``OrderWizard.snapshot`` for
  the given CO — enough for the NPD portal to render a "where is my
  sample right now?" pipeline with the actual PSP phase + next-action
  copy, not just MO status. Called on every portal sample-detail
  fetch (no caching on PSP; the operator's view is authoritative).

  The response deliberately omits internal fields (MO tree, bookings,
  BOM lines, blockers with system-facing copy) — those would leak
  operations detail to the customer. Only the phase / next-action /
  coarse counts flow through.
  """
  def snapshot(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    case Ecto.UUID.cast(uuid) do
      :error ->
        conn |> put_status(:bad_request) |> json(%{error: "invalid_uuid"})

      {:ok, cast_uuid} ->
        case Repo.one(
               from co in CustomerOrder,
                 where:
                   co.company_id == ^company_id and co.uuid == ^cast_uuid,
                 limit: 1
             ) do
          nil ->
            conn
            |> put_status(:not_found)
            |> json(%{error: "customer_order_not_found"})

          %CustomerOrder{} = co ->
            snap = OrderWizard.snapshot(co)
            json(conn, %{snapshot: snapshot_payload(snap)})
        end
    end
  end

  # Minimal, customer-safe projection of OrderWizard.snapshot.
  # ``phase.key`` — the ordered enum tag PSP is on right now. That's
  # a safe atom (``production_planning``, ``awaiting_ingredients``,
  # etc.) the NPD side uses to look up its own customer-facing copy.
  #
  # Deliberately omitted from the wire (they belong to operators, not
  # customers):
  #
  #   * ``phase.label`` — operator-facing label ("Order setup",
  #     "Closeout") that reads as internal jargon.
  #   * ``next_action.title`` / ``next_action.detail`` — verbatim
  #     operator instructions like "Open MO MO00051 to finish
  #     bookings and signatures". The customer can't act on these.
  #   * ``next_action.code`` — internal action code coupled to PSP
  #     UI routes.
  #   * ``blockers`` list — carries operator-facing prose too.
  #
  # ``mo_count`` / ``mos_in_production`` — coarse counters the NPD
  # side can safely pluralise on ("your batch is being made") without
  # exposing MO ids or vendor identities.
  defp snapshot_payload(snap) do
    phase = snap.phase || %{}

    %{
      phase: %{
        key: to_string(phase[:key] || ""),
        index: phase[:index] || 0,
        total: phase[:total] || 0,
        is_terminal: phase[:is_terminal] || false
      },
      mo_count: length(snap.mos || []),
      mos_in_production:
        (snap.mos || [])
        |> Enum.count(fn mo -> mo.status in ["scheduled", "in_progress"] end)
    }
  end

  @doc """
  GET /api/integration/customer-orders/:uuid/invoices

  Returns every CustomerInvoice attached to the CO — enough for
  NPD's finance-payment detail page to render "invoices generated
  on PSP for this order" without asking the finance user to switch
  apps. Metadata only (amounts, dates, status, code). PDF download
  is a separate concern — the FE deep-links to PSP for the file
  when the operator wants the doc itself.
  """
  def invoices(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    case Ecto.UUID.cast(uuid) do
      :error ->
        conn |> put_status(:bad_request) |> json(%{error: "invalid_uuid"})

      {:ok, cast_uuid} ->
        case Repo.one(
               from co in CustomerOrder,
                 where:
                   co.company_id == ^company_id and co.uuid == ^cast_uuid,
                 select: co.id,
                 limit: 1
             ) do
          nil ->
            conn
            |> put_status(:not_found)
            |> json(%{error: "customer_order_not_found"})

          co_id ->
            invoices =
              Repo.all(
                from ci in CustomerInvoice,
                  where: ci.customer_order_id == ^co_id,
                  order_by: [desc: ci.inserted_at],
                  select: %{
                    uuid: ci.uuid,
                    kind: ci.kind,
                    status: ci.status,
                    currency_code: ci.currency_code,
                    subtotal: ci.subtotal,
                    tax_amount: ci.tax_amount,
                    grand_total: ci.grand_total,
                    invoice_date: ci.invoice_date,
                    due_date: ci.due_date,
                    sent_at: ci.sent_at,
                    cancelled_at: ci.cancelled_at,
                    inserted_at: ci.inserted_at
                  }
              )

            json(conn, %{invoices: invoices})
        end
    end
  end
end
