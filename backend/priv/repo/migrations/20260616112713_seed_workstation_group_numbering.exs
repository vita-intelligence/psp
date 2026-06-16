defmodule Backend.Repo.Migrations.SeedWorkstationGroupNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Default `numbering_formats` entry for workstation groups —
  `WG00001`. Admins override under /settings/company. Mirrors the
  vendor / stock_lot / bom seeds so the ledger renders a code from
  day one.
  """

  def up do
    repo = repo()

    rows =
      repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "workstation_group") do
        merged =
          Map.put(formats, "workstation_group", %{"prefix" => "WG", "padding" => 5})

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

      if Map.has_key?(formats, "workstation_group") do
        stripped = Map.delete(formats, "workstation_group")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
