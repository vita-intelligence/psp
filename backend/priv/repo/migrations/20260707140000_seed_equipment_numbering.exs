defmodule Backend.Repo.Migrations.SeedEquipmentNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Default `numbering_formats` entry for equipment — `EQ00001`. Admins
  can override under /settings/company. Mirrors the seed pattern for
  bom / vendor / stock_lot / goods_in_inspection so the equipment
  ledger + detail pages render a code from day one instead of
  falling back to the raw integer id.
  """

  def up do
    repo = repo()

    rows =
      repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "equipment") do
        merged = Map.put(formats, "equipment", %{"prefix" => "EQ", "padding" => 5})

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

      if Map.has_key?(formats, "equipment") do
        stripped = Map.delete(formats, "equipment")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
