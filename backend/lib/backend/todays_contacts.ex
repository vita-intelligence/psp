defmodule Backend.TodaysContacts do
  @moduledoc """
  The "Today's contacts" CRM surface — what the salesperson should
  actually be doing right now.

  This module is a thin projection over the customer cadence columns
  (`last_contact_at` / `next_contact_at`) that are kept current by
  `Backend.Customers.log_contact_event/3`. Nothing is denormalised
  here; the buckets are pure read-time derivations so they stay
  trustworthy as the underlying customer rows move.

  Buckets:

    * `due_today` — `next_contact_at::date = today`. The cadence
      cycle has landed; reach out.
    * `overdue` — `next_contact_at::date < today`. You missed the
      cadence; the longer it sits, the colder the lead.
    * `going_quiet` — approved customers with `next_contact_at` more
      than 1.5× their cadence in the future (i.e. snoozed too far)
      OR ordering customers (`total_orders_count > 0`) whose
      `last_contact_at` is older than `contact_frequency_months` —
      they're slipping into dormant before the next_contact_at
      cadence even catches it.

  Inactive customers (`is_active = false`) and rejected customers
  are excluded across the board.
  """

  import Ecto.Query, warn: false

  alias Backend.Customers.Customer
  alias Backend.Repo

  @doc """
  Returns `%{due_today: [...], overdue: [...], going_quiet: [...]}`
  scoped to the given company. Each list is a `Customer` row with
  enough preloads to render the page without N+1.

  Sort:
    * `due_today` by next_contact_at ASC (oldest miss first)
    * `overdue` by next_contact_at ASC (deepest delinquency first)
    * `going_quiet` by last_contact_at ASC (longest silent first)
  """
  def today_buckets(company_id) when is_integer(company_id) do
    today = Date.utc_today()
    today_start = DateTime.new!(today, ~T[00:00:00])
    today_end = DateTime.new!(today, ~T[23:59:59])

    base =
      from(c in Customer,
        where:
          c.company_id == ^company_id and
            c.is_active == true and
            c.approval_status != "rejected"
      )

    due_today =
      base
      |> where([c], c.next_contact_at >= ^today_start and c.next_contact_at <= ^today_end)
      |> order_by([c], asc: c.next_contact_at)
      |> Repo.all()

    overdue =
      base
      |> where([c], c.next_contact_at < ^today_start)
      |> order_by([c], asc: c.next_contact_at)
      |> limit(50)
      |> Repo.all()

    # Going-quiet detection: customers who have ordered but haven't
    # been spoken to in their cadence window. The lower bound is
    # ~90 days regardless of frequency setting to avoid false
    # positives for high-touch customers.
    quiet_cutoff = DateTime.add(today_start, -90, :day)

    going_quiet =
      base
      |> where(
        [c],
        c.total_orders_count > 0 and
          (is_nil(c.last_contact_at) or c.last_contact_at < ^quiet_cutoff)
      )
      |> where([c], is_nil(c.next_contact_at) or c.next_contact_at > ^today_end)
      |> order_by([c], asc: c.last_contact_at)
      |> limit(50)
      |> Repo.all()

    %{
      due_today: due_today,
      overdue: overdue,
      going_quiet: going_quiet
    }
  end
end
