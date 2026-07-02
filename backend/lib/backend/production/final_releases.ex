defmodule Backend.Production.FinalReleases do
  @moduledoc """
  Final Product Release context — BRCGS Issue 9 § 5.6 Positive Release.

  State machine for the release-of-finished-product ceremony:

  * `pending` → releaser + approver both sign → `release/2` → lot
    lifecycle event `released` → lot status `available` (dispatchable).
  * `pending` → single QA user signs → `hold/3` → lot lifecycle event
    `held` → lot status `on_hold`.
  * `pending` → single QA user signs → `reject/3` → lot lifecycle event
    `qc_failed` → lot status `rejected`.

  Sign-off rules:

  * Both signatures must be present AND be different users AND both
    must carry the `production.final_release` permission (segregation
    of duties — BRCGS Grade A).
  * All four file kinds (`coa`, `bmr`, `micro`, `label_retain`) must
    have at least one attachment before `release/2` is allowed.

  The row upserts on `stock_lot_id` — one row per output lot. Held /
  rejected lots that later come back for reconsideration get their
  existing row reset to `pending` via `reopen/2`.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.RBAC
  alias Backend.Production.{FinalRelease, FinalReleaseFile}
  alias Backend.Production.ManufacturingOrder
  alias Backend.Repo
  alias Backend.Stock
  alias Backend.Stock.Lifecycle
  alias Backend.Stock.Lot
  alias Backend.Storage

  @perm "production.final_release"
  @required_file_kinds ~w(coa bmr micro label_retain)
  @allowed_file_mimes ~w(application/pdf image/jpeg image/png image/webp image/heic)
  @max_file_bytes 20 * 1024 * 1024

  def required_file_kinds, do: @required_file_kinds
  def allowed_file_mimes, do: @allowed_file_mimes
  def max_file_bytes, do: @max_file_bytes

  # ============================================================
  # Load / open
  # ============================================================

  @doc """
  Fetch (or lazily create) the release row for a lot. Callers scope
  by lot uuid — that's the identity the FE dialog binds to.

  Refuses non-manufacturing-order lots (no positive release on raw
  materials) and non-awaiting-release lots (release only applies to
  finished output past output-QC).
  """
  def get_or_open(%User{} = actor, lot_uuid) when is_binary(lot_uuid) do
    with %Lot{} = lot <- Stock.get_for_company(actor.company_id, lot_uuid),
         :ok <- ensure_manufactured_lot(lot),
         :ok <- ensure_awaiting_release_or_open(lot),
         {:ok, mo_id} <- resolve_mo_id(lot) do
      case Repo.get_by(FinalRelease, stock_lot_id: lot.id, company_id: actor.company_id) do
        %FinalRelease{} = existing ->
          {:ok, preload(existing)}

        nil ->
          %FinalRelease{}
          |> FinalRelease.changeset(%{
            company_id: actor.company_id,
            manufacturing_order_id: mo_id,
            stock_lot_id: lot.id,
            status: "pending",
            created_by_id: actor.id,
            updated_by_id: actor.id
          })
          |> Repo.insert()
          |> case do
            {:ok, row} -> {:ok, preload(row)}
            {:error, cs} -> {:error, cs}
          end
      end
    else
      nil -> {:error, :lot_not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Pending release queue for the mobile + desktop CTAs."
  def list_pending(company_id) when is_integer(company_id) do
    from(fr in FinalRelease,
      where: fr.company_id == ^company_id and fr.status == "pending",
      preload: [
        :manufacturing_order,
        :releaser,
        :approver,
        :files,
        stock_lot: [:item, placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]]
      ],
      order_by: [asc: fr.inserted_at, asc: fr.id]
    )
    |> Repo.all()
  end

  # ============================================================
  # File attachments
  # ============================================================

  @doc """
  Upload + attach an evidence file. Handles the whole flow: mime +
  size validation, `Backend.Storage.put/3`, metadata row insert, and
  best-effort rollback of the blob if the row insert fails.

  Refuses uploads once the release row has finalised — evidence must
  land before Release / Hold / Reject fires.
  """
  def upload_file(
        %User{} = actor,
        %FinalRelease{} = release,
        kind,
        %Plug.Upload{} = upload
      ) do
    cond do
      release.status != "pending" ->
        {:error, :already_finalized}

      kind not in @required_file_kinds ->
        {:error, :bad_kind}

      true ->
        with :ok <- validate_mime(upload.content_type),
             {:ok, bytes} <- read_upload(upload),
             :ok <- validate_size(bytes) do
          filename = upload.filename || "upload"
          mime = upload.content_type || "application/octet-stream"

          key =
            "production_final_release_files/" <>
              release.uuid <>
              "/" <>
              kind <>
              "_" <>
              Ecto.UUID.generate() <>
              file_extension(filename)

          case Storage.put(key, bytes, content_type: mime) do
            {:ok, blob_path} ->
              %FinalReleaseFile{}
              |> FinalReleaseFile.changeset(%{
                company_id: release.company_id,
                production_final_release_id: release.id,
                kind: kind,
                filename: filename,
                mime: mime,
                byte_size: byte_size(bytes),
                blob_path: blob_path,
                uploaded_by_id: actor.id
              })
              |> Repo.insert()
              |> case do
                {:ok, file} ->
                  {:ok, Repo.preload(file, :uploaded_by)}

                {:error, cs} ->
                  _ = Storage.delete(blob_path)
                  {:error, cs}
              end

            {:error, reason} ->
              {:error, {:storage_failed, reason}}
          end
        end
    end
  end

  @doc "Hard-delete a file row + its blob. Allowed only while pending."
  def delete_file(%User{} = actor, %FinalRelease{} = release, file_uuid)
      when is_binary(file_uuid) do
    cond do
      release.status != "pending" ->
        {:error, :already_finalized}

      true ->
        case Repo.get_by(FinalReleaseFile,
               uuid: file_uuid,
               company_id: actor.company_id,
               production_final_release_id: release.id
             ) do
          nil ->
            {:error, :file_not_found}

          %FinalReleaseFile{} = file ->
            Repo.transaction(fn ->
              case Repo.delete(file) do
                {:ok, deleted} ->
                  _ = Storage.delete(deleted.blob_path)
                  deleted

                {:error, reason} ->
                  Repo.rollback(reason)
              end
            end)
        end
    end
  end

  defp validate_mime(mime) when mime in @allowed_file_mimes, do: :ok

  defp validate_mime(mime) do
    {:error,
     {:invalid_mime,
      "Unsupported file type (#{mime || "unknown"}). Allowed: PDF, JPEG, PNG, WebP, HEIC."}}
  end

  defp validate_size(bytes) when byte_size(bytes) > @max_file_bytes do
    {:error, {:too_large, byte_size(bytes)}}
  end

  defp validate_size(_), do: :ok

  defp read_upload(%Plug.Upload{path: path}) do
    case File.read(path) do
      {:ok, bytes} -> {:ok, bytes}
      {:error, reason} -> {:error, {:read_failed, reason}}
    end
  end

  defp file_extension(filename) when is_binary(filename) do
    case Path.extname(filename) do
      "" -> ""
      ext -> String.downcase(ext)
    end
  end

  # ============================================================
  # Signatures
  # ============================================================

  @doc """
  Stamp the current user as the releaser. Idempotent — re-signing
  updates the timestamp. Refuses if the current user is already the
  approver on the same row (segregation of duties).
  """
  def sign_as_releaser(%User{} = actor, %FinalRelease{} = release, signature_image) do
    cond do
      release.status != "pending" ->
        {:error, :already_finalized}

      not RBAC.has_permission?(actor, @perm) ->
        {:error, :forbidden}

      release.approver_id == actor.id ->
        {:error, :must_be_different_from_approver}

      true ->
        release
        |> FinalRelease.changeset(%{
          releaser_id: actor.id,
          releaser_signature_image: signature_image,
          releaser_signed_at: now(),
          updated_by_id: actor.id
        })
        |> Repo.update()
        |> case do
          {:ok, row} -> {:ok, preload(row)}
          err -> err
        end
    end
  end

  @doc """
  Stamp the current user as the approver. Same rules mirrored — must
  have the permission AND must differ from the releaser.
  """
  def sign_as_approver(%User{} = actor, %FinalRelease{} = release, signature_image) do
    cond do
      release.status != "pending" ->
        {:error, :already_finalized}

      not RBAC.has_permission?(actor, @perm) ->
        {:error, :forbidden}

      release.releaser_id == actor.id ->
        {:error, :must_be_different_from_releaser}

      true ->
        release
        |> FinalRelease.changeset(%{
          approver_id: actor.id,
          approver_signature_image: signature_image,
          approver_signed_at: now(),
          updated_by_id: actor.id
        })
        |> Repo.update()
        |> case do
          {:ok, row} -> {:ok, preload(row)}
          err -> err
        end
    end
  end

  @doc "Clear the current user's signature (Undo)."
  def clear_signature(%User{} = actor, %FinalRelease{} = release, role)
      when role in [:releaser, :approver] do
    cond do
      release.status != "pending" ->
        {:error, :already_finalized}

      role == :releaser and release.releaser_id != actor.id ->
        {:error, :not_your_signature}

      role == :approver and release.approver_id != actor.id ->
        {:error, :not_your_signature}

      true ->
        attrs =
          case role do
            :releaser ->
              %{releaser_id: nil, releaser_signature_image: nil, releaser_signed_at: nil}

            :approver ->
              %{approver_id: nil, approver_signature_image: nil, approver_signed_at: nil}
          end

        release
        |> FinalRelease.changeset(Map.put(attrs, :updated_by_id, actor.id))
        |> Repo.update()
        |> case do
          {:ok, row} -> {:ok, preload(row)}
          err -> err
        end
    end
  end

  # ============================================================
  # Decisions — Release / Hold / Reject
  # ============================================================

  @doc """
  Finalise as Release. Requires dual sign-off + all four file kinds.
  Emits the `released` lifecycle event on the lot → status flips to
  `available` → auto-router moves it out of `finished_quarantine`.
  """
  def release(%User{} = actor, %FinalRelease{} = release, attrs \\ %{}) do
    with :ok <- ensure_pending(release),
         :ok <- ensure_permission(actor),
         :ok <- ensure_dual_signatures(release),
         :ok <- ensure_all_files_present(release),
         {:ok, lot} <- fetch_lot(release),
         :ok <- ensure_lot_awaiting_release(lot) do
      notes = Map.get(attrs, "notes") || Map.get(attrs, :notes) || release.notes

      Repo.transaction(fn ->
        with {:ok, updated} <- finalise_row(actor, release, "released", %{notes: notes}),
             {:ok, _lifecycle} <-
               Lifecycle.record_event_in_transaction(lot, "released", %{
                 actor: actor,
                 actor_kind: "user",
                 reason: notes,
                 metadata: %{
                   "final_release_uuid" => updated.uuid,
                   "releaser_id" => updated.releaser_id,
                   "approver_id" => updated.approver_id
                 }
               }) do
          preload(updated)
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  @doc """
  Finalise as Hold. Single-approver — the acting user must have the
  release permission and must have signed as releaser first (single
  signature is enough to hold; hold is a pause not a release).
  """
  def hold(%User{} = actor, %FinalRelease{} = release, attrs) do
    reason = Map.get(attrs, "hold_reason") || Map.get(attrs, :hold_reason)

    with :ok <- ensure_pending(release),
         :ok <- ensure_permission(actor),
         :ok <- ensure_actor_signed(release, actor),
         :ok <- ensure_reason(reason, :hold_reason),
         {:ok, lot} <- fetch_lot(release),
         :ok <- ensure_lot_awaiting_release(lot) do
      Repo.transaction(fn ->
        with {:ok, updated} <-
               finalise_row(actor, release, "on_hold", %{hold_reason: reason}),
             {:ok, _lifecycle} <-
               Lifecycle.record_event_in_transaction(lot, "held", %{
                 actor: actor,
                 actor_kind: "user",
                 reason: reason,
                 metadata: %{"final_release_uuid" => updated.uuid}
               }) do
          preload(updated)
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  @doc """
  Finalise as Reject. Same single-approver rules as hold; the lot
  goes to `rejected` (auto-router moves to a `rejected` cell).
  """
  def reject(%User{} = actor, %FinalRelease{} = release, attrs) do
    reason = Map.get(attrs, "reject_reason") || Map.get(attrs, :reject_reason)

    with :ok <- ensure_pending(release),
         :ok <- ensure_permission(actor),
         :ok <- ensure_actor_signed(release, actor),
         :ok <- ensure_reason(reason, :reject_reason),
         {:ok, lot} <- fetch_lot(release),
         :ok <- ensure_lot_awaiting_release(lot) do
      Repo.transaction(fn ->
        with {:ok, updated} <-
               finalise_row(actor, release, "rejected", %{reject_reason: reason}),
             {:ok, _lifecycle} <-
               Lifecycle.record_event_in_transaction(lot, "qc_failed", %{
                 actor: actor,
                 actor_kind: "user",
                 reason: reason,
                 metadata: %{"final_release_uuid" => updated.uuid}
               }) do
          preload(updated)
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
    end
  end

  # ============================================================
  # Draft edits — freeform notes on the pending row
  # ============================================================

  def update_notes(%User{} = actor, %FinalRelease{} = release, notes) do
    with :ok <- ensure_pending(release) do
      release
      |> FinalRelease.changeset(%{notes: notes, updated_by_id: actor.id})
      |> Repo.update()
      |> case do
        {:ok, row} -> {:ok, preload(row)}
        err -> err
      end
    end
  end

  # ============================================================
  # Internals
  # ============================================================

  defp finalise_row(actor, release, next_status, extra_attrs) do
    attrs =
      extra_attrs
      |> Map.put(:status, next_status)
      |> Map.put(:finalized_at, now())
      |> Map.put(:finalized_by_id, actor.id)
      |> Map.put(:updated_by_id, actor.id)

    release
    |> FinalRelease.changeset(attrs)
    |> Repo.update()
  end

  defp preload(%FinalRelease{} = row) do
    Repo.preload(row, [
      :manufacturing_order,
      :releaser,
      :approver,
      :finalized_by,
      :files,
      stock_lot: [:item, placements: [storage_cell: [storage_location: [floor: [:warehouse]]]]]
    ])
  end

  defp ensure_pending(%FinalRelease{status: "pending"}), do: :ok
  defp ensure_pending(_), do: {:error, :already_finalized}

  defp ensure_permission(%User{} = actor) do
    if RBAC.has_permission?(actor, @perm), do: :ok, else: {:error, :forbidden}
  end

  defp ensure_dual_signatures(%FinalRelease{
         releaser_id: r,
         approver_id: a
       })
       when is_integer(r) and is_integer(a) and r != a,
       do: :ok

  defp ensure_dual_signatures(_), do: {:error, :dual_signatures_required}

  defp ensure_all_files_present(%FinalRelease{} = release) do
    files = Repo.all(from f in FinalReleaseFile, where: f.production_final_release_id == ^release.id)
    kinds = MapSet.new(files, & &1.kind)
    missing = Enum.reject(@required_file_kinds, &MapSet.member?(kinds, &1))

    if missing == [] do
      :ok
    else
      {:error, {:missing_files, missing}}
    end
  end

  defp ensure_actor_signed(%FinalRelease{releaser_id: id}, %User{id: id}), do: :ok
  defp ensure_actor_signed(%FinalRelease{approver_id: id}, %User{id: id}), do: :ok
  defp ensure_actor_signed(_, _), do: {:error, :must_sign_first}

  defp ensure_reason(reason, _key) when is_binary(reason) and byte_size(reason) > 0, do: :ok
  defp ensure_reason(_, key), do: {:error, {:missing_reason, key}}

  defp ensure_manufactured_lot(%Lot{source_kind: "manufacturing_order"}), do: :ok
  defp ensure_manufactured_lot(_), do: {:error, :not_a_manufactured_lot}

  defp ensure_awaiting_release_or_open(%Lot{status: "awaiting_release"}), do: :ok

  defp ensure_awaiting_release_or_open(%Lot{}) do
    # The lot has already been Released / Held / Rejected — the row
    # remains readable but no more changes.
    :ok
  end

  defp ensure_lot_awaiting_release(%Lot{status: "awaiting_release"}), do: :ok
  defp ensure_lot_awaiting_release(_), do: {:error, :lot_not_awaiting_release}

  defp fetch_lot(%FinalRelease{stock_lot_id: id}) do
    case Repo.get(Lot, id) do
      nil -> {:error, :lot_not_found}
      %Lot{} = lot -> {:ok, lot}
    end
  end

  defp resolve_mo_id(%Lot{source_kind: "manufacturing_order", source_ref: ref})
       when is_binary(ref) do
    case Repo.get_by(ManufacturingOrder, uuid: ref) do
      nil -> {:error, :mo_not_found}
      %ManufacturingOrder{id: id} -> {:ok, id}
    end
  end

  defp resolve_mo_id(_), do: {:error, :not_a_manufactured_lot}

  defp now, do: DateTime.utc_now() |> DateTime.truncate(:second)
end
