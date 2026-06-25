defmodule Backend.Repo.Migrations.SeedCustomerReturnNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Default `numbering_formats` entry for customer returns — `RMA00001`.
  """

  def up do
    repo = repo()

    rows = repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "customer_return") do
        merged =
          Map.put(formats, "customer_return", %{
            "prefix" => "RMA",
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

    rows = repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      if Map.has_key?(formats, "customer_return") do
        stripped = Map.delete(formats, "customer_return")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
