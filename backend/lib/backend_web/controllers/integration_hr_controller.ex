defmodule BackendWeb.IntegrationHRController do
  @moduledoc """
  Kiosk / integration-side writeback for HR master data. Handles the
  full seed from vita-performance:

    * `create_employee/2`   — identity + PIN hash + is_qa + hire_date.
      Idempotent via `external_id`; a repeated push for the same vp
      Worker returns the existing PSP Employee.
    * `create_wage/2`       — the current wage row. Idempotent via
      the request's `external_id` matched against the wage's `reason`
      slot (we key it in via `EmployeeWage.reason` — see the code).
      Uses `HR.add_wage/3` which atomically closes the previous open
      interval so re-seeding is safe.
    * `create_reputation_event/2` — one row per vp reputation event.
      Idempotent via `session_external_id` (that's the schema slot
      designed for cross-system correlation) matched against the
      incoming `external_id`.

  Scopes: `hr:write` for identity + wage; `hr:write:reputation` for
  the reputation row. Both are registered on the token schema.

  PIN caveat: vp's `pin` field is `pbkdf2_sha256$...`. PSP's kiosk
  auth uses Bcrypt. Values seeded here won't verify with the current
  `verify_pin/2` — see the note in `Backend.HR.Employee`.
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.HR
  alias Backend.HR.{Employee, EmployeeReputationEvent, EmployeeWage}
  alias Backend.Repo
  alias BackendWeb.Errors
  alias BackendWeb.Payloads

  plug :require_integration_scope, "hr:write" when action in [:create_employee, :create_wage]

  plug :require_integration_scope,
       "hr:write:reputation" when action == :create_reputation_event

  action_fallback BackendWeb.FallbackController

  ## Employees ------------------------------------------------------

  def create_employee(conn, params) do
    company_id = conn.assigns.current_company_id
    external_id = params["external_id"]

    # Look up by external_id first so a retry from vp's outbox
    # returns the existing row rather than duplicating identity.
    existing =
      case external_id do
        id when is_binary(id) and id != "" ->
          Repo.one(
            from e in Employee,
              where: e.company_id == ^company_id and e.external_id == ^id
          )

        _ ->
          nil
      end

    case existing do
      %Employee{} = row ->
        # Enrich the matched row with any newly-transferred fields
        # (kiosk_pin_hash, hire_date, is_qa). This is the migration
        # path for tenants seeded before the enrichment shipped —
        # thin employee rows get their PIN + identity fields backfilled
        # on re-seed. We only overwrite fields the caller actually sent
        # so a partial payload can't blank out something the operator
        # subsequently set on the PSP side.
        row = maybe_enrich_matched(row, params, company_id)

        conn
        |> put_status(:ok)
        |> json(%{employee: employee_payload(row), matched: true})

      nil ->
        actor = integration_actor(company_id)

        attrs =
          params
          |> Map.take(~w(
            full_name preferred_name email phone employee_number
            hire_date external_id is_active is_qa kiosk_pin_hash
          ))
          |> Map.put_new("is_active", true)
          |> normalize_hire_date()

        case HR.create_employee_from_integration(actor, attrs) do
          {:ok, employee} ->
            conn
            |> put_status(:created)
            |> json(%{employee: employee_payload(employee), matched: false})

          {:error, %Ecto.Changeset{} = cs} ->
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
  end

  ## Wages ----------------------------------------------------------

  def create_wage(conn, %{"employee_uuid" => employee_uuid} = params) do
    company_id = conn.assigns.current_company_id
    external_id = params["external_id"]

    case HR.get_employee(company_id, employee_uuid) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(Errors.payload("employee_not_found", "Employee not found for the given uuid.", %{}))

      %Employee{} = employee ->
        # Idempotency: we key the incoming vp payload's external_id
        # into `EmployeeWage.reason` (prefixed) since the schema
        # already has that slot and we don't want a migration in this
        # PR. Reason format: `[ext=<external_id>] <human reason>`.
        existing =
          case external_id do
            id when is_binary(id) and id != "" ->
              find_existing_wage(employee.id, id)

            _ ->
              nil
          end

        case existing do
          %EmployeeWage{} = wage ->
            conn
            |> put_status(:ok)
            |> json(%{wage: Payloads.hr_employee_wage(wage), matched: true})

          nil ->
            actor = integration_actor(company_id)

            attrs = build_wage_attrs(params)

            case HR.add_wage(actor, employee, attrs) do
              {:ok, wage} ->
                conn
                |> put_status(:created)
                |> json(%{wage: Payloads.hr_employee_wage(wage), matched: false})

              {:error, %Ecto.Changeset{} = cs} ->
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
    end
  end

  defp build_wage_attrs(params) do
    external_id = params["external_id"]
    human_reason = params["reason"] || ""

    reason =
      case external_id do
        id when is_binary(id) and id != "" ->
          "[ext=#{id}] #{human_reason}" |> String.trim()

        _ ->
          human_reason
      end

    %{
      "effective_from" => params["effective_from"],
      "hourly_rate" => params["hourly_rate"],
      "currency_code" => params["currency_code"] || "GBP",
      "source_kind" => "integration",
      "reason" => reason
    }
  end

  defp find_existing_wage(employee_id, external_id) do
    like = "[ext=#{external_id}]%"

    Repo.one(
      from w in EmployeeWage,
        where: w.employee_id == ^employee_id and like(w.reason, ^like),
        preload: [:approved_by],
        limit: 1
    )
  end

  ## Reputation -----------------------------------------------------

  def create_reputation_event(conn, %{"employee_uuid" => employee_uuid} = params) do
    company_id = conn.assigns.current_company_id
    external_id = params["external_id"]

    case HR.get_employee(company_id, employee_uuid) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(Errors.payload("employee_not_found", "Employee not found for the given uuid.", %{}))

      %Employee{} = employee ->
        existing =
          case external_id do
            id when is_binary(id) and id != "" ->
              Repo.one(
                from ev in EmployeeReputationEvent,
                  where:
                    ev.employee_id == ^employee.id and
                      ev.session_external_id == ^id,
                  preload: [:created_by_user, :created_by_employee],
                  limit: 1
              )

            _ ->
              nil
          end

        case existing do
          %EmployeeReputationEvent{} = ev ->
            conn
            |> put_status(:ok)
            |> json(%{event: Payloads.hr_employee_reputation_event(ev), matched: true})

          nil ->
            actor = integration_actor(company_id)

            attrs = %{
              "session_external_id" => external_id,
              "event_type" => params["event_type"],
              "score_delta" => params["score_delta"],
              "reason" => params["reason"] || ""
            }

            case HR.record_reputation_event(actor, employee, attrs) do
              {:ok, event} ->
                event = maybe_backdate(event, params["occurred_at"])

                conn
                |> put_status(:created)
                |> json(%{
                  event: Payloads.hr_employee_reputation_event(event),
                  matched: false
                })

              {:error, %Ecto.Changeset{} = cs} ->
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
    end
  end

  # `inserted_at` is `auto_generated: false` on `timestamps/1` for
  # `EmployeeReputationEvent`, so Ecto stamps it at insert time. To
  # preserve the original vp `created_at` (so the reputation decay
  # math projects the same score both sides), we back-date via a
  # direct update after insert. Same trick works for `wages` if we
  # ever need the original vp raise date — today we drive that off
  # `effective_from`, which is the ISO date vp sends, so no need.
  defp maybe_backdate(%EmployeeReputationEvent{} = ev, occurred_at)
       when is_binary(occurred_at) do
    case DateTime.from_iso8601(occurred_at) do
      {:ok, dt, _} ->
        dt = DateTime.truncate(dt, :second)

        {1, _} =
          Repo.update_all(
            from(e in EmployeeReputationEvent, where: e.id == ^ev.id),
            set: [inserted_at: dt]
          )

        %{ev | inserted_at: dt}

      _ ->
        ev
    end
  end

  defp maybe_backdate(ev, _), do: ev

  ## Helpers --------------------------------------------------------

  # On matched (existing) rows, quietly backfill any of the enriched
  # fields the row is missing. Never overwrites a non-nil value — the
  # PSP-side operator wins over a re-seed. `kiosk_pin_hash` is written
  # through direct Repo.update on the changeset (bypassing the
  # `create_changeset`'s virtual `kiosk_pin` hashing path).
  defp maybe_enrich_matched(%Employee{} = row, params, _company_id) do
    updates = %{}

    updates =
      case {row.kiosk_pin_hash, params["kiosk_pin_hash"]} do
        {nil, hash} when is_binary(hash) and hash != "" ->
          Map.put(updates, :kiosk_pin_hash, hash)

        _ ->
          updates
      end

    updates =
      case {row.hire_date, params["hire_date"]} do
        {nil, iso} when is_binary(iso) and iso != "" ->
          case Date.from_iso8601(iso) do
            {:ok, d} -> Map.put(updates, :hire_date, d)
            _ -> updates
          end

        _ ->
          updates
      end

    updates =
      case {row.is_qa, params["is_qa"]} do
        {false, true} -> Map.put(updates, :is_qa, true)
        _ -> updates
      end

    if map_size(updates) == 0 do
      row
    else
      {:ok, updated} =
        row
        |> Ecto.Changeset.change(updates)
        |> Repo.update()

      updated
    end
  end

  defp integration_actor(company_id) do
    %Backend.Accounts.User{
      id: nil,
      company_id: company_id,
      is_admin: true
    }
  end

  # Employee changeset expects `hire_date` as a Date. vp sends an
  # ISO string; parse defensively so a bad value shows up as a
  # validation error rather than a 500.
  defp normalize_hire_date(%{"hire_date" => v} = attrs)
       when is_binary(v) and v != "" do
    case Date.from_iso8601(v) do
      {:ok, d} -> Map.put(attrs, "hire_date", d)
      _ -> attrs
    end
  end

  defp normalize_hire_date(attrs), do: attrs

  defp employee_payload(%Employee{} = e) do
    %{
      uuid: e.uuid,
      external_id: e.external_id,
      employee_number: e.employee_number,
      full_name: e.full_name,
      preferred_name: e.preferred_name,
      email: e.email,
      phone: e.phone,
      is_active: e.is_active,
      is_qa: e.is_qa,
      reputation_score: e.reputation_score,
      hire_date: e.hire_date,
      has_kiosk_pin: not is_nil(e.kiosk_pin_hash),
      inserted_at: e.inserted_at
    }
  end
end
