defmodule BackendWeb.TodayController do
  @moduledoc """
  "Today's contacts" — single endpoint that powers the daily CRM
  follow-up surface. Returns three buckets (due today / overdue /
  going quiet) of customer summaries the salesperson should reach
  out to.

  Read-only and inexpensive — no pagination needed at this scale
  (the lists are bounded server-side; if a company crosses 100s of
  overdue rows the dashboard becomes useless anyway and the cure is
  to assign accounts, not paginate).
  """

  use BackendWeb, :controller

  alias Backend.TodaysContacts
  alias BackendWeb.Payloads
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "customers.view" when action in [:index]

  action_fallback BackendWeb.FallbackController

  def index(conn, _params) do
    actor = conn.assigns.current_user
    %{due_today: due, overdue: overdue, going_quiet: quiet} =
      TodaysContacts.today_buckets(actor.company_id)

    json(conn, %{
      due_today: Enum.map(due, &Payloads.today_customer/1),
      overdue: Enum.map(overdue, &Payloads.today_customer/1),
      going_quiet: Enum.map(quiet, &Payloads.today_customer/1)
    })
  end
end
