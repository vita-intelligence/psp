defmodule Backend.Production.WorkstationEquipmentPublisher do
  @moduledoc """
  PSP → vita-performance publisher for a workstation's equipment
  roster. Full-replace semantics — every publish sends the entire
  current active equipment set for the given workstation, so the
  vp side can deactivate anything missing.

  Triggered by:

    * Equipment attach / detach / rename / update on any equipment
      row that either currently belongs to a workstation OR just
      left one (both sides need a fresh sync).
    * Workstation update on the parent workstation.
    * Reconciler sweep — periodically re-publishes so a transient
      vita-perf outage self-heals within N minutes without waiting
      for the next equipment write.

  Silent-degrade: transport errors log + return `:error` without
  bubbling up to the caller. Equipment CRUD on PSP must never fail
  because vp is briefly offline.

  Same env vars as ``Backend.Forms.Publisher`` — one credential
  covers the whole PSP → vp outbound surface.
  """

  require Logger

  alias Backend.Equipment.Equipment
  alias Backend.Production.Workstation
  alias Backend.Repo

  import Ecto.Query, warn: false

  @doc """
  Publish the current active equipment roster for one workstation.
  Fire-and-forget from the caller's perspective — errors log but
  don't raise.

  Returns:

    * `:ok` — vp accepted the payload
    * `:noop` — workstation has no external_id (not yet mirrored)
    * `:not_configured` — the two env vars aren't set
    * `{:error, reason}` — transport / 4xx / 5xx (already logged)
  """
  @spec publish_workstation(Workstation.t() | integer() | nil) ::
          :ok | :noop | :not_configured | {:error, term()}
  def publish_workstation(nil), do: :noop

  def publish_workstation(id) when is_integer(id) do
    case Repo.get(Workstation, id) do
      nil -> :noop
      ws -> publish_workstation(ws)
    end
  end

  def publish_workstation(%Workstation{external_id: nil}), do: :noop

  def publish_workstation(%Workstation{} = ws) do
    with {:ok, url} <- fetch_url(),
         {:ok, token} <- fetch_token() do
      equipment =
        Repo.all(
          from e in Equipment,
            where:
              e.workstation_id == ^ws.id and
                e.status not in ["retired", "disposed", "canceled"],
            preload: [:item, :category]
        )

      payload = %{
        "workstation_external_id" => ws.uuid,
        "equipment" =>
          Enum.map(equipment, fn e ->
            %{
              "uuid" => e.uuid,
              "name" => equipment_display_name(e),
              "serial_number" => e.serial_number || "",
              "category_name" => (e.category && e.category.name) || "",
              "psp_updated_at" => encode_datetime(e.updated_at)
            }
          end)
      }

      request_url =
        String.trim_trailing(url, "/") <> "/api/kiosk/psp/workstation-equipment/"

      req =
        Req.new(
          url: request_url,
          json: payload,
          headers: [{"x-psp-publish-token", token}],
          receive_timeout: 10_000
        )

      case Req.post(req) do
        {:ok, %Req.Response{status: status}} when status in 200..299 ->
          Logger.debug(
            "WorkstationEquipmentPublisher: synced #{length(equipment)} " <>
              "unit(s) for workstation #{ws.uuid} (#{status})"
          )

          :ok

        {:ok, %Req.Response{status: status, body: body}} ->
          Logger.warning(
            "WorkstationEquipmentPublisher: vp returned #{status} for " <>
              "workstation #{ws.uuid} — #{inspect(body)}"
          )

          {:error, {:http, status, body}}

        {:error, err} ->
          Logger.warning(
            "WorkstationEquipmentPublisher: transport error for " <>
              "workstation #{ws.uuid} — #{inspect(err)}"
          )

          {:error, err}
      end
    end
  end

  @doc """
  Convenience for callers holding an equipment struct — publishes
  the workstation it belongs to (if any), and if the equipment
  changed workstation, publishes the previous one too so both
  sides converge.
  """
  @spec publish_for_equipment(Equipment.t(), integer() | nil) ::
          :ok | :noop | :not_configured | {:error, term()}
  def publish_for_equipment(%Equipment{workstation_id: nil}, nil), do: :noop

  def publish_for_equipment(%Equipment{workstation_id: current}, previous)
      when is_integer(current) or is_integer(previous) do
    if is_integer(current), do: publish_workstation(current), else: :noop

    if is_integer(previous) and previous != current,
      do: publish_workstation(previous),
      else: :noop

    :ok
  end

  def publish_for_equipment(_, _), do: :noop

  # Display name: prefer item name + serial, fall back to
  # manufacturer / model. Keeps the kiosk picker readable for
  # operators who think in "V-blender · Bosch VMB-100 · SN-1234".
  defp equipment_display_name(%Equipment{item: item} = e) do
    base =
      cond do
        item && item.name && item.name != "" -> item.name
        e.model && e.model != "" -> "#{e.manufacturer} #{e.model}" |> String.trim()
        e.manufacturer && e.manufacturer != "" -> e.manufacturer
        true -> "Equipment"
      end

    if e.serial_number && e.serial_number != "" do
      "#{base} · #{e.serial_number}"
    else
      base
    end
  end

  defp encode_datetime(nil), do: nil
  defp encode_datetime(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp encode_datetime(%NaiveDateTime{} = ndt), do: NaiveDateTime.to_iso8601(ndt)

  defp fetch_url do
    case System.get_env("PSP_TO_VITAPERF_URL") do
      url when is_binary(url) and url != "" ->
        {:ok, url}

      _ ->
        Logger.warning(
          "WorkstationEquipmentPublisher: PSP_TO_VITAPERF_URL unset; " <>
            "skipping equipment sync"
        )

        :not_configured
    end
  end

  defp fetch_token do
    case System.get_env("PSP_TO_VITAPERF_TOKEN") do
      t when is_binary(t) and t != "" ->
        {:ok, t}

      _ ->
        Logger.warning(
          "WorkstationEquipmentPublisher: PSP_TO_VITAPERF_TOKEN unset; " <>
            "skipping equipment sync"
        )

        :not_configured
    end
  end
end
