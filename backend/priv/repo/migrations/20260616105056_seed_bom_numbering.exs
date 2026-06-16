defmodule Backend.Repo.Migrations.SeedBomNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Default `numbering_formats` entry for BOMs — `BOM00001`. Admins
  override under /settings/company. Mirrors the seed pattern used
  for vendor / stock_lot / goods_in_inspection so the BOM detail
  page renders a code from day one instead of falling back to the
  raw integer id.
  """

  def up do
    repo = repo()

    rows =
      repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "bom") do
        merged = Map.put(formats, "bom", %{"prefix" => "BOM", "padding" => 5})

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: merged]
        )
      end
    end)
  end

  def down do
    repo = repo()

    rows =
      repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      if Map.has_key?(formats, "bom") do
        stripped = Map.delete(formats, "bom")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
