defmodule BackendWeb.IntegrationCustomerDispatchRequestListController do
  @moduledoc """
  `GET /api/integration/customer-dispatch-requests/:customer_uuid` —
  every dispatch request (any status) the customer has queued, newest
  first. Sister endpoint to ``customer-bailee-inventory``; powers the
  portal's `/portal/warehouse/requests` history page.

  Query params:
    * `q` — case-insensitive substring; matches on item name, lot
      code, the operator's own `reference`, and dispatch `notes`.
    * `status` — filter to `pending` / `completed` / `cancelled` /
      `return_pending`. Omit to return every row.
    * `lot_uuid` — narrow to a single lot (portal "view requests for
      this lot" affordance).
    * `cursor` — opaque; from a previous response's `next_cursor`.
    * `limit` — 1..100, default 25.

  Response envelope carries `next_cursor` so the portal can
  infinite-scroll the requests list without a page-boundary boundary.
  The `summary` counts are unpaginated (one grouped COUNT(*) per
  customer) so the header pills stay accurate as the customer
  scrolls.

  Each request row also carries the paperwork snapshot the customer
  typed at request time (recipient / address / country / email /
  phone) and — once the dispatch is `completed` and the outbound
  shipment has moved through Ready → Pickup — the linked shipment's
  pickup events (driver, vehicle reg, checklist ticks, tracking, seal,
  photos). Photo URLs point at the portal-authed proxy served by the
  vita-cff / web-site proxies.

  Ownership scope: PSP resolves the customer via the same dual-uuid
  lookup as :func:`Backend.ThreePL.list_bailee_lots_for_customer/3`
  (native `uuid` OR `npd_source_uuid`), then only returns rows whose
  lot's `bailee_customer_id` matches. No cross-customer leak paths.
  """

  use BackendWeb, :controller

  import Ecto.Query

  alias Backend.Repo
  alias Backend.Shipments.Shipment
  alias Backend.ThreePL
  alias Backend.ThreePL.Dispatch
  alias BackendWeb.Payloads

  action_fallback BackendWeb.FallbackController

  @doc """
  `GET /api/integration/customer-dispatch-requests/:request_uuid/pickup-photos/:file_uuid?customer_uuid=...`

  Streams a pickup-loading photo to the portal proxy. Auth guardrails:

    * Integration pipeline already asserts a valid company token and
      pins `current_company_id`.
    * ``customer_uuid`` query param (required) is verified against
      the linked lot's ``bailee_customer_id`` via the dual-uuid
      resolver — this is the customer-ownership check that prevents
      customer A from swapping in customer B's file uuid within the
      same company.
    * The linked shipment's ``stock_lot_id`` must match the photo's
      parent shipment — same lot, same customer, same file.
  """
  def photo(conn, %{"request_uuid" => request_uuid, "file_uuid" => file_uuid} = params) do
    company_id = conn.assigns.current_company_id
    customer_uuid = params["customer_uuid"]

    with %Dispatch{} = dispatch <- fetch_dispatch(company_id, request_uuid),
         :ok <- ensure_customer_owns_dispatch(company_id, customer_uuid, dispatch),
         %Shipment{id: shipment_id} <- fetch_shipment_for_dispatch(company_id, dispatch),
         %Backend.Shipments.ShipmentPickupFile{} = file <-
           Backend.Shipments.get_pickup_file(shipment_id, file_uuid),
         abs_path = Backend.Storage.Local.absolute_path(file.blob_path),
         true <- File.exists?(abs_path) do
      conn
      |> put_resp_content_type(file.mime || "application/octet-stream")
      |> put_resp_header(
        "content-disposition",
        Backend.Http.ContentDisposition.header(:inline, file.filename)
      )
      |> send_file(200, abs_path)
    else
      _ ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "not_found", detail: "Photo not found."})
    end
  end

  @doc """
  `POST /api/integration/customer-dispatch-requests/:request_uuid/confirm-delivery`

  Customer confirms receipt of a picked-up shipment. Body:

      {
        "customer_uuid": "…",           # required — ownership scope
        "recipient_signatory": "…",     # required — signer's name
        "delivery_notes": "…"           # optional
      }

  Verifies:
    * dispatch belongs to the caller's company
    * dispatch's lot's bailee_customer matches ``customer_uuid``
      (via dual-uuid resolver)
    * a non-cancelled shipment exists for the same lot

  Delegates to ``Backend.Shipments.confirm_delivery_from_portal/2``
  which confirms every outstanding pickup event on the shipment and
  reprojects status to ``delivered``. Idempotent — replaying against
  an already-delivered shipment returns the current snapshot.

  Returns the refreshed dispatch-request payload so the caller can
  re-render without a follow-up list fetch.
  """
  def confirm_delivery(conn, %{"request_uuid" => request_uuid} = params) do
    company_id = conn.assigns.current_company_id
    customer_uuid = params["customer_uuid"]
    signatory = String.trim(to_string(params["recipient_signatory"] || ""))
    notes = params["delivery_notes"]

    # Resolve ownership + dispatch up front so success + idempotent
    # replays share the same "return the refreshed row" path without
    # relying on ``with`` bindings leaking into ``else``.
    case fetch_dispatch(company_id, request_uuid) do
      nil ->
        not_found_dispatch(conn)

      %Dispatch{} = dispatch ->
        with :ok <- ensure_customer_owns_dispatch(company_id, customer_uuid, dispatch),
             %Shipment{} = shipment <- fetch_shipment_for_dispatch(company_id, dispatch),
             :ok <- ensure_signatory(signatory) do
          case Backend.Shipments.confirm_delivery_from_portal(shipment, %{
                 "recipient_signatory" => signatory,
                 "delivery_notes" => notes
               }) do
            {:ok, _result} ->
              respond_with_refreshed(conn, company_id, dispatch)

            # Idempotency — a portal double-tap or a stale refresh
            # after the customer already confirmed shouldn't error.
            {:error, :already_delivered} ->
              respond_with_refreshed(conn, company_id, dispatch)

            {:error, reason} ->
              conn
              |> put_status(:unprocessable_entity)
              |> json(%{error: "confirm_failed", detail: inspect(reason)})
          end
        else
          {:error, :missing_signatory} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{error: "missing_signatory", detail: "Please enter who received the parcel."})

          {:error, :not_owner} ->
            not_found_dispatch(conn)

          nil ->
            not_found_dispatch(conn)

          _ ->
            not_found_dispatch(conn)
        end
    end
  end

  defp respond_with_refreshed(conn, company_id, %Dispatch{} = dispatch) do
    reloaded = Repo.preload(dispatch, stock_lot: [:item, :unit_of_measurement])
    shipments_by_lot = load_shipments_for(company_id, [reloaded])
    json(conn, %{request: request_payload(reloaded, shipments_by_lot)})
  end

  defp not_found_dispatch(conn) do
    conn
    |> put_status(:not_found)
    |> json(%{error: "not_found", detail: "Dispatch request not found."})
  end

  defp fetch_dispatch(company_id, request_uuid) when is_binary(request_uuid) do
    Repo.get_by(Dispatch, company_id: company_id, uuid: request_uuid)
  rescue
    Ecto.Query.CastError -> nil
  end

  defp fetch_shipment_for_dispatch(company_id, %Dispatch{stock_lot_id: lot_id}) do
    Repo.one(
      from s in Shipment,
        where:
          s.company_id == ^company_id and
            s.stock_lot_id == ^lot_id and
            s.status != "cancelled",
        order_by: [desc: s.inserted_at, desc: s.id],
        limit: 1
    )
  end

  # Customer ownership: the dispatch's lot must belong to a
  # bailee_customer whose PSP-native uuid OR npd_source_uuid matches
  # the caller-supplied ``customer_uuid``. Same dual-uuid resolver
  # ``list_bailee_lots_for_customer`` uses so the check accepts both
  # PSP-side callers (native uuid) and NPD-side portal proxy calls
  # (Django Customer.id via npd_source_uuid).
  defp ensure_customer_owns_dispatch(_company_id, uuid, _dispatch)
       when not is_binary(uuid) or uuid == "",
       do: {:error, :not_owner}

  defp ensure_customer_owns_dispatch(company_id, customer_uuid, %Dispatch{stock_lot_id: lot_id}) do
    lot = Repo.get(Backend.Stock.Lot, lot_id)
    if lot == nil, do: {:error, :not_owner}, else: check_bailee_customer(company_id, customer_uuid, lot.bailee_customer_id)
  rescue
    Ecto.Query.CastError -> {:error, :not_owner}
  end

  defp check_bailee_customer(_company_id, _customer_uuid, nil), do: {:error, :not_owner}

  defp check_bailee_customer(company_id, customer_uuid, bailee_customer_id) do
    resolved =
      Repo.get_by(Backend.Customers.Customer,
        company_id: company_id,
        uuid: customer_uuid
      ) ||
        Repo.get_by(Backend.Customers.Customer,
          company_id: company_id,
          npd_source_uuid: customer_uuid
        )

    case resolved do
      %Backend.Customers.Customer{id: id} when id == bailee_customer_id -> :ok
      _ -> {:error, :not_owner}
    end
  rescue
    Ecto.Query.CastError -> {:error, :not_owner}
  end

  defp ensure_signatory(""), do: {:error, :missing_signatory}
  defp ensure_signatory(_), do: :ok

  def index(conn, %{"customer_uuid" => customer_uuid} = params) do
    company_id = conn.assigns.current_company_id

    opts =
      []
      |> maybe_put(:status, sanitise_status(params["status"]))
      |> maybe_put(:lot_uuid, sanitise_uuid(params["lot_uuid"]))
      |> maybe_put(:q, sanitise_q(params["q"]))
      |> maybe_put(:cursor, sanitise_q(params["cursor"]))
      |> maybe_put(:limit, sanitise_limit(params["limit"]))

    {rows, next_cursor} =
      ThreePL.list_dispatch_requests_for_customer(
        company_id,
        customer_uuid,
        opts
      )

    shipments_by_lot = load_shipments_for(company_id, rows)
    request_rows = Enum.map(rows, &request_payload(&1, shipments_by_lot))

    counts = ThreePL.dispatch_request_counts_for_customer(company_id, customer_uuid)
    customer = first_customer(rows) || fallback_customer(company_id, customer_uuid)

    json(conn, %{
      customer: customer,
      summary: counts,
      requests: request_rows,
      next_cursor: next_cursor
    })
  end

  # -----------------------------------------------------------------
  # Shipment enrichment — one query per page, matched by lot_id. The
  # ThreePL flow is 1:1 (a bailee dispatch spawns one outbound
  # shipment) so grouping by lot_id + picking the most recent non-
  # cancelled row is enough. Preloads pickup_events with photos so
  # the portal can render driver / vehicle / checklist / thumbnails
  # without a second round-trip.
  # -----------------------------------------------------------------

  defp load_shipments_for(_company_id, []), do: %{}

  defp load_shipments_for(company_id, dispatches) do
    lot_ids =
      dispatches
      |> Enum.map(& &1.stock_lot_id)
      |> Enum.uniq()

    from(s in Shipment,
      where:
        s.company_id == ^company_id and
          s.stock_lot_id in ^lot_ids and
          s.status != "cancelled",
      order_by: [desc: s.inserted_at, desc: s.id],
      preload: [
        pickup_events: [:photos, :picked_up_by],
        pickup_files: []
      ]
    )
    |> Repo.all()
    |> Enum.group_by(& &1.stock_lot_id)
  end

  # ---- Payload shapers ----

  defp request_payload(%Dispatch{} = d, shipments_by_lot) do
    lot = d.stock_lot
    linked = shipments_by_lot |> Map.get(d.stock_lot_id, []) |> List.first()

    %{
      "uuid" => d.uuid,
      "status" => d.status,
      "qty" => decimal_to_string(d.qty),
      "reference" => d.reference,
      "notes" => d.notes,
      "source" => d.source,
      "external_reference" => d.external_reference,
      "requested_at" => iso_or_nil(d.requested_at),
      "dispatched_at" => iso_or_nil(d.dispatched_at),
      "lot" => lot_summary(lot),
      # Ship-to snapshot the customer typed in the portal dispatch
      # dialog. Present on every row (fresh flows always fill it; old
      # rows may have nulls until the operator amends on desktop).
      "ship_to" => ship_to_payload(d),
      # Linked bailee shipment progress + evidence. Nil until the
      # operator walks the lot to the shipping bay (Dispatch flips to
      # ``completed`` at that point). Fills in as the flow advances
      # through Paperwork → Pickup → Delivered.
      "shipment" => shipment_payload(d, linked)
    }
  end

  defp lot_summary(nil), do: nil

  defp lot_summary(lot) do
    %{
      "uuid" => lot.uuid,
      "code" => Payloads.render_entity_code(lot, "stock_lot"),
      "item" => %{
        "name" => lot.item && lot.item.name,
        "code" => Payloads.render_entity_code(lot.item, "item")
      },
      "unit_of_measurement" => %{
        "symbol" =>
          (lot.unit_of_measurement && lot.unit_of_measurement.symbol) || ""
      }
    }
  end

  defp ship_to_payload(%Dispatch{} = d) do
    %{
      "name" => d.ship_to_name,
      "address" => d.ship_to_address,
      "country" => d.ship_to_country,
      "email" => d.ship_to_email,
      "phone" => d.ship_to_phone
    }
  end

  defp shipment_payload(_dispatch, nil), do: nil

  defp shipment_payload(%Dispatch{uuid: request_uuid}, %Shipment{} = s) do
    events =
      s.pickup_events
      |> case do
        list when is_list(list) -> list
        _ -> []
      end
      |> Enum.sort_by(& &1.picked_up_at, {:asc, DateTime})

    %{
      "uuid" => s.uuid,
      "status" => s.status,
      "carrier" => s.carrier,
      "tracking_number" => s.tracking_number,
      "planned_ship_at" => iso_or_nil(s.planned_ship_at),
      "ready_at" => iso_or_nil(s.ready_at),
      "picked_up_at" => iso_or_nil(s.picked_up_at),
      "delivered_at" => iso_or_nil(s.delivered_at),
      "recipient_signatory" => s.recipient_signatory,
      "delivery_notes" => s.delivery_notes,
      "picked_up_qty" =>
        decimal_to_string(Backend.Shipments.picked_up_qty(s)),
      "remaining_qty" =>
        decimal_to_string(Backend.Shipments.remaining_qty(s)),
      "pickup_events" => Enum.map(events, &pickup_event_payload(&1, request_uuid))
    }
  end

  defp pickup_event_payload(event, request_uuid) do
    %{
      "uuid" => event.uuid,
      "qty" => decimal_to_string(event.qty),
      "picked_up_at" => iso_or_nil(event.picked_up_at),
      "driver_name" => event.driver_name,
      "vehicle_registration" => event.vehicle_registration,
      "consignment_note_ref" => event.consignment_note_ref,
      "tracking_number" => event.tracking_number,
      "seal_number" => event.seal_number,
      "temperature_c" => decimal_to_string(event.temperature_c),
      "notes" => event.notes,
      "packaging_intact" => event.packaging_intact,
      "labels_verified" => event.labels_verified,
      "vehicle_clean_suitable" => event.vehicle_clean_suitable,
      "transport_condition_acceptable" => event.transport_condition_acceptable,
      "dispatch_approved" => event.dispatch_approved,
      "operator" =>
        case event.picked_up_by do
          %_{name: name} when is_binary(name) -> %{"name" => name}
          _ -> nil
        end,
      "photos" =>
        Enum.map(event.photos || [], fn photo ->
          %{
            "uuid" => photo.uuid,
            "filename" => photo.filename,
            "mime" => photo.mime,
            # Portal-facing URL; the vita-cff / web-site proxies serve
            # ``/api/portal/warehouse/dispatch-requests/:req/pickup-photos/:file``
            # against a session cookie and then reach PSP with the
            # integration token. Keep in sync with the proxy routes.
            "url" =>
              "/api/portal/warehouse/dispatch-requests/" <>
                request_uuid <> "/pickup-photos/" <> photo.uuid
          }
        end)
    }
  end

  # Reuses the ``bailee_customer`` from the joined lot preload — same
  # optimisation as the sister inventory endpoint.
  defp first_customer([%{stock_lot: %{bailee_customer: _}} = _row | _]), do: nil
  defp first_customer(_), do: nil

  defp fallback_customer(company_id, customer_uuid) do
    resolved =
      Backend.Repo.get_by(Backend.Customers.Customer,
        company_id: company_id,
        uuid: customer_uuid
      ) ||
        Backend.Repo.get_by(Backend.Customers.Customer,
          company_id: company_id,
          npd_source_uuid: customer_uuid
        )

    case resolved do
      nil -> %{"uuid" => customer_uuid, "name" => nil}
      c -> %{"uuid" => c.uuid, "name" => c.name}
    end
  rescue
    Ecto.Query.CastError -> %{"uuid" => customer_uuid, "name" => nil}
  end

  defp sanitise_status(s) when is_binary(s) do
    if s in Dispatch.statuses(), do: s, else: nil
  end

  defp sanitise_status(_), do: nil

  defp sanitise_uuid(s) when is_binary(s) do
    trimmed = String.trim(s)
    if trimmed == "", do: nil, else: trimmed
  end

  defp sanitise_uuid(_), do: nil

  defp sanitise_q(s) when is_binary(s) do
    trimmed = String.trim(s)
    if trimmed == "", do: nil, else: trimmed
  end

  defp sanitise_q(_), do: nil

  defp sanitise_limit(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} when n > 0 -> min(n, 100)
      _ -> nil
    end
  end

  defp sanitise_limit(_), do: nil

  defp maybe_put(kw, _key, nil), do: kw
  defp maybe_put(kw, key, val), do: Keyword.put(kw, key, val)

  defp decimal_to_string(nil), do: nil
  defp decimal_to_string(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp decimal_to_string(other), do: to_string(other)

  defp iso_or_nil(nil), do: nil
  defp iso_or_nil(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp iso_or_nil(_), do: nil
end
