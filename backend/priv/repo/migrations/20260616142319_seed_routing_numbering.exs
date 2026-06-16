defmodule Backend.Repo.Migrations.SeedRoutingNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Seed every company's `numbering_formats` with a default `R00001`
  entry for routings. Matches the MRPEasy "R02099" style — single
  letter prefix + 5-digit padding.
  """

  def up do
    repo = repo()

    rows =
      repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "routing") do
        merged = Map.put(formats, "routing", %{"prefix" => "R", "padding" => 5})

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

      if Map.has_key?(formats, "routing") do
        stripped = Map.delete(formats, "routing")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
