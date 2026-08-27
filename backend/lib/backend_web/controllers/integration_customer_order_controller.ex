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
  alias Backend.CustomerOrders.CustomerOrderLine
  alias Backend.CustomerOrders.NpdSync
  alias Backend.CustomerOrders.ProposalMerge
  alias Backend.OrderWizard
  alias Backend.Production.{FinalRelease, FinalReleaseFile, ManufacturingOrder}
  alias Backend.Repo
  alias Backend.Shipments
  alias Backend.Shipments.{Shipment, ShipmentPickupFile}

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
       when action in [
              :snapshot,
              :invoices,
              :release_documents,
              :serve_release_document,
              :dispatch,
              :serve_dispatch_photo,
              :confirm_delivery
            ]

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

  @doc """
  GET /api/integration/customer-orders/:uuid/release-documents

  Returns the Final Product Release files attached to this CO's
  root-MO release ceremony. Powers the "Release documents" card on
  the customer portal's sample detail page — each row carries
  enough metadata to render + download.

  Response shape:

  .. code-block:: json

      {
        "documents": [
          {
            "uuid": "…file uuid…",
            "kind": "coa" | "bmr" | "micro" | "label_proof" | "retain_sample",
            "filename": "coa-batch-42.pdf",
            "mime": "application/pdf",
            "byte_size": 158234,
            "uploaded_at": "2026-08-12T14:22:00Z"
          }
        ]
      }

  Empty ``documents`` array when the CO has no root-MO release yet
  (release ceremony hasn't been completed on PSP) — the FE renders
  nothing for that case rather than a "no docs" banner. File bytes
  are served via ``serve_release_document`` below.
  """
  def release_documents(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    case resolve_release_for_co(company_id, uuid) do
      {:error, :invalid_uuid} ->
        conn |> put_status(:bad_request) |> json(%{error: "invalid_uuid"})

      {:error, :co_not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "customer_order_not_found"})

      {:error, :no_release} ->
        # CO exists but no release ceremony on file yet — return
        # empty list so the caller can render a placeholder without
        # having to distinguish "not started" from "no data".
        json(conn, %{documents: []})

      {:ok, %FinalRelease{} = release} ->
        files =
          Repo.all(
            from f in FinalReleaseFile,
              where:
                f.production_final_release_id == ^release.id and
                  f.company_id == ^company_id,
              order_by: [asc: f.inserted_at, asc: f.id],
              select: %{
                uuid: f.uuid,
                kind: f.kind,
                filename: f.filename,
                mime: f.mime,
                byte_size: f.byte_size,
                uploaded_at: f.inserted_at
              }
          )

        json(conn, %{documents: files})
    end
  end

  @doc """
  GET /api/integration/customer-orders/:uuid/release-documents/:file_uuid

  Streams the file bytes for one Final Release document. Ownership
  is enforced by the join — the file must belong to a release
  whose MO belongs to the given CO, all inside the same company.
  A file uuid from a different tenant / different CO gets 404.

  Sets ``Content-Disposition: inline`` so PDFs preview in the
  portal iframe; non-PDFs download normally.
  """
  def serve_release_document(conn, %{"uuid" => uuid, "file_uuid" => file_uuid}) do
    company_id = conn.assigns.current_company_id

    with {:ok, %FinalRelease{} = release} <- resolve_release_for_co(company_id, uuid),
         %FinalReleaseFile{} = file <-
           Repo.get_by(FinalReleaseFile,
             uuid: file_uuid,
             company_id: company_id,
             production_final_release_id: release.id
           ),
         abs_path = Backend.Storage.Local.absolute_path(file.blob_path),
         true <- File.exists?(abs_path) do
      conn
      |> put_resp_header("content-type", file.mime)
      |> put_resp_header(
        "content-disposition",
        Backend.Http.ContentDisposition.header(:inline, file.filename)
      )
      |> send_file(200, abs_path)
    else
      {:error, :invalid_uuid} ->
        conn |> put_status(:bad_request) |> json(%{error: "invalid_uuid"})

      {:error, :co_not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "customer_order_not_found"})

      {:error, :no_release} ->
        conn |> put_status(:not_found) |> json(%{error: "no_release"})

      _ ->
        conn |> put_status(:not_found) |> json(%{error: "file_not_found"})
    end
  end

  @doc """
  GET /api/integration/customer-orders/:uuid/dispatch

  Returns the dispatch-confirmation snapshot for this CO's root-MO
  produced lot — what the coordinator filled on the paperwork step
  and the operator captured at truck arrival. Powers the "Dispatch"
  card on the customer portal's sample detail page.

  Response shape:

  .. code-block:: json

      {
        "dispatch": {
          "status": "picked_up" | "delivered",
          "ready_at": "2026-08-13T09:00:00Z",
          "picked_up_at": "2026-08-13T10:30:00Z",
          "delivered_at": null,
          "carrier": "DHL Express",
          "vehicle_registration": "AB12 CDE",
          "driver_name": "Alex Baker",
          "consignment_note_ref": "CN-92814",
          "tracking_number": "1Z999AA10123456784",
          "seal_number": null,
          "temperature_c": null,
          "checklist": {
            "packaging_intact": true,
            "labels_verified": true,
            "vehicle_clean_suitable": true,
            "transport_condition_acceptable": true,
            "dispatch_approved": true
          },
          "photos": [
            {
              "uuid": "…file uuid…",
              "filename": "loading-bay.jpg",
              "mime": "image/jpeg",
              "byte_size": 812345,
              "uploaded_at": "2026-08-13T10:29:00Z"
            }
          ]
        }
      }

  ``dispatch`` is ``null`` when no ``picked_up`` / ``delivered``
  shipment exists yet — the FE hides the section for that case
  rather than showing a placeholder. Photo bytes are served via
  ``serve_dispatch_photo`` below.
  """
  def dispatch(conn, %{"uuid" => uuid}) do
    company_id = conn.assigns.current_company_id

    case resolve_shipment_for_co(company_id, uuid) do
      {:error, :invalid_uuid} ->
        conn |> put_status(:bad_request) |> json(%{error: "invalid_uuid"})

      {:error, :co_not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "customer_order_not_found"})

      {:error, :no_dispatch} ->
        # CO exists but no picked_up / delivered shipment yet — the
        # truck hasn't left. Return null so the FE hides the card.
        json(conn, %{dispatch: nil})

      {:ok, %Shipment{} = ship} ->
        photos =
          Repo.all(
            from f in ShipmentPickupFile,
              where:
                f.shipment_id == ^ship.id and
                  f.company_id == ^company_id,
              order_by: [asc: f.inserted_at, asc: f.id],
              select: %{
                uuid: f.uuid,
                filename: f.filename,
                mime: f.mime,
                byte_size: f.byte_size,
                uploaded_at: f.inserted_at
              }
          )

        pickup_events = Backend.Shipments.list_pickup_events(ship)

        json(conn, %{
          dispatch: %{
            status: ship.status,
            qty: Decimal.to_string(ship.qty || Decimal.new(0)),
            picked_up_qty: Decimal.to_string(Backend.Shipments.picked_up_qty(ship)),
            remaining_qty: Decimal.to_string(Backend.Shipments.remaining_qty(ship)),
            ready_at: ship.ready_at,
            picked_up_at: ship.picked_up_at,
            delivered_at: ship.delivered_at,
            carrier: ship.carrier,
            vehicle_registration: ship.vehicle_registration,
            driver_name: ship.driver_name,
            consignment_note_ref: ship.consignment_note_ref,
            tracking_number: ship.tracking_number,
            seal_number: ship.seal_number,
            temperature_c: ship.temperature_c,
            checklist: %{
              packaging_intact: ship.packaging_intact,
              labels_verified: ship.labels_verified,
              vehicle_clean_suitable: ship.vehicle_clean_suitable,
              transport_condition_acceptable: ship.transport_condition_acceptable,
              dispatch_approved: ship.dispatch_approved
            },
            photos: photos,
            # Multi-visit pickup timeline. Customer-safe subset — no
            # PSP operator ids, no internal notes. One row per truck
            # arrival with qty + driver + timestamp + per-event
            # delivery state (customer can confirm each visit
            # independently via the portal). Empty on legacy
            # single-visit shipments.
            pickup_events:
              Enum.map(pickup_events, fn e ->
                %{
                  uuid: e.uuid,
                  qty: Decimal.to_string(e.qty),
                  picked_up_at: e.picked_up_at,
                  driver_name: e.driver_name,
                  vehicle_registration: e.vehicle_registration,
                  consignment_note_ref: e.consignment_note_ref,
                  # Per-truck paperwork. Editable on desktop post-
                  # departure — carriers regularly email the tracking
                  # number after the driver has left the site.
                  tracking_number: e.tracking_number,
                  seal_number: e.seal_number,
                  temperature_c: e.temperature_c && Decimal.to_string(e.temperature_c),
                  notes: e.notes,
                  # BRCGS § 5.4.6 checklist captured on the mobile
                  # dispatch form for this specific truck. Ships as a
                  # nested map to match the shipment-level checklist
                  # shape the sample-detail portal already renders.
                  checklist: %{
                    packaging_intact: e.packaging_intact,
                    labels_verified: e.labels_verified,
                    vehicle_clean_suitable: e.vehicle_clean_suitable,
                    transport_condition_acceptable: e.transport_condition_acceptable,
                    dispatch_approved: e.dispatch_approved
                  },
                  delivered_at: e.delivered_at,
                  recipient_signatory: e.recipient_signatory,
                  delivery_notes: e.delivery_notes,
                  # BRCGS § 5.4.6 evidence photos captured on the
                  # mobile dispatch form. Customer-safe subset — no
                  # blob paths or uploader ids leak through the wire.
                  # Portal renders these under each event's row so
                  # the customer sees exactly what left the site.
                  photos:
                    case e.photos do
                      list when is_list(list) ->
                        Enum.map(list, fn photo ->
                          %{
                            uuid: photo.uuid,
                            filename: photo.filename,
                            mime: photo.mime
                          }
                        end)

                      _ ->
                        []
                    end
                }
              end)
          }
        })
    end
  end

  @doc """
  GET /api/integration/customer-orders/:uuid/dispatch/photos/:file_uuid

  Streams the bytes of one truck-arrival photo. Ownership guarded
  by the join — the file must belong to a shipment whose produced
  lot belongs to the given CO, all inside the same company.

  Sets ``Content-Disposition: inline`` so browsers render the image
  in the portal's dispatch card lightbox / thumbnail.
  """
  def serve_dispatch_photo(conn, %{"uuid" => uuid, "file_uuid" => file_uuid}) do
    company_id = conn.assigns.current_company_id

    with {:ok, %Shipment{} = ship} <- resolve_shipment_for_co(company_id, uuid),
         %ShipmentPickupFile{} = file <-
           Repo.get_by(ShipmentPickupFile,
             uuid: file_uuid,
             company_id: company_id,
             shipment_id: ship.id
           ),
         abs_path = Backend.Storage.Local.absolute_path(file.blob_path),
         true <- File.exists?(abs_path) do
      conn
      |> put_resp_header("content-type", file.mime)
      |> put_resp_header(
        "content-disposition",
        Backend.Http.ContentDisposition.header(:inline, file.filename)
      )
      |> send_file(200, abs_path)
    else
      {:error, :invalid_uuid} ->
        conn |> put_status(:bad_request) |> json(%{error: "invalid_uuid"})

      {:error, :co_not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "customer_order_not_found"})

      {:error, :no_dispatch} ->
        conn |> put_status(:not_found) |> json(%{error: "no_dispatch"})

      _ ->
        conn |> put_status(:not_found) |> json(%{error: "file_not_found"})
    end
  end

  @doc """
  POST /api/integration/customer-orders/:uuid/dispatch/confirm-delivery

  Customer-driven POD. Called from the portal's "I received it"
  button on the sample detail page. Flips the CO's live shipment
  from ``picked_up`` to ``delivered`` and stamps the confirmation
  metadata:

    * ``recipient_signatory`` (required) — the customer's name off
      their portal profile (or a typed override in the modal).
    * ``delivery_notes`` (optional) — anything the customer wants
      to record ("box was dented", "arrived on time", …).

  ``delivered_by_id`` stays nil — portal customers aren't PSP
  :class:`User` rows. The audit event carries ``action:
  "portal_confirmed_delivery"`` so a staff review can distinguish
  customer-confirmed from staff-confirmed POD.

  Idempotent shape: hitting this on an already-``delivered`` shipment
  returns 409 rather than double-stamping. Draft / ready / cancelled
  shipments return 422 — the customer can't confirm what hasn't
  physically left the warehouse.
  """
  def confirm_delivery(conn, %{"uuid" => uuid} = params) do
    company_id = conn.assigns.current_company_id

    signatory = sanitise(params["recipient_signatory"])
    notes = sanitise(params["delivery_notes"])

    if signatory in [nil, ""] do
      conn
      |> put_status(:unprocessable_entity)
      |> json(%{error: "recipient_signatory_required"})
    else
      attrs = %{"recipient_signatory" => signatory}
      attrs = if notes, do: Map.put(attrs, "delivery_notes", notes), else: attrs

      case resolve_shipment_for_co(company_id, uuid) do
        {:error, :invalid_uuid} ->
          conn |> put_status(:bad_request) |> json(%{error: "invalid_uuid"})

        {:error, :co_not_found} ->
          conn |> put_status(:not_found) |> json(%{error: "customer_order_not_found"})

        {:error, :no_dispatch} ->
          conn |> put_status(:not_found) |> json(%{error: "no_dispatch"})

        {:ok, %Shipment{status: "delivered"}} ->
          conn |> put_status(:conflict) |> json(%{error: "already_delivered"})

        {:ok, %Shipment{status: "picked_up"} = ship} ->
          case Shipments.confirm_delivery_from_portal(ship, attrs) do
            {:ok, %Shipment{} = updated} ->
              json(conn, %{
                dispatch: %{
                  status: updated.status,
                  delivered_at: updated.delivered_at,
                  recipient_signatory: updated.recipient_signatory,
                  delivery_notes: updated.delivery_notes
                }
              })

            {:error, :invalid_status} ->
              conn
              |> put_status(:unprocessable_entity)
              |> json(%{error: "invalid_status"})

            {:error, changeset} ->
              conn
              |> put_status(:unprocessable_entity)
              |> json(%{error: "invalid", changeset: to_changeset_errors(changeset)})
          end

        {:ok, %Shipment{status: other}} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: "invalid_status", status: other})
      end
    end
  end

  @doc """
  Portal-driven POD for ONE pickup event. Each event confirms
  independently — the customer taps "Confirm receipt" on the
  Tuesday truck's row without affecting Thursday's row.

  Body: ``{"recipient_signatory": "...", "delivery_notes": "..."}``.
  ``recipient_signatory`` required.
  """
  def confirm_event_delivery(conn, %{
        "uuid" => co_uuid,
        "event_uuid" => event_uuid
      } = params) do
    company_id = conn.assigns.current_company_id

    signatory = sanitise(params["recipient_signatory"])
    notes = sanitise(params["delivery_notes"])

    if signatory in [nil, ""] do
      conn
      |> put_status(:unprocessable_entity)
      |> json(%{error: "recipient_signatory_required"})
    else
      attrs = %{"recipient_signatory" => signatory, "source" => "portal"}
      attrs = if notes, do: Map.put(attrs, "delivery_notes", notes), else: attrs

      case resolve_shipment_for_co(company_id, co_uuid) do
        {:error, :invalid_uuid} ->
          conn |> put_status(:bad_request) |> json(%{error: "invalid_uuid"})

        {:error, :co_not_found} ->
          conn |> put_status(:not_found) |> json(%{error: "customer_order_not_found"})

        {:error, :no_dispatch} ->
          conn |> put_status(:not_found) |> json(%{error: "no_dispatch"})

        {:ok, %Shipment{} = ship} ->
          case Shipments.get_pickup_event(ship.id, event_uuid) do
            nil ->
              conn |> put_status(:not_found) |> json(%{error: "event_not_found"})

            %Backend.Shipments.ShipmentPickupEvent{delivered_at: nil} = event ->
              case Shipments.confirm_pickup_event_delivery(nil, event, attrs) do
                {:ok, {updated_event, _}} ->
                  json(conn, %{
                    event: %{
                      uuid: updated_event.uuid,
                      qty: Decimal.to_string(updated_event.qty),
                      picked_up_at: updated_event.picked_up_at,
                      delivered_at: updated_event.delivered_at,
                      recipient_signatory: updated_event.recipient_signatory,
                      delivery_notes: updated_event.delivery_notes
                    }
                  })

                {:error, changeset} ->
                  conn
                  |> put_status(:unprocessable_entity)
                  |> json(%{error: "invalid", changeset: to_changeset_errors(changeset)})
              end

            _already_delivered ->
              conn |> put_status(:conflict) |> json(%{error: "already_delivered"})
          end
      end
    end
  end

  # Portal-driven routing choice for a bespoke NPD-formulation CO.
  # NPD relays the customer's submit here. Body:
  #
  #     %{"choice" => "three_pl" | "shipment"}
  #
  # Preconditions checked by the context module: request must exist
  # (wizard's ``load_or_create_routing_request`` spawns it on first
  # Final Release), current state must be ``awaiting_customer``.
  def routing_choice(conn, %{"uuid" => uuid, "choice" => choice})
      when choice in ["three_pl", "shipment"] do
    company_id = conn.assigns.current_company_id

    with {:ok, cast_uuid} <- cast_uuid(uuid),
         %CustomerOrder{} = co <-
           Repo.one(
             from co in CustomerOrder,
               where: co.company_id == ^company_id and co.uuid == ^cast_uuid,
               limit: 1
           ) do
      case Backend.ThreePL.Requests.customer_choose(co, choice, nil) do
        {:ok, request} ->
          json(conn, %{routing_request: routing_request_public(request)})

        {:error, :no_request} ->
          conn
          |> put_status(:conflict)
          |> json(%{error: "no_request"})

        {:error, {:wrong_state, state}} ->
          conn
          |> put_status(:conflict)
          |> json(%{error: "wrong_state", state: state})

        {:error, %Ecto.Changeset{} = cs} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: "invalid", changeset: to_changeset_errors(cs)})

        {:error, other} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: "routing_failed", reason: inspect(other)})
      end
    else
      {:error, :invalid_uuid} ->
        conn |> put_status(:bad_request) |> json(%{error: "invalid_uuid"})

      nil ->
        conn |> put_status(:not_found) |> json(%{error: "customer_order_not_found"})
    end
  end

  def routing_choice(conn, %{"choice" => _}) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "bad_choice"})
  end

  def routing_choice(conn, _) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: "choice_required"})
  end

  # Portal-safe echo of a routing request row.
  defp routing_request_public(%Backend.ThreePL.RoutingRequest{} = req) do
    %{
      uuid: req.uuid,
      state: req.state,
      customer_choice: req.customer_choice,
      team_decision_reason: req.team_decision_reason,
      customer_chose_at: req.customer_chose_at,
      team_reviewed_at: req.team_reviewed_at,
      estimate_snapshot: req.estimate_snapshot
    }
  end

  defp sanitise(v) when is_binary(v) do
    trimmed = String.trim(v)
    if trimmed == "", do: nil, else: trimmed
  end

  defp sanitise(_), do: nil

  defp to_changeset_errors(%Ecto.Changeset{} = cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end

  # Walks CO → root MO → produced lot → live shipment
  # (partially_picked / picked_up / delivered — draft/ready aren't
  # customer-visible; the goods are still on our floor). One
  # shipment per output lot is the model today so ``limit: 1`` is
  # deterministic.
  defp resolve_shipment_for_co(company_id, uuid) do
    with {:ok, cast_uuid} <- cast_uuid(uuid),
         %CustomerOrder{id: co_id} <- fetch_co(company_id, cast_uuid),
         %ManufacturingOrder{produced_lot_id: lot_id} when is_integer(lot_id) <-
           fetch_root_mo_for_co(company_id, co_id),
         %Shipment{} = ship <-
           Repo.one(
             from s in Shipment,
               where:
                 s.company_id == ^company_id and
                   s.stock_lot_id == ^lot_id and
                   s.status in ["partially_picked", "picked_up", "delivered"],
               order_by: [desc: s.picked_up_at, desc: s.id],
               limit: 1
           ) do
      {:ok, ship}
    else
      :error -> {:error, :invalid_uuid}
      nil -> {:error, :co_not_found_or_no_dispatch}
      other -> other
    end
    |> case do
      {:error, :co_not_found_or_no_dispatch} ->
        case cast_uuid(uuid) do
          :error ->
            {:error, :invalid_uuid}

          {:ok, cast} ->
            case fetch_co(company_id, cast) do
              nil -> {:error, :co_not_found}
              _ -> {:error, :no_dispatch}
            end
        end

      pass -> pass
    end
  end

  # Walks CO → root MO (line's finished-product MO, parent_mo_id nil)
  # → FinalRelease. Returns ``{:ok, release}`` or a tagged error the
  # caller maps to the right HTTP status. The release is the ONE row
  # per finished-product MO — no siblings to disambiguate.
  defp resolve_release_for_co(company_id, uuid) do
    with {:ok, cast_uuid} <- cast_uuid(uuid),
         %CustomerOrder{id: co_id} <- fetch_co(company_id, cast_uuid),
         %ManufacturingOrder{id: root_mo_id} <-
           fetch_root_mo_for_co(company_id, co_id),
         %FinalRelease{} = release <-
           Repo.get_by(FinalRelease,
             company_id: company_id,
             manufacturing_order_id: root_mo_id
           ) do
      {:ok, release}
    else
      :error -> {:error, :invalid_uuid}
      nil -> {:error, :co_not_found_or_no_release_route}
      # ``fetch_co`` returns nil on miss; ``fetch_root_mo_for_co`` +
      # ``Repo.get_by`` also return nil. Discriminate by re-checking
      # the CO row so the caller can surface the right message.
      other -> other
    end
    |> case do
      {:error, :co_not_found_or_no_release_route} ->
        case cast_uuid(uuid) do
          :error ->
            {:error, :invalid_uuid}

          {:ok, cast_uuid} ->
            case fetch_co(company_id, cast_uuid) do
              nil -> {:error, :co_not_found}
              _ -> {:error, :no_release}
            end
        end

      other ->
        other
    end
  end

  defp cast_uuid(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} -> {:ok, cast}
      :error -> :error
    end
  end

  defp fetch_co(company_id, uuid) do
    Repo.one(
      from co in CustomerOrder,
        where: co.company_id == ^company_id and co.uuid == ^uuid,
        select: %CustomerOrder{id: co.id, uuid: co.uuid, company_id: co.company_id},
        limit: 1
    )
  end

  # The finished-product MO is the root of the tree (parent_mo_id
  # nil) attached to one of this CO's lines. Filters cancelled MOs
  # so a freshly re-created root supersedes an earlier tombstone.
  defp fetch_root_mo_for_co(company_id, co_id) do
    Repo.one(
      from mo in ManufacturingOrder,
        join: line in CustomerOrderLine,
        on: line.id == mo.customer_order_line_id,
        where:
          mo.company_id == ^company_id and
            line.customer_order_id == ^co_id and
            is_nil(mo.parent_mo_id) and
            mo.status != "cancelled",
        order_by: [desc: mo.inserted_at],
        limit: 1
    )
  end
end
