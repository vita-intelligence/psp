defmodule Backend.Equipment do
  @moduledoc """
  Boundary for the equipment registry — individual physical units
  with serial numbers, cadence-driven maintenance + calibration
  schedules, and a lifecycle event log.

  This module is the read + registry surface + the lifecycle event
  entry point + file attachments. Lifecycle transitions run through
  `Backend.Equipment.Lifecycle` (state machine + projection).

  ## Compliance posture

    * BRCGS Issue 9 § 4.13 — equipment used for verifying product
      safety-critical parameters (scales, thermometers, moisture
      analysers, pH meters) requires documented calibration on a
      cadence with signed evidence. `calibration_frequency_months`
      + `last/next_calibrated_at` + evidence uploads carry this.
    * BRCGS Issue 9 § 4.11.6 — planned preventive maintenance for
      food-contact equipment. Same fields as calibration but under
      `maintenance_*` prefix.
    * BRCGS Issue 9 § 3.5.2 — traceability of equipment origin
      (via `purchase_order_line_id`) + retention of the audit
      trail (via `equipment_events`).
  """

  import Ecto.Query, warn: false

  alias Backend.Equipment.Equipment
  alias Backend.Repo

  @doc """
  Fetch a unit by uuid, scoped to the current company. Returns
  `nil` when the uuid doesn't parse or the unit is on a different
  tenant.
  """
  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Equipment
        |> where([e], e.company_id == ^company_id and e.uuid == ^cast)
        |> preload([
          :item,
          :current_cell,
          :assigned_to,
          :purchase_order_line,
          :created_by,
          :updated_by
        ])
        |> Repo.one()

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  @doc """
  All units for the tenant. No paging yet — the ledger + list
  endpoints in a follow-up PR add cursor pagination.
  """
  def list_for_company(company_id) when is_integer(company_id) do
    Equipment
    |> where([e], e.company_id == ^company_id)
    |> order_by([e], asc: e.id)
    |> preload([:item, :current_cell, :assigned_to])
    |> Repo.all()
  end

  @doc """
  Units with a calibration OR maintenance due date crossing the
  `horizon_days` window from today. Returned newest-due first so the
  banner / my-tasks card can lead with the most urgent unit.

  Terminal statuses (retired, disposed, canceled) are excluded — they
  don't need service anymore. Also skips units whose cadence isn't
  configured (next_*_at IS NULL) — nothing to schedule.

  ## Structure of each row

  Each map carries:

      %{
        equipment: %Backend.Equipment.Equipment{},
        due_kind: "calibration" | "maintenance",
        due_at: DateTime.t(),
        days_until: integer  # negative when overdue
      }
  """
  def due_soon(company_id, horizon_days \\ 14) when is_integer(company_id) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    cutoff = DateTime.add(now, horizon_days * 24 * 60 * 60, :second)

    units =
      Equipment
      |> where([e], e.company_id == ^company_id)
      |> where([e], e.status not in ^["retired", "disposed", "canceled"])
      |> where(
        [e],
        (not is_nil(e.next_calibration_at) and e.next_calibration_at <= ^cutoff) or
          (not is_nil(e.next_maintenance_at) and e.next_maintenance_at <= ^cutoff)
      )
      |> preload([:item, :current_cell, :assigned_to])
      |> Repo.all()

    units
    |> Enum.flat_map(fn e ->
      cal =
        if e.next_calibration_at && DateTime.compare(e.next_calibration_at, cutoff) != :gt do
          [
            %{
              equipment: e,
              due_kind: "calibration",
              due_at: e.next_calibration_at,
              days_until: days_until(e.next_calibration_at, now)
            }
          ]
        else
          []
        end

      maint =
        if e.next_maintenance_at && DateTime.compare(e.next_maintenance_at, cutoff) != :gt do
          [
            %{
              equipment: e,
              due_kind: "maintenance",
              due_at: e.next_maintenance_at,
              days_until: days_until(e.next_maintenance_at, now)
            }
          ]
        else
          []
        end

      cal ++ maint
    end)
    |> Enum.sort_by(& &1.due_at, DateTime)
  end

  defp days_until(due_at, now) do
    diff = DateTime.diff(due_at, now, :second)
    div(diff, 24 * 60 * 60)
  end

  @doc """
  Create a new equipment unit from a manual entry OR the goods-in
  receive branch (PR E2 wires that path). Starts at status
  `received` with an initial `received` lifecycle event so the
  audit trail is populated from row one.

  `attrs` must include: `item_id`, `serial_number`. Everything
  else is optional (unit_cost, currency, acquired_at, cell,
  cadences, etc). The initial event captures the actor + optional
  reason.
  """
  def create(%Backend.Accounts.User{} = actor, company_id, attrs)
      when is_integer(company_id) and is_map(attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        # Insert at the pre-arrival status so the birth event's
        # transition (`expected → received`) matches the lifecycle
        # matrix. The event write + status projection run in the
        # same transaction as the row insert, so callers observe
        # the final `received` status atomically.
        "status" => "expected",
        "acquired_at" =>
          Map.get(attrs, "acquired_at") ||
            Map.get(attrs, :acquired_at) ||
            (DateTime.utc_now() |> DateTime.truncate(:second)),
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    with :ok <- ensure_item_is_equipment(company_id, attrs["item_id"]) do
      Repo.transaction(fn ->
        with {:ok, equipment} <-
               %Equipment{}
               |> Equipment.changeset(attrs)
               |> Repo.insert(),
             {:ok, %{equipment: promoted}} <-
               Backend.Equipment.Lifecycle.record_event_in_transaction(
                 equipment,
                 "received",
                 %{
                   actor: actor,
                   actor_kind: "user",
                   reason: attrs["reason"] || "Equipment received",
                   metadata: %{
                     "source" => attrs["source"] || "manual",
                     "purchase_order_line_id" => attrs["purchase_order_line_id"]
                   }
                 }
               ) do
          Backend.Broadcasts.entity_changed(
            "equipment",
            promoted.uuid,
            promoted.company_id,
            "created"
          )

          Repo.preload(promoted, [
            :item,
            :current_cell,
            :assigned_to,
            :purchase_order_line,
            :created_by
          ])
        else
          {:error, %Ecto.Changeset{} = cs} ->
            Repo.rollback(cs)

          # Lifecycle rejections are 3-tuples — normalise so the
          # controller can pattern-match on the leading `:error`.
          {:error, :illegal_transition, info} ->
            Repo.rollback({:illegal_transition, info})

          {:error, reason} ->
            Repo.rollback(reason)
        end
      end)
    end
  end

  @doc """
  Public lifecycle-event entry point. Thin wrapper around
  `Backend.Equipment.Lifecycle.record_event/3` that fires a
  realtime broadcast on success so open detail pages refresh.
  """
  def record_event(%Backend.Accounts.User{} = actor, %Equipment{} = equipment, kind, opts)
      when is_binary(kind) and is_map(opts) do
    attrs = Map.put(opts, :actor, actor)

    case Backend.Equipment.Lifecycle.record_event(equipment, kind, attrs) do
      {:ok, %{equipment: updated}} ->
        Backend.Broadcasts.entity_changed(
          "equipment",
          updated.uuid,
          updated.company_id,
          kind
        )

        {:ok,
         Repo.preload(updated, [
           :item,
           :current_cell,
           :assigned_to,
           :purchase_order_line
         ])}

      {:error, :illegal_transition, info} ->
        {:error, :illegal_transition, info}

      {:error, other} ->
        {:error, other}
    end
  end

  # Enforce that the linked item is actually flagged as equipment.
  # Prevents the create endpoint from silently spawning an
  # equipment row for a raw_material item.
  defp ensure_item_is_equipment(company_id, item_id)
       when is_integer(item_id) or is_binary(item_id) do
    id =
      case item_id do
        n when is_integer(n) -> n
        b when is_binary(b) ->
          case Integer.parse(b) do
            {n, ""} -> n
            _ -> nil
          end
      end

    case id && Repo.get(Backend.Items.Item, id) do
      %{company_id: ^company_id, item_type: "equipment"} -> :ok
      %{item_type: t} -> {:error, {:item_wrong_type, t}}
      _ -> {:error, :item_not_found}
    end
  end

  defp ensure_item_is_equipment(_, _), do: {:error, :item_not_found}

  defp stringify_keys(attrs) when is_map(attrs) do
    Map.new(attrs, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} -> {k, v}
    end)
  end

  defp stringify_keys(attrs), do: attrs

  # ----- events (read) --------------------------------------------

  @doc """
  Ordered lifecycle timeline for a unit — oldest → newest so the FE
  can render top-down like an audit log. Preloads actor + from/to
  cells + assigned-to user for one-shot rendering.
  """
  def list_events(%Backend.Equipment.Equipment{id: equipment_id}) do
    from(e in Backend.Equipment.Event,
      where: e.equipment_id == ^equipment_id,
      order_by: [asc: e.occurred_at, asc: e.id],
      preload: [:actor, :from_cell, :to_cell, :assigned_to_user]
    )
    |> Repo.all()
  end

  # ----- files (metadata + storage) -------------------------------

  @doc """
  Record an uploaded file against an equipment unit. Bytes have
  already landed on `Backend.Storage`; this writes the metadata row
  + the audit trail + broadcasts an entity change so open detail
  pages refresh.

  Mirrors `Backend.Purchasing.upload_file/4` in shape.
  """
  def upload_file(
        %Backend.Accounts.User{} = actor,
        %Backend.Equipment.Equipment{} = equipment,
        attrs,
        bytes
      )
      when is_binary(bytes) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("company_id", equipment.company_id)
      |> Map.put("equipment_id", equipment.id)
      |> Map.put("uploaded_by_id", actor.id)

    key = build_equipment_file_storage_key(equipment, attrs)

    case Backend.Storage.put(key, bytes, content_type: attrs["mime"]) do
      {:ok, blob_path} ->
        attrs = Map.put(attrs, "blob_path", blob_path)

        %Backend.Equipment.File{}
        |> Backend.Equipment.File.changeset(attrs)
        |> Repo.insert()
        |> case do
          {:ok, file} ->
            Backend.Audit.record_created(actor, "equipment_file", file, %{
              equipment_id: file.equipment_id,
              kind: file.kind,
              filename: file.filename
            })

            Backend.Broadcasts.entity_changed(
              "equipment",
              equipment.uuid,
              equipment.company_id,
              "file_added"
            )

            {:ok, Repo.preload(file, :uploaded_by)}

          {:error, cs} ->
            _ = Backend.Storage.delete(blob_path)
            {:error, cs}
        end

      {:error, reason} ->
        {:error, {:storage_failed, reason}}
    end
  end

  @doc """
  Delete a file: wipe blob + metadata. Storage delete is best-effort
  — a stuck blob is harmless once the row is gone, but a row
  pointing at missing bytes would 404 every fetch.
  """
  def delete_file(
        %Backend.Accounts.User{} = actor,
        %Backend.Equipment.Equipment{} = equipment,
        %Backend.Equipment.File{} = file
      ) do
    Repo.transaction(fn ->
      case Repo.delete(file) do
        {:ok, deleted} ->
          _ = Backend.Storage.delete(file.blob_path)

          Backend.Audit.record_deleted(actor, "equipment_file", file, %{
            equipment_id: file.equipment_id,
            kind: file.kind,
            filename: file.filename
          })

          Backend.Broadcasts.entity_changed(
            "equipment",
            equipment.uuid,
            equipment.company_id,
            "file_removed"
          )

          deleted

        {:error, reason} ->
          Repo.rollback(reason)
      end
    end)
  end

  def list_files(%Backend.Equipment.Equipment{id: equipment_id}) do
    from(f in Backend.Equipment.File,
      where: f.equipment_id == ^equipment_id,
      order_by: [desc: f.inserted_at, desc: f.id],
      preload: [:uploaded_by]
    )
    |> Repo.all()
  end

  def get_file(%Backend.Equipment.Equipment{id: equipment_id, company_id: company_id}, file_uuid)
      when is_binary(file_uuid) do
    case Ecto.UUID.cast(file_uuid) do
      {:ok, cast} ->
        from(f in Backend.Equipment.File,
          where:
            f.equipment_id == ^equipment_id and
              f.company_id == ^company_id and
              f.uuid == ^cast,
          preload: [:uploaded_by]
        )
        |> Repo.one()

      :error ->
        nil
    end
  end

  defp build_equipment_file_storage_key(%Backend.Equipment.Equipment{} = equipment, attrs) do
    kind = attrs["kind"] || "other"
    filename = attrs["filename"] || "upload"

    "equipment_files/" <>
      equipment.uuid <>
      "/" <>
      kind <>
      "_" <>
      Ecto.UUID.generate() <>
      file_extension(filename)
  end

  defp file_extension(filename) when is_binary(filename) do
    case Path.extname(filename) do
      "" -> ""
      ext -> String.downcase(ext)
    end
  end
end
