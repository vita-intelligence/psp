defmodule Backend.Forms.Resolver do
  @moduledoc """
  Expand a PSP `form_template` into the flat `FormField[]` shape that
  vita-performance's `DynamicForm.schema` column expects.

  For non-cleaning triggers this is a passthrough — top-level fields
  render as-is. For cleaning triggers with an assigned workstation,
  `per_equipment_fields` is inserted once per attached piece with:

    * a ``header`` block naming the equipment (e.g. "Mettler PM-2100 · MET-001")
    * copies of every field in ``per_equipment_fields`` with ids
      rewritten as ``<original_id>__<equipment_uuid>`` so answers on
      the kiosk map back to the correct piece.

  The equipment list is filtered to "attached and live" — anything
  ``retired`` / ``disposed`` / ``canceled`` / still ``expected`` is
  skipped. Ordering is deterministic (by serial_number) so the same
  template + workstation always resolves to the same JSON.
  """

  alias Backend.Equipment.Equipment
  alias Backend.Forms.FormTemplate
  alias Backend.Production.Workstation
  alias Backend.Repo

  @live_statuses ~w(received in_service)

  @type resolved_field :: %{required(String.t()) => term()}

  @doc """
  Return the resolved flat field list for a template + optional
  workstation context. Workstation `nil` short-circuits the
  cleaning expansion (returns just the top-level fields) — the
  publisher passes a workstation whenever it has one.
  """
  @spec resolve(FormTemplate.t(), Workstation.t() | nil) :: [resolved_field()]
  def resolve(%FormTemplate{trigger: trigger, schema: schema}, workstation \\ nil) do
    top = top_level_fields(schema)

    case {trigger, workstation} do
      {"cleaning", %Workstation{} = ws} ->
        top ++ per_equipment_expansion(schema, ws)

      _ ->
        top
    end
  end

  @doc """
  Convenience — preloads the equipment association on a workstation
  before resolving. Used by the publisher when it starts from a bare
  workstation row loaded through a lightweight query.
  """
  @spec resolve_with_preload(FormTemplate.t(), Workstation.t()) :: [resolved_field()]
  def resolve_with_preload(%FormTemplate{} = template, %Workstation{} = ws) do
    ws = Repo.preload(ws, equipment: :item)
    resolve(template, ws)
  end

  # ── internals ────────────────────────────────────────────────────

  defp top_level_fields(schema) do
    schema
    |> Map.get("fields", [])
    |> List.wrap()
    |> Enum.filter(&is_map/1)
  end

  defp per_equipment_template(schema) do
    schema
    |> Map.get("per_equipment_fields")
    |> case do
      nil -> []
      list when is_list(list) -> Enum.filter(list, &is_map/1)
      _ -> []
    end
  end

  defp per_equipment_expansion(schema, %Workstation{} = ws) do
    template_fields = per_equipment_template(schema)

    with true <- template_fields != [],
         equipment when equipment != [] <- attached_equipment(ws) do
      Enum.flat_map(equipment, fn eq ->
        [equipment_header(eq) | Enum.map(template_fields, &scope_field(&1, eq))]
      end)
    else
      _ -> []
    end
  end

  defp attached_equipment(%Workstation{equipment: %Ecto.Association.NotLoaded{}}), do: []

  defp attached_equipment(%Workstation{equipment: equipment}) when is_list(equipment) do
    equipment
    |> Enum.filter(&live?/1)
    |> Enum.sort_by(&sort_key/1)
  end

  defp attached_equipment(_), do: []

  defp live?(%Equipment{status: status}), do: status in @live_statuses
  defp live?(_), do: false

  defp sort_key(%Equipment{serial_number: serial}) when is_binary(serial), do: serial
  defp sort_key(%Equipment{id: id}), do: "~zzz~#{id}"

  defp equipment_header(%Equipment{} = eq) do
    %{
      "id" => "hdr__#{eq.uuid}",
      "type" => "header",
      "label" => equipment_label(eq),
      "required" => false
    }
  end

  # ``item`` is preloaded in the common case but we don't crash if it
  # isn't — fall back to manufacturer/model/serial.
  defp equipment_label(%Equipment{} = eq) do
    parts =
      [
        item_name(eq),
        eq.manufacturer,
        eq.model,
        eq.serial_number
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.uniq()

    case parts do
      [] -> "Equipment ##{eq.id}"
      parts -> Enum.join(parts, " · ")
    end
  end

  defp item_name(%Equipment{item: %{name: name}}) when is_binary(name), do: name
  defp item_name(_), do: nil

  # Rewrite field ids to a per-equipment namespace so kiosk answers
  # collide by design: ``notes`` becomes ``notes__<uuid>``. Options
  # keep their ids untouched — response keys are keyed on FIELD id,
  # not option id.
  defp scope_field(field, %Equipment{uuid: eq_uuid}) do
    Map.update(field, "id", "field__#{eq_uuid}", fn base ->
      "#{base}__#{eq_uuid}"
    end)
  end
end
