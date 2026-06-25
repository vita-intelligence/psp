defmodule BackendWeb.LoyaltyController do
  @moduledoc """
  Loyalty surface — programs CRUD, customer credits ledger, and the
  dashboard endpoint that powers /sales/loyalty.

  RBAC:
    * `loyalty.view`            — dashboard, list/show programs, list credits
    * `loyalty.programs_manage` — create/update/delete programs + tiers + lifecycle
    * `loyalty.credits_grant`   — grant manual credit + apply credit to invoice
  """

  use BackendWeb, :controller

  import Ecto.Query, only: [from: 2]

  alias Backend.{Companies, CustomerInvoices, Customers, Loyalty}
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "loyalty.view"
       when action in [
              :dashboard,
              :list_programs,
              :show_program,
              :list_credits,
              :customer_credits,
              :customer_balance
            ]

  plug RequirePermission, "loyalty.programs_manage"
       when action in [
              :create_program,
              :update_program,
              :delete_program,
              :set_active,
              :set_default,
              :add_tier,
              :update_tier,
              :delete_tier
            ]

  plug RequirePermission, "loyalty.credits_grant"
       when action in [:grant_credit, :apply_credit]

  action_fallback BackendWeb.FallbackController

  # ----- dashboard ------------------------------------------------

  def dashboard(conn, _params) do
    actor = conn.assigns.current_user
    company = Companies.get!(actor.company_id)

    programs = Loyalty.list_programs(actor.company_id)
    per_customer = Loyalty.per_customer_summary(actor.company_id)
    recent = Loyalty.recent_ledger(actor.company_id, limit: 25)

    json(conn, %{
      base_currency: company.currency_code,
      programs: Enum.map(programs, &Payloads.loyalty_program/1),
      per_customer:
        per_customer
        |> hydrate_customers(actor.company_id)
        |> Enum.map(&Payloads.loyalty_per_customer/1),
      recent_ledger: Enum.map(recent, &Payloads.customer_credit/1)
    })
  end

  defp hydrate_customers(rows, company_id) do
    customer_ids = rows |> Enum.map(& &1.customer_id) |> Enum.uniq()

    lookup =
      from(c in Backend.Customers.Customer,
        where: c.company_id == ^company_id and c.id in ^customer_ids,
        select: {c.id, %{id: c.id, uuid: c.uuid, name: c.name}}
      )
      |> Backend.Repo.all()
      |> Enum.into(%{})

    Enum.map(rows, fn r -> Map.put(r, :customer, Map.get(lookup, r.customer_id)) end)
  end

  # ----- programs -------------------------------------------------

  def list_programs(conn, _params) do
    actor = conn.assigns.current_user
    programs = Loyalty.list_programs(actor.company_id)
    json(conn, %{items: Enum.map(programs, &Payloads.loyalty_program/1)})
  end

  def show_program(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    case Loyalty.get_program(actor.company_id, uuid) do
      nil -> {:error, :not_found}
      program -> json(conn, %{loyalty_program: Payloads.loyalty_program(program)})
    end
  end

  def create_program(conn, params) do
    actor = conn.assigns.current_user

    case Loyalty.create_program(actor, actor.company_id, Map.drop(params, ["id"])) do
      {:ok, program} ->
        conn
        |> put_status(:created)
        |> json(%{loyalty_program: Payloads.loyalty_program(program)})

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)
    end
  end

  def update_program(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = program <- Loyalty.get_program(actor.company_id, uuid) do
      case Loyalty.update_program(actor, program, Map.drop(params, ["id"])) do
        {:ok, updated} -> json(conn, %{loyalty_program: Payloads.loyalty_program(updated)})
        {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def delete_program(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = program <- Loyalty.get_program(actor.company_id, uuid),
         {:ok, _} <- Loyalty.delete_program(actor, program) do
      send_resp(conn, :no_content, "")
    else
      {:error, {:in_use, count}} ->
        conflict(
          conn,
          "in_use",
          "#{count} customer(s) are assigned to this program. Reassign them first."
        )

      _ ->
        {:error, :not_found}
    end
  end

  def set_active(conn, %{"id" => uuid} = params) do
    actor = conn.assigns.current_user
    is_active = params["is_active"]
    reason = params["reason"]

    with %{} = program <- Loyalty.get_program(actor.company_id, uuid),
         {:ok, updated} <- Loyalty.set_active(actor, program, is_active == true, reason) do
      json(conn, %{loyalty_program: Payloads.loyalty_program(updated)})
    else
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      _ -> {:error, :not_found}
    end
  end

  def set_default(conn, %{"id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = program <- Loyalty.get_program(actor.company_id, uuid),
         {:ok, updated} <- Loyalty.set_default(actor, program) do
      json(conn, %{loyalty_program: Payloads.loyalty_program(updated)})
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- tiers ----------------------------------------------------

  def add_tier(conn, %{"loyalty_program_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = program <- Loyalty.get_program(actor.company_id, uuid),
         {:ok, tier} <-
           Loyalty.add_tier(actor, program, Map.drop(params, ["loyalty_program_id"])) do
      conn
      |> put_status(:created)
      |> json(%{tier: Payloads.loyalty_tier(tier)})
    else
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      _ -> {:error, :not_found}
    end
  end

  def update_tier(conn, %{"loyalty_program_id" => p_uuid, "id" => t_uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = program <- Loyalty.get_program(actor.company_id, p_uuid),
         %{} = tier <- Loyalty.get_tier(program.id, t_uuid),
         {:ok, updated} <-
           Loyalty.update_tier(actor, tier, Map.drop(params, ["loyalty_program_id", "id"])) do
      json(conn, %{tier: Payloads.loyalty_tier(updated)})
    else
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      _ -> {:error, :not_found}
    end
  end

  def delete_tier(conn, %{"loyalty_program_id" => p_uuid, "id" => t_uuid}) do
    actor = conn.assigns.current_user

    with %{} = program <- Loyalty.get_program(actor.company_id, p_uuid),
         %{} = tier <- Loyalty.get_tier(program.id, t_uuid),
         {:ok, _} <- Loyalty.delete_tier(actor, tier) do
      send_resp(conn, :no_content, "")
    else
      _ -> {:error, :not_found}
    end
  end

  # ----- credits --------------------------------------------------

  def list_credits(conn, params) do
    actor = conn.assigns.current_user
    limit = parse_limit(params["limit"])
    items = Loyalty.recent_ledger(actor.company_id, limit: limit)
    json(conn, %{items: Enum.map(items, &Payloads.customer_credit/1)})
  end

  def customer_credits(conn, %{"customer_id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid) do
      ledger = Loyalty.ledger_for_customer(customer.id)
      balance = Loyalty.balance_for(customer.id, customer.currency_code)

      json(conn, %{
        balance: Decimal.to_string(balance, :normal),
        currency_code: customer.currency_code,
        items: Enum.map(ledger, &Payloads.customer_credit/1)
      })
    else
      _ -> {:error, :not_found}
    end
  end

  def customer_balance(conn, %{"customer_id" => uuid}) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid) do
      balance = Loyalty.balance_for(customer.id, customer.currency_code)

      json(conn, %{
        balance: Decimal.to_string(balance, :normal),
        currency_code: customer.currency_code
      })
    else
      _ -> {:error, :not_found}
    end
  end

  def grant_credit(conn, %{"customer_id" => uuid} = params) do
    actor = conn.assigns.current_user

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid) do
      case Loyalty.grant_credit(actor, customer, Map.drop(params, ["customer_id"])) do
        {:ok, credit} ->
          conn
          |> put_status(:created)
          |> json(%{credit: Payloads.customer_credit(credit)})

        {:error, %Ecto.Changeset{} = cs} ->
          changeset_error(conn, cs)
      end
    else
      _ -> {:error, :not_found}
    end
  end

  def apply_credit(conn, %{"customer_id" => uuid} = params) do
    actor = conn.assigns.current_user
    invoice_uuid = params["invoice_uuid"]
    amount = params["amount"]

    with %{} = customer <- Customers.get_for_company(actor.company_id, uuid),
         %{} = invoice when not is_nil(invoice_uuid) <-
           CustomerInvoices.get_for_company(actor.company_id, invoice_uuid),
         {:ok, %{credit: credit, credit_note: credit_note}} <-
           Loyalty.apply_to_invoice(actor, customer, invoice, amount) do
      conn
      |> put_status(:created)
      |> json(%{
        credit: Payloads.customer_credit(credit),
        credit_note: Payloads.customer_invoice(credit_note)
      })
    else
      {:error, :nonpositive_amount} ->
        unprocessable(conn, "invalid_amount", "Amount must be positive.")

      {:error, :insufficient_balance} ->
        conflict(
          conn,
          "insufficient_balance",
          "The customer's balance is lower than the redemption amount."
        )

      {:error, %Ecto.Changeset{} = cs} ->
        changeset_error(conn, cs)

      _ ->
        {:error, :not_found}
    end
  end

  # ----- helpers --------------------------------------------------

  defp parse_limit(nil), do: 50

  defp parse_limit(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, _} when n > 0 and n <= 500 -> n
      _ -> 50
    end
  end

  defp parse_limit(_), do: 50

  defp conflict(conn, code, detail) do
    conn |> put_status(:conflict) |> json(%{error: code, detail: detail})
  end

  defp unprocessable(conn, code, detail) do
    conn |> put_status(:unprocessable_entity) |> json(%{error: code, detail: detail})
  end

  defp changeset_error(conn, %Ecto.Changeset{} = cs) do
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
