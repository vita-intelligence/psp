defmodule BackendWeb.IntegrationTrialValidationController do
  @moduledoc """
  Reverse webhook — NPD calls INTO PSP whenever a ProductValidation's
  state machine advances (draft → in_progress → passed / failed).

  Payload:

      %{
        "npd_trial_batch_uuid" => "…",
        "validation" => %{
          "uuid" => "…",
          "status" => "draft" | "in_progress" | "passed" | "failed",
          "failure_reason" => "…"          # required when status=failed
        }
      }

  Behaviour:

    * Persists the state snapshot on the MO matching the trial-batch
      uuid (single-tenant, non-cancelled).
    * When ``status="failed"`` AND the MO's output lot is still at
      ``received`` (awaiting QC), fires the standard Output QC fail
      pipeline as the integration-token actor so the lot flips to
      ``rejected`` with a "NPD product validation failed: {reason}"
      note on the LotEvent.
    * Idempotent — a resend of the same status is a no-op with 200.

  Auth: same integration-token scope as MO create.

  Not to be confused with the outbound PSP → NPD sync used by proposal
  merges — this one is inbound and consumed here.
  """

  use BackendWeb, :controller

  import BackendWeb.IntegrationScopePlug

  alias Backend.Production
  alias BackendWeb.Payloads

  plug :require_integration_scope, "mo:write:npd" when action in [:sync]

  action_fallback BackendWeb.FallbackController

  @doc """
  POST /api/integration/trial-validations/sync
  """
  def sync(conn, params) do
    token = conn.assigns.current_integration_token

    with {:ok, actor} <- resolve_actor(token),
         :ok <- validate_payload(params),
         result <- Production.sync_npd_validation(actor, params) do
      handle_result(conn, result)
    else
      {:error, :missing_trial_batch_uuid} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "missing_npd_trial_batch_uuid"})

      {:error, :missing_validation} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "missing_validation_object"})

      {:error, :missing_validation_status} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "missing_validation_status"})

      {:error, :failure_reason_required} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "failure_reason_required_when_status_failed"})

      {:error, :no_actor} ->
        conn
        |> put_status(:internal_server_error)
        |> json(%{error: "integration_token_has_no_owner"})
    end
  end

  defp handle_result(conn, {:error, :mo_not_found}) do
    conn
    |> put_status(:not_found)
    |> json(%{error: "mo_not_found_for_trial_batch"})
  end

  defp handle_result(conn, {:error, :bad_payload}) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "bad_payload"})
  end

  defp handle_result(conn, {:error, %Ecto.Changeset{} = cs}) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{
      error: "validation_failed",
      fields: BackendWeb.Errors.changeset_fields(cs)
    })
  end

  defp handle_result(conn, {:ok, {:auto_failed, mo, lot}}) do
    json(conn, %{
      manufacturing_order: mo_snapshot(mo),
      auto_failed_lot_uuid: lot.uuid
    })
  end

  defp handle_result(conn, {:ok, mo}) do
    json(conn, %{manufacturing_order: mo_snapshot(mo)})
  end

  defp mo_snapshot(mo) do
    %{
      uuid: mo.uuid,
      code: Payloads.render_code(mo, "manufacturing_order"),
      npd_trial_batch_uuid: mo.npd_trial_batch_uuid,
      npd_validation_uuid: mo.npd_validation_uuid,
      npd_validation_status: mo.npd_validation_status,
      npd_validation_synced_at: mo.npd_validation_synced_at,
      npd_validation_failure_reason: mo.npd_validation_failure_reason
    }
  end

  # Payload sanity — catches shape bugs early so the context function
  # doesn't have to defend against every missing key.
  defp validate_payload(%{"npd_trial_batch_uuid" => uuid, "validation" => %{"status" => status} = v})
       when is_binary(uuid) and byte_size(uuid) > 0 and is_binary(status) do
    if status == "failed" and (is_nil(v["failure_reason"]) or v["failure_reason"] == "") do
      {:error, :failure_reason_required}
    else
      :ok
    end
  end

  defp validate_payload(%{"npd_trial_batch_uuid" => _, "validation" => %{}}),
    do: {:error, :missing_validation_status}

  defp validate_payload(%{"npd_trial_batch_uuid" => _}),
    do: {:error, :missing_validation}

  defp validate_payload(_), do: {:error, :missing_trial_batch_uuid}

  defp resolve_actor(%{created_by_id: uid}) when is_integer(uid) do
    case Backend.Accounts.get_user(uid) do
      nil -> {:error, :no_actor}
      user -> {:ok, user}
    end
  end

  defp resolve_actor(_), do: {:error, :no_actor}
end
