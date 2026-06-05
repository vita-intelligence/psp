defmodule BackendWeb.QueueController do
  @moduledoc """
  Read-only "needs attention" queues. Two endpoints today:

    * `GET /api/queues/reviews-due?window_days=30` — raw-material
      compliance reviews due (or overdue) within `window_days`.
      RBAC: `items.view`.
    * `GET /api/queues/certificates-expiring?window_days=30` —
      certificate attachments expiring (or expired) within
      `window_days`. RBAC: `items.view`.
  """

  use BackendWeb, :controller

  alias Backend.Queues
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "items.view"

  def reviews_due(conn, params) do
    actor = conn.assigns.current_user
    window = parse_window(params["window_days"])
    rows = Queues.reviews_due(actor.company_id, window)
    json(conn, %{items: Enum.map(rows, &review_payload/1), window_days: window})
  end

  def certificates_expiring(conn, params) do
    actor = conn.assigns.current_user
    window = parse_window(params["window_days"])
    rows = Queues.certificates_expiring(actor.company_id, window)
    json(conn, %{
      items: Enum.map(rows, &cert_payload/1),
      window_days: window
    })
  end

  defp parse_window(nil), do: 30
  defp parse_window(""), do: 30

  defp parse_window(s) when is_binary(s) do
    case Integer.parse(s) do
      {n, ""} when n > 0 and n <= 365 -> n
      _ -> 30
    end
  end

  defp parse_window(n) when is_integer(n) and n > 0 and n <= 365, do: n
  defp parse_window(_), do: 30

  defp review_payload(%{item: i, compliance: c}) do
    today = Date.utc_today()
    days_until = Date.diff(c.review_due_at, today)

    %{
      item: %{
        id: i.id,
        uuid: i.uuid,
        name: i.name,
        item_type: i.item_type,
        external_sku: i.external_sku
      },
      review_due_at: c.review_due_at,
      last_reviewed_at: c.last_reviewed_at,
      days_until_due: days_until,
      is_overdue: days_until < 0
    }
  end

  defp cert_payload(%{item: i, attachment: a}) do
    today = Date.utc_today()
    days_until = Date.diff(a.valid_until, today)

    %{
      item: %{
        id: i.id,
        uuid: i.uuid,
        name: i.name,
        item_type: i.item_type
      },
      certificate: %{
        uuid: a.certificate && a.certificate.uuid,
        name: a.certificate && a.certificate.name,
        certificate_type: a.certificate && a.certificate.certificate_type
      },
      certificate_number: a.certificate_number,
      valid_until: a.valid_until,
      days_until_expiry: days_until,
      is_expired: days_until < 0,
      document_url: a.document_url
    }
  end
end
