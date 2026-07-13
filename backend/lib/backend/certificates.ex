defmodule Backend.Certificates do
  @moduledoc """
  Boundary for the company-scoped certificate registry + per-item
  attachments. Same shape as the other catalogue contexts
  (cursor-paginated list, get-for-company by UUID, full-replace
  attachments).
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Certificates.Certificate
  alias Backend.Certificates.ItemCertificate
  alias Backend.Items.Item
  alias Backend.ListQueries
  alias Backend.Repo

  @cert_audit_fields ~w(name certificate_type issuing_body default_validity_months description is_active)a
  @cert_sortable ~w(id name certificate_type issuing_body default_validity_months is_active inserted_at updated_at)a
  @cert_search ~w(name issuing_body description)a
  @cert_default_sort {:name, :asc}

  @attach_audit_fields ~w(certificate_id certificate_number valid_from valid_until document_url notes uploaded_at)a

  # ----- certificate registry --------------------------------------

  def list_page(company_id, opts \\ []) do
    sort = normalise_sort(Keyword.get(opts, :sort, @cert_default_sort))

    {code_id, column_filter} =
      ListQueries.pop_code_column_filter(opts[:column_filter], company_id, "certificate")

    base =
      Certificate
      |> where([c], c.company_id == ^company_id)
      |> ListQueries.apply_search(opts[:search], @cert_search, {company_id, "certificate"})
      |> maybe_code_id_filter(code_id)
      |> ListQueries.apply_column_filters(column_filter, @cert_sortable)
      |> ListQueries.apply_sort(sort, @cert_sortable, @cert_default_sort)
      |> preload([:created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_code_id_filter(query, nil), do: query
  defp maybe_code_id_filter(query, :no_match), do: where(query, [c], false)
  defp maybe_code_id_filter(query, id) when is_integer(id),
    do: where(query, [c], c.id == ^id)

  def list_for_company(company_id) do
    Repo.all(
      from(c in Certificate,
        where: c.company_id == ^company_id and c.is_active == true,
        order_by: [asc: c.name]
      )
    )
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  def list_config do
    %{
      sortable_fields: Enum.map(@cert_sortable, &Atom.to_string/1),
      search_fields: Enum.map(@cert_search, &Atom.to_string/1),
      default_sort: %{
        field: Atom.to_string(elem(@cert_default_sort, 0)),
        direction: Atom.to_string(elem(@cert_default_sort, 1))
      }
    }
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(c in Certificate,
            where: c.company_id == ^company_id and c.uuid == ^cast,
            preload: [:created_by, :updated_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  def create(%User{} = actor, company_id, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "company_id" => company_id,
        "created_by_id" => actor.id,
        "updated_by_id" => actor.id
      })

    %Certificate{}
    |> Certificate.changeset(attrs)
    |> Repo.insert()
    |> after_create(actor)
  end

  def update(%User{} = actor, %Certificate{} = cert, attrs) do
    before_state = cert_snapshot(cert)

    cert
    |> Certificate.changeset(
      attrs |> stringify_keys() |> Map.put("updated_by_id", actor.id)
    )
    |> Repo.update()
    |> after_update(actor, before_state)
  end

  def delete(%User{} = actor, %Certificate{} = cert) do
    before_state = cert_snapshot(cert)

    case Repo.delete(cert) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "certificate", cert, before_state)
        Backend.Broadcasts.entity_changed("certificate", cert.uuid, cert.company_id, "deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  # ----- per-item attachments --------------------------------------

  @doc """
  Attachments on an item, joined to the certificate definition for
  the FE to render the name + type alongside the validity window.
  """
  def list_attachments(item_id) when is_integer(item_id) do
    # Previously: `preload: [certificate: c, uploaded_by: :id]` — the
    # `:id` in the nested spot is malformed (not a valid preload key),
    # so `uploaded_by` wasn't actually loaded. The tail `Enum.map` then
    # fired a per-row `Repo.preload` to fix it up, fanning out to N+1.
    # Correct spec preloads both associations in the single query.
    Repo.all(
      from(ic in ItemCertificate,
        where: ic.item_id == ^item_id,
        join: c in assoc(ic, :certificate),
        preload: [certificate: c, uploaded_by: :id],
        order_by: [asc: c.name]
      )
    )
    |> Repo.preload(:uploaded_by)
  end

  def get_attachment_for_item(item_id, att_uuid) when is_binary(att_uuid) do
    case Ecto.UUID.cast(att_uuid) do
      {:ok, cast} ->
        Repo.one(
          from(ic in ItemCertificate,
            where: ic.item_id == ^item_id and ic.uuid == ^cast,
            preload: [:certificate, :uploaded_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_attachment_for_item(_item_id, _), do: nil

  def attach(%User{} = actor, %Item{} = item, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.merge(%{
        "item_id" => item.id,
        "uploaded_by_id" => actor.id,
        "uploaded_at" =>
          attrs["uploaded_at"] || DateTime.utc_now() |> DateTime.truncate(:second)
      })

    %ItemCertificate{}
    |> ItemCertificate.changeset(attrs)
    |> Repo.insert()
    |> after_attach_create(actor)
  end

  def update_attachment(%User{} = actor, %ItemCertificate{} = att, attrs) do
    before_state = attach_snapshot(att)

    att
    |> ItemCertificate.changeset(stringify_keys(attrs))
    |> Repo.update()
    |> after_attach_update(actor, before_state)
  end

  def detach(%User{} = actor, %ItemCertificate{} = att) do
    before_state = attach_snapshot(att)

    case Repo.delete(att) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "item_certificate", att, before_state)
        broadcast_item_from_attachment(att, "certificate_detached")
        {:ok, deleted}

      other ->
        other
    end
  end

  # ----- helpers ---------------------------------------------------

  defp after_create({:ok, cert}, actor) do
    Audit.record_created(actor, "certificate", cert, cert_snapshot(cert))
    Backend.Broadcasts.entity_changed("certificate", cert.uuid, cert.company_id, "created")
    {:ok, Repo.preload(cert, [:created_by, :updated_by])}
  end

  defp after_create(other, _actor), do: other

  defp after_update({:ok, cert}, actor, before_state) do
    Audit.record_updated(actor, "certificate", cert, before_state, cert_snapshot(cert))
    Backend.Broadcasts.entity_changed("certificate", cert.uuid, cert.company_id, "updated")
    {:ok, Repo.preload(cert, [:created_by, :updated_by])}
  end

  defp after_update(other, _actor, _before), do: other

  defp after_attach_create({:ok, att}, actor) do
    loaded = Repo.preload(att, [:certificate, :uploaded_by])
    Audit.record_created(actor, "item_certificate", loaded, attach_snapshot(loaded))
    broadcast_item_from_attachment(loaded, "certificate_attached")
    {:ok, loaded}
  end

  defp after_attach_create(other, _actor), do: other

  defp after_attach_update({:ok, att}, actor, before_state) do
    loaded = Repo.preload(att, [:certificate, :uploaded_by])

    Audit.record_updated(
      actor,
      "item_certificate",
      loaded,
      before_state,
      attach_snapshot(loaded)
    )

    broadcast_item_from_attachment(loaded, "certificate_updated")
    {:ok, loaded}
  end

  defp after_attach_update(other, _actor, _before), do: other

  defp cert_snapshot(%Certificate{} = c),
    do: Map.new(@cert_audit_fields, fn k -> {k, Map.get(c, k)} end)

  defp attach_snapshot(%ItemCertificate{} = a),
    do: Map.new(@attach_audit_fields, fn k -> {k, Map.get(a, k)} end)

  # Item-certificate attach/detach mutates the item's certificates
  # tab. Broadcast on the parent "item" topic so the detail page
  # re-fetches. We look up the item lazily — the ItemCertificate row
  # carries item_id but not the uuid we broadcast on.
  defp broadcast_item_from_attachment(%ItemCertificate{item_id: item_id}, action)
       when is_integer(item_id) do
    case Repo.get(Item, item_id) do
      %Item{uuid: uuid, company_id: company_id} ->
        Backend.Broadcasts.entity_changed("item", uuid, company_id, action)

      _ ->
        :ok
    end
  end

  defp broadcast_item_from_attachment(_, _), do: :ok

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
