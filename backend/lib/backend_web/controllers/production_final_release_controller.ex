defmodule BackendWeb.ProductionFinalReleaseController do
  @moduledoc """
  Final Product Release endpoints — BRCGS Issue 9 § 5.6 Positive Release.

  All actions gate on `production.final_release`. The context enforces
  segregation of duties (releaser ≠ approver) so a single permission
  holder can't self-release; they can only sign one of the two slots
  per release row.

  Endpoints — mount under `/api/production/final-releases`:

    * `GET    /queue`                     — pending release queue
    * `GET    /by-lot/:lot_uuid`          — get / lazy-open for a lot
    * `PATCH  /:uuid/notes`               — freeform release notes
    * `POST   /:uuid/files`               — multipart upload (kind param)
    * `DELETE /:uuid/files/:file_uuid`
    * `GET    /:uuid/files/:file_uuid`    — serve the blob (auth-gated)
    * `POST   /:uuid/sign-releaser`
    * `POST   /:uuid/sign-approver`
    * `POST   /:uuid/clear-signature`     — role: "releaser" | "approver"
    * `POST   /:uuid/release`             — needs dual sig + all files
    * `POST   /:uuid/hold`                — single sig + hold_reason
    * `POST   /:uuid/reject`              — single sig + reject_reason
  """

  use BackendWeb, :controller

  alias Backend.Production.{FinalRelease, FinalReleaseFile, FinalReleases}
  alias Backend.Repo
  alias BackendWeb.{Errors, Payloads}
  alias BackendWeb.Plugs.RequirePermission

  plug RequirePermission, "production.final_release"

  action_fallback BackendWeb.FallbackController

  # ----- Queue + fetch --------------------------------------------

  def queue(conn, _params) do
    actor = conn.assigns.current_user
    rows = FinalReleases.list_pending(actor.company_id)
    json(conn, %{items: Enum.map(rows, &Payloads.production_final_release/1)})
  end

  def by_lot(conn, %{"lot_uuid" => lot_uuid}) do
    actor = conn.assigns.current_user

    case FinalReleases.get_or_open(actor, lot_uuid) do
      {:ok, release} -> json(conn, %{release: Payloads.production_final_release(release)})
      {:error, :lot_not_found} -> not_found(conn)
      {:error, :not_a_manufactured_lot} -> unprocessable(conn, "not_a_manufactured_lot",
        "Only manufacturing-order output lots have a Final Product Release."
      )
      {:error, reason} -> unprocessable(conn, "open_failed", inspect(reason))
    end
  end

  # ----- Notes ----------------------------------------------------

  def update_notes(conn, %{"uuid" => uuid} = params) do
    actor = conn.assigns.current_user
    notes = params["notes"] || ""

    with %FinalRelease{} = release <- get_release(actor, uuid),
         {:ok, updated} <- FinalReleases.update_notes(actor, release, notes) do
      json(conn, %{release: Payloads.production_final_release(updated)})
    else
      nil -> not_found(conn)
      {:error, :already_finalized} -> conflict_finalized(conn)
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  # ----- Files ----------------------------------------------------

  def upload_file(conn, %{"uuid" => uuid, "kind" => kind, "file" => %Plug.Upload{} = upload}) do
    actor = conn.assigns.current_user

    with %FinalRelease{} = release <- get_release(actor, uuid),
         {:ok, file} <- FinalReleases.upload_file(actor, release, kind, upload) do
      conn
      |> put_status(:created)
      |> json(%{file: Payloads.production_final_release_file(file)})
    else
      nil -> not_found(conn)
      {:error, :already_finalized} -> conflict_finalized(conn)
      {:error, :bad_kind} -> unprocessable(conn, "bad_kind",
        "kind must be one of: #{Enum.join(FinalReleases.required_file_kinds(), ", ")}."
      )
      {:error, {:invalid_mime, detail}} -> unprocessable(conn, "invalid_mime_type", detail)
      {:error, {:too_large, bytes}} -> unprocessable(conn, "file_too_large",
        "Attachment exceeded #{FinalReleases.max_file_bytes()} bytes (was #{bytes})."
      )
      {:error, {:read_failed, reason}} -> unprocessable(conn, "read_failed",
        "Couldn't read the upload: #{inspect(reason)}."
      )
      {:error, {:storage_failed, reason}} -> unprocessable(conn, "storage_failed",
        "Couldn't store the file: #{inspect(reason)}."
      )
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
    end
  end

  def upload_file(conn, _params) do
    unprocessable(conn, "missing_file", "Send file under `file` (multipart) with a `kind`.")
  end

  def delete_file(conn, %{"uuid" => uuid, "file_uuid" => file_uuid}) do
    actor = conn.assigns.current_user

    with %FinalRelease{} = release <- get_release(actor, uuid),
         {:ok, _} <- FinalReleases.delete_file(actor, release, file_uuid) do
      send_resp(conn, :no_content, "")
    else
      nil -> not_found(conn)
      {:error, :file_not_found} -> not_found(conn)
      {:error, :already_finalized} -> conflict_finalized(conn)
      {:error, reason} -> unprocessable(conn, "delete_failed", inspect(reason))
    end
  end

  def serve_file(conn, %{"uuid" => uuid, "file_uuid" => file_uuid}) do
    actor = conn.assigns.current_user

    with %FinalRelease{} = release <- get_release(actor, uuid),
         %FinalReleaseFile{} = file <-
           Repo.get_by(FinalReleaseFile,
             uuid: file_uuid,
             company_id: actor.company_id,
             production_final_release_id: release.id
           ),
         abs_path = Backend.Storage.Local.absolute_path(file.blob_path),
         true <- File.exists?(abs_path) do
      conn
      |> put_resp_header("content-type", file.mime)
      |> put_resp_header(
        "content-disposition",
        "inline; filename=\"#{file.filename}\""
      )
      |> send_file(200, abs_path)
    else
      _ -> not_found(conn)
    end
  end

  # ----- Signatures -----------------------------------------------

  def sign_releaser(conn, %{"uuid" => uuid} = params) do
    dispatch_signature(conn, uuid, :releaser, params["signature_image"])
  end

  def sign_approver(conn, %{"uuid" => uuid} = params) do
    dispatch_signature(conn, uuid, :approver, params["signature_image"])
  end

  def clear_signature(conn, %{"uuid" => uuid, "role" => role})
      when role in ["releaser", "approver"] do
    actor = conn.assigns.current_user
    role_atom = String.to_existing_atom(role)

    with %FinalRelease{} = release <- get_release(actor, uuid),
         {:ok, updated} <- FinalReleases.clear_signature(actor, release, role_atom) do
      json(conn, %{release: Payloads.production_final_release(updated)})
    else
      nil -> not_found(conn)
      {:error, :already_finalized} -> conflict_finalized(conn)
      {:error, :not_your_signature} ->
        conn
        |> put_status(:forbidden)
        |> json(Errors.payload("not_your_signature", "You can only clear your own signature.", %{}))
      {:error, reason} -> unprocessable(conn, "clear_failed", inspect(reason))
    end
  end

  def clear_signature(conn, _), do:
    unprocessable(conn, "bad_role", "role must be releaser or approver.")

  defp dispatch_signature(conn, uuid, role, image) do
    actor = conn.assigns.current_user

    fun =
      case role do
        :releaser -> &FinalReleases.sign_as_releaser/3
        :approver -> &FinalReleases.sign_as_approver/3
      end

    with %FinalRelease{} = release <- get_release(actor, uuid),
         {:ok, updated} <- fun.(actor, release, image) do
      json(conn, %{release: Payloads.production_final_release(updated)})
    else
      nil -> not_found(conn)
      {:error, :already_finalized} -> conflict_finalized(conn)
      {:error, :forbidden} ->
        conn
        |> put_status(:forbidden)
        |> json(Errors.payload("forbidden", "You lack production.final_release.", %{}))
      {:error, :must_be_different_from_approver} ->
        unprocessable(conn, "must_be_different_from_approver",
          "You've already signed as the approver on this release. Two different users must sign."
        )
      {:error, :must_be_different_from_releaser} ->
        unprocessable(conn, "must_be_different_from_releaser",
          "You've already signed as the releaser on this release. Two different users must sign."
        )
      {:error, %Ecto.Changeset{} = cs} -> changeset_error(conn, cs)
      {:error, reason} -> unprocessable(conn, "sign_failed", inspect(reason))
    end
  end

  # ----- Decisions ------------------------------------------------

  def release(conn, %{"uuid" => uuid} = params) do
    actor = conn.assigns.current_user

    with %FinalRelease{} = row <- get_release(actor, uuid),
         {:ok, updated} <- FinalReleases.release(actor, row, params) do
      json(conn, %{release: Payloads.production_final_release(updated)})
    else
      nil -> not_found(conn)
      {:error, reason} -> map_decision_error(conn, reason)
    end
  end

  def hold(conn, %{"uuid" => uuid} = params) do
    actor = conn.assigns.current_user

    with %FinalRelease{} = row <- get_release(actor, uuid),
         {:ok, updated} <- FinalReleases.hold(actor, row, params) do
      json(conn, %{release: Payloads.production_final_release(updated)})
    else
      nil -> not_found(conn)
      {:error, reason} -> map_decision_error(conn, reason)
    end
  end

  def reject(conn, %{"uuid" => uuid} = params) do
    actor = conn.assigns.current_user

    with %FinalRelease{} = row <- get_release(actor, uuid),
         {:ok, updated} <- FinalReleases.reject(actor, row, params) do
      json(conn, %{release: Payloads.production_final_release(updated)})
    else
      nil -> not_found(conn)
      {:error, reason} -> map_decision_error(conn, reason)
    end
  end

  # ----- Helpers --------------------------------------------------

  defp get_release(actor, uuid) do
    Repo.get_by(FinalRelease, uuid: uuid, company_id: actor.company_id)
  end

  defp map_decision_error(conn, :already_finalized), do: conflict_finalized(conn)

  defp map_decision_error(conn, :forbidden) do
    conn
    |> put_status(:forbidden)
    |> json(Errors.payload("forbidden", "You lack production.final_release.", %{}))
  end

  defp map_decision_error(conn, :dual_signatures_required) do
    unprocessable(conn, "dual_signatures_required",
      "Release requires two different signatures — releaser AND approver — before it can finalise."
    )
  end

  defp map_decision_error(conn, {:missing_files, kinds}) do
    unprocessable(conn, "missing_files",
      "Attach at least one file of each required kind before releasing. Missing: #{Enum.join(kinds, ", ")}."
    )
  end

  defp map_decision_error(conn, :must_sign_first) do
    unprocessable(conn, "must_sign_first",
      "Sign as releaser or approver before Hold / Reject."
    )
  end

  defp map_decision_error(conn, {:missing_reason, :hold_reason}) do
    unprocessable(conn, "missing_hold_reason",
      "Hold needs a reason — what's the investigation about?"
    )
  end

  defp map_decision_error(conn, {:missing_reason, :reject_reason}) do
    unprocessable(conn, "missing_reject_reason",
      "Reject needs a reason — what went wrong?"
    )
  end

  defp map_decision_error(conn, :lot_not_awaiting_release) do
    unprocessable(conn, "lot_not_awaiting_release",
      "This lot's status has moved — refresh and re-check."
    )
  end

  defp map_decision_error(conn, :lot_not_releasable) do
    unprocessable(conn, "lot_not_releasable",
      "This lot's lifecycle state doesn't support the requested action (rejected / disposed / held lots aren't re-releasable through this form)."
    )
  end

  defp map_decision_error(conn, :lot_not_found), do: not_found(conn)

  defp map_decision_error(conn, %Ecto.Changeset{} = cs), do: changeset_error(conn, cs)

  defp map_decision_error(conn, reason),
    do: unprocessable(conn, "decision_failed", inspect(reason))

  defp not_found(conn) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "Not found.", %{}))
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(Errors.payload(code, detail, %{}))
  end

  defp conflict_finalized(conn) do
    conn
    |> put_status(:conflict)
    |> json(
      Errors.payload("already_finalized",
        "This release has already been finalised (released / on_hold / rejected).",
        %{})
    )
  end

  defp changeset_error(conn, cs) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(
      Errors.payload("validation_failed",
        "One or more fields failed validation.",
        Errors.changeset_fields(cs))
    )
  end
end
