defmodule Backend.Repo.Migrations.SeedWorkstationNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Seed every company's `numbering_formats` with a default `WS00001`
  entry for workstations. Same shape as the vendor / bom / wg seeds.
  """

  def up do
    repo = repo()

    rows =
      repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "workstation") do
        merged = Map.put(formats, "workstation", %{"prefix" => "WS", "padding" => 5})

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

      if Map.has_key?(formats, "workstation") do
        stripped = Map.delete(formats, "workstation")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
