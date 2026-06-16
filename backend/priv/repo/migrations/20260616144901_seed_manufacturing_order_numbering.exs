defmodule Backend.Repo.Migrations.SeedManufacturingOrderNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Seed default `MO00001` numbering format for manufacturing orders.
  """

  def up do
    repo = repo()

    rows =
      repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "manufacturing_order") do
        merged =
          Map.put(formats, "manufacturing_order", %{
            "prefix" => "MO",
            "padding" => 5
          })

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

      if Map.has_key?(formats, "manufacturing_order") do
        stripped = Map.delete(formats, "manufacturing_order")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
