defmodule Backend.Repo.Migrations.SeedReturnInspectionNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Default `return_inspection` numbering format (RI + 5-digit pad)
  for every existing company. Admins can override on
  /settings/company via the standard NUMBERING_ENTITIES picker.
  """

  def up do
    repo = repo()

    rows = repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "return_inspection") do
        merged =
          Map.put(formats, "return_inspection", %{"prefix" => "RI", "padding" => 5})

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: merged]
        )
      end
    end)
  end

  def down do
    repo = repo()

    rows = repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      if Map.has_key?(formats, "return_inspection") do
        stripped = Map.delete(formats, "return_inspection")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
