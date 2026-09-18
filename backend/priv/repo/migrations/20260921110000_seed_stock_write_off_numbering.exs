defmodule Backend.Repo.Migrations.SeedStockWriteOffNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Default `stock_write_off` numbering format (WO + 5-digit pad) for
  every existing company. Admins can override the prefix / padding
  from /settings/company via the standard NUMBERING_ENTITIES picker.
  """

  def up do
    repo = repo()

    rows = repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "stock_write_off") do
        merged =
          Map.put(formats, "stock_write_off", %{"prefix" => "WO", "padding" => 5})

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

      if Map.has_key?(formats, "stock_write_off") do
        stripped = Map.delete(formats, "stock_write_off")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
