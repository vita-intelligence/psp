defmodule Backend.Equipment.Categories do
  @moduledoc """
  Boundary for equipment-category CRUD. Categories are tenant-
  scoped and unique-named per tenant. Inactive categories still
  render on existing equipment (via the FK) but are hidden from
  new-equipment pickers.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Equipment.{Category, CategoryFormAssignment, Equipment}
  alias Backend.Forms.FormTemplate
  alias Backend.Repo

  def list_for_company(company_id) when is_integer(company_id) do
    Category
    |> where([c], c.company_id == ^company_id)
    |> order_by([c], desc: c.is_active, asc: :name)
    |> Repo.all()
  end

  def list_active_for_company(company_id) when is_integer(company_id) do
    Category
    |> where([c], c.company_id == ^company_id and c.is_active == true)
    |> order_by([c], asc: :name)
    |> Repo.all()
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Category
        |> where([c], c.company_id == ^company_id and c.uuid == ^cast)
        |> Repo.one()

      _ ->
        nil
    end
  end

  def create(company_id, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.put("company_id", company_id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)

    %Category{}
    |> Category.changeset(attrs)
    |> Repo.insert()
  end

  def update(%Category{} = cat, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.drop(["company_id", "created_by_id"])
      |> Map.put("updated_by_id", actor.id)

    cat
    |> Category.changeset(attrs)
    |> Repo.update()
  end

  def deactivate(%Category{} = cat, %User{} = actor) do
    cat
    |> Category.changeset(%{"is_active" => false, "updated_by_id" => actor.id})
    |> Repo.update()
  end

  # ── Form assignments ─────────────────────────────────────────────

  @doc """
  List form assignments on one equipment category, preloaded with
  the template so payload builders can render the form name +
  version without a second fetch.
  """
  def list_form_assignments(%Category{} = cat) do
    Repo.all(
      from a in CategoryFormAssignment,
        where: a.equipment_category_id == ^cat.id,
        order_by: [asc: a.slot, asc: a.sort_order, asc: a.id],
        preload: [:form_template]
    )
  end

  @doc """
  Bulk-overwrite the form assignments on one category. Payload
  shape (per assignment):

      %{
        "form_template_uuid" => "<uuid>",
        "slot" => "equipment_cleaning" | "equipment_maintenance",
        "sort_order" => 0
      }

  Missing entries = detached. Same all-or-nothing atomicity as
  ``Backend.Production.update_workstation`` uses for its own
  form-assignments patch. On success re-publishes every workstation
  that carries equipment in this category, so the kiosk mirror
  refreshes.
  """
  def replace_form_assignments(%Category{} = cat, entries, %User{} = _actor)
      when is_list(entries) do
    templates_by_uuid = load_templates_by_uuid(cat.company_id, entries)

    with :ok <- ensure_all_templates_resolved(entries, templates_by_uuid),
         {:ok, _} <-
           Repo.transaction(fn ->
             from(a in CategoryFormAssignment,
               where: a.equipment_category_id == ^cat.id
             )
             |> Repo.delete_all()

             entries
             |> Enum.with_index()
             |> Enum.each(fn {entry, idx} ->
               tpl_uuid = Map.get(entry, "form_template_uuid") || Map.get(entry, :form_template_uuid)
               slot = Map.get(entry, "slot") || Map.get(entry, :slot)

               sort_order =
                 case Map.get(entry, "sort_order") || Map.get(entry, :sort_order) do
                   n when is_integer(n) -> n
                   _ -> idx
                 end

               tpl = Map.fetch!(templates_by_uuid, tpl_uuid)

               %CategoryFormAssignment{}
               |> CategoryFormAssignment.changeset(%{
                 "company_id" => cat.company_id,
                 "equipment_category_id" => cat.id,
                 "form_template_id" => tpl.id,
                 "slot" => slot,
                 "sort_order" => sort_order
               })
               |> Repo.insert!()
             end)

             :ok
           end) do
      republish_workstations_with_this_category(cat)
      {:ok, list_form_assignments(cat)}
    else
      {:error, :template_not_found, uuid} ->
        {:error, :template_not_found, uuid}

      other ->
        other
    end
  end

  defp load_templates_by_uuid(company_id, entries) do
    uuids =
      entries
      |> Enum.map(fn e -> Map.get(e, "form_template_uuid") || Map.get(e, :form_template_uuid) end)
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    if uuids == [] do
      %{}
    else
      Repo.all(
        from t in FormTemplate,
          where: t.company_id == ^company_id and t.uuid in ^uuids
      )
      |> Enum.into(%{}, fn t -> {t.uuid, t} end)
    end
  end

  defp ensure_all_templates_resolved(entries, by_uuid) do
    entries
    |> Enum.map(fn e -> Map.get(e, "form_template_uuid") || Map.get(e, :form_template_uuid) end)
    |> Enum.find(fn uuid -> not Map.has_key?(by_uuid, uuid) end)
    |> case do
      nil -> :ok
      missing -> {:error, :template_not_found, missing}
    end
  end

  # Re-publish every workstation that carries equipment in this
  # category so the vita-perf kiosk mirror gets fresh forms. Silent-
  # degrade — the publisher logs its own errors.
  defp republish_workstations_with_this_category(%Category{id: cat_id}) do
    workstation_ids =
      Repo.all(
        from e in Equipment,
          where: e.category_id == ^cat_id and not is_nil(e.workstation_id),
          distinct: true,
          select: e.workstation_id
      )

    Enum.each(workstation_ids, fn ws_id ->
      case Repo.get(Backend.Production.Workstation, ws_id) do
        nil ->
          :ok

        ws ->
          # Forms publish: pushes both the workstation's own forms
          # AND the equipment-scoped forms for every attached
          # machine (see Forms.Publisher.do_publish_workstation).
          Backend.Forms.Publisher.publish_workstation(ws)

          # Roster sync: keeps the vp WorkstationEquipment mirror
          # fresh so the kiosk equipment picker renders the right
          # set of machines.
          Backend.Production.WorkstationEquipmentPublisher.publish_workstation(ws)
      end
    end)

    :ok
  end
end
