defmodule Backend.Forms.Templates do
  @moduledoc """
  Boundary for form-template CRUD.

  Templates are tenant-scoped and unique-named per tenant among
  active rows. Every save bumps ``version`` — the publisher uses it
  as a monotonic idempotency key when upserting into vita-perf's
  DynamicForm mirror.

  Publish itself lives in `Backend.Forms.Publisher` (spawned from
  here after successful writes so the DB transaction commits before
  the HTTP call fires).
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Broadcasts
  alias Backend.Forms.FormTemplate
  alias Backend.Forms.Publisher
  alias Backend.Repo

  # ── Reads ────────────────────────────────────────────────────────

  def list_for_company(company_id) when is_integer(company_id) do
    FormTemplate
    |> where([t], t.company_id == ^company_id)
    |> order_by([t], desc: t.is_active, asc: :name)
    |> preload([:created_by, :updated_by])
    |> Repo.all()
  end

  def list_active_for_company(company_id) when is_integer(company_id) do
    FormTemplate
    |> where([t], t.company_id == ^company_id and t.is_active == true)
    |> order_by([t], asc: :name)
    |> Repo.all()
  end

  def list_active_by_trigger(company_id, trigger)
      when is_integer(company_id) and is_binary(trigger) do
    FormTemplate
    |> where(
      [t],
      t.company_id == ^company_id and t.is_active == true and t.trigger == ^trigger
    )
    |> order_by([t], asc: :name)
    |> Repo.all()
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        FormTemplate
        |> where([t], t.company_id == ^company_id and t.uuid == ^cast)
        |> preload([:created_by, :updated_by])
        |> Repo.one()

      _ ->
        nil
    end
  end

  # ── Writes ───────────────────────────────────────────────────────

  def create(company_id, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.put("company_id", company_id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)
      |> Map.put("version", 1)

    case %FormTemplate{}
         |> FormTemplate.changeset(attrs)
         |> Repo.insert() do
      {:ok, template} = ok ->
        Broadcasts.entity_changed("form-template", template.uuid, template.company_id, "created")
        Publisher.publish_template(template)
        ok

      error ->
        error
    end
  end

  @doc """
  Update a template. Every successful edit bumps ``version`` — this
  is what the publisher uses to tell "you've saved since I last
  pushed" and what vita-perf's ingest endpoint uses to drop stale
  writes (accept only when incoming version > stored version).
  """
  def update(%FormTemplate{} = template, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.drop(["company_id", "created_by_id", "version", "last_published_at", "last_published_version"])
      |> Map.put("updated_by_id", actor.id)
      |> Map.put("version", template.version + 1)

    case template
         |> FormTemplate.changeset(attrs)
         |> Repo.update() do
      {:ok, updated} = ok ->
        Broadcasts.entity_changed("form-template", updated.uuid, updated.company_id, "updated")
        Publisher.publish_template(updated)
        ok

      error ->
        error
    end
  end

  def deactivate(%FormTemplate{} = template, %User{} = actor) do
    case template
         |> FormTemplate.changeset(%{
           "is_active" => false,
           "updated_by_id" => actor.id,
           "version" => template.version + 1
         })
         |> Repo.update() do
      {:ok, updated} = ok ->
        Broadcasts.entity_changed(
          "form-template",
          updated.uuid,
          updated.company_id,
          "deactivated"
        )

        Publisher.publish_template(updated)
        ok

      error ->
        error
    end
  end

  def reactivate(%FormTemplate{} = template, %User{} = actor) do
    case template
         |> FormTemplate.changeset(%{
           "is_active" => true,
           "updated_by_id" => actor.id,
           "version" => template.version + 1
         })
         |> Repo.update() do
      {:ok, updated} = ok ->
        Broadcasts.entity_changed(
          "form-template",
          updated.uuid,
          updated.company_id,
          "reactivated"
        )

        Publisher.publish_template(updated)
        ok

      error ->
        error
    end
  end

  @doc """
  Every workstation currently assigning this template — returns
  `{workstation, slot}` tuples where `slot` is the trigger the
  template is filling. Powers the "Assigned to" panel on the
  FormBuilder so the operator can see + click-through to the
  workstations that reference this form.
  """
  def workstations_using(%FormTemplate{id: id}) do
    from(a in Backend.Production.WorkstationFormAssignment,
      join: w in Backend.Production.Workstation,
      on: w.id == a.workstation_id,
      where: a.form_template_id == ^id,
      order_by: [asc: w.name, asc: a.sort_order],
      select: {w, a.slot}
    )
    |> Repo.all()
  end

  @doc """
  Mark a template as published as of ``version`` at ``at``. Called
  from the publisher after all assigned workstations have been
  pushed to vita-perf successfully.
  """
  def mark_published(%FormTemplate{} = template, version, %DateTime{} = at) do
    template
    |> Ecto.Changeset.change(%{
      last_published_at: DateTime.truncate(at, :second),
      last_published_version: version
    })
    |> Repo.update()
  end
end
