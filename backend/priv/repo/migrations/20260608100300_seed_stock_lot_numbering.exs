defmodule Backend.Repo.Migrations.SeedStockLotNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Seed every company's `numbering_formats` JSONB with a default
  `stock_lot` entry (`SL00001`-style). Admins can still customise
  via /settings/company; this just makes sure the first rendered
  code on a brand-new install isn't nil.
  """

  def up do
    repo = repo()

    rows =
      repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "stock_lot") do
        # Prefix "L" matches MRPEasy convention and avoids colliding
        # with "SL" already used by storage_location.
        merged = Map.put(formats, "stock_lot", %{"prefix" => "L", "padding" => 5})
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

      if Map.has_key?(formats, "stock_lot") do
        stripped = Map.delete(formats, "stock_lot")
        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
