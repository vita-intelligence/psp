defmodule Backend.Repo.Migrations.SeedGoodsInInspectionNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Default `goods_in_inspection` numbering format (GI + 5-digit pad)
  for every existing company. Admins can override on /settings/company
  via the standard NUMBERING_ENTITIES picker.
  """

  def up do
    repo = repo()

    rows = repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "goods_in_inspection") do
        merged =
          Map.put(formats, "goods_in_inspection", %{"prefix" => "GI", "padding" => 5})

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

      if Map.has_key?(formats, "goods_in_inspection") do
        stripped = Map.delete(formats, "goods_in_inspection")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
