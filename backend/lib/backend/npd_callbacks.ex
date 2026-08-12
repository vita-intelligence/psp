defmodule Backend.NpdCallbacks do
  @moduledoc """
  Outbound calls from PSP → NPD for state that PSP originates but NPD
  needs to see.

  Sibling to the read-side NPD calls in ``ManufacturingOrderController``
  (spec HTML, validation HTML). Every call in here follows the same
  auth + transport pattern — bearer token from ``company.npd_integration_token``,
  base URL from ``company.npd_base_url``, silent-degrade on any failure
  so a downed NPD never blocks a PSP operation.

  ### Why silent-degrade

  These callbacks are convenience syncs, not authoritative writes.
  The PSP-side action (e.g. MO creation) has already committed by
  the time we call NPD. If the callback fails, the PSP state is
  still correct — only NPD's mirror lags. A follow-up sync (or a
  backfill script) can catch up later. Failing loud here would let
  a network blip roll back a legitimate PSP operation, which is
  worse than a stale NPD view.
  """

  require Logger

  alias Backend.Companies.Company

  @doc """
  Ping NPD to pin a newly-created MO's uuid onto the corresponding
  sample TrialBatch. Called from ``create_mo_for_line`` after the MO
  insert succeeds, whenever the source CO carries an
  ``npd_payment_id`` (= born from an NPD sample payment).

  Without this hook, MOs created via the PSP wizard button never
  reach NPD's ``TrialBatch.psp_manufacturing_order_uuid`` field —
  NPD's trial-batch page then shows the "No stage chain yet — the
  MO was created but hasn't booked a BOM" placeholder even though
  PSP has the MO in flight. NPD's own "Create MO on PSP" button
  never had this problem because it was the caller and stored the
  returned uuid itself.

  Silent-degrade returns ``:ok`` on ANY failure (missing config,
  network, non-2xx, malformed response) — inspect application logs
  if a specific sample stays unpinned. Success returns ``{:ok,
  response_body_map}``.
  """
  @spec pin_mo_on_trial_batch(Company.t(), String.t(), String.t()) ::
          {:ok, map()} | :ok
  def pin_mo_on_trial_batch(%Company{} = company, npd_payment_uuid, mo_uuid)
      when is_binary(npd_payment_uuid) and is_binary(mo_uuid) do
    with {:ok, base_url} <- fetch_base_url(company),
         {:ok, token} <- fetch_token(company) do
      url = String.trim_trailing(base_url, "/") <> "/api/psp-integration/trial-batches/pin-mo/"

      body = %{
        "npd_sample_payment_uuid" => npd_payment_uuid,
        "psp_manufacturing_order_uuid" => mo_uuid
      }

      req =
        Req.new(
          url: url,
          json: body,
          headers: [{"authorization", "Bearer " <> token}],
          receive_timeout: 10_000
        )

      case Req.post(req) do
        {:ok, %Req.Response{status: status, body: resp_body}}
        when status in 200..299 ->
          {:ok, normalise_body(resp_body)}

        {:ok, %Req.Response{status: 404}} ->
          # NPD hasn't spawned a TrialBatch for this payment yet
          # (rare — the sample fulfilment queue usually spawns it
          # when the payment lands). Nothing to pin; NPD's page
          # will surface the MO once the TrialBatch is created.
          Logger.info(
            "NpdCallbacks.pin_mo_on_trial_batch: NPD returned 404 " <>
              "(no TrialBatch for payment #{npd_payment_uuid}); skipping pin"
          )

          :ok

        {:ok, %Req.Response{status: status}} ->
          Logger.warning(
            "NpdCallbacks.pin_mo_on_trial_batch: NPD returned #{status} " <>
              "for payment #{npd_payment_uuid}; MO uuid #{mo_uuid} unpinned"
          )

          :ok

        {:error, reason} ->
          Logger.warning(
            "NpdCallbacks.pin_mo_on_trial_batch: transport failure " <>
              "(#{inspect(reason)}); payment #{npd_payment_uuid} MO #{mo_uuid} unpinned"
          )

          :ok
      end
    end
  end

  def pin_mo_on_trial_batch(_, _, _), do: :ok

  # ── helpers ─────────────────────────────────────────────────────

  defp fetch_base_url(%Company{npd_base_url: url}) when is_binary(url) and url != "",
    do: {:ok, url}

  defp fetch_base_url(_), do: :ok

  defp fetch_token(%Company{npd_integration_token: token}) when is_binary(token) and token != "",
    do: {:ok, token}

  defp fetch_token(_), do: :ok

  # Req returns ``body`` as either a parsed map (when the server sent
  # JSON) or a raw binary. Normalise to a map with string keys so
  # callers don't have to defend against both shapes.
  defp normalise_body(%{} = m), do: m
  defp normalise_body(binary) when is_binary(binary) do
    case Jason.decode(binary) do
      {:ok, %{} = m} -> m
      _ -> %{}
    end
  end

  defp normalise_body(_), do: %{}
end
