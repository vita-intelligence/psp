defmodule Backend.Repo.Migrations.SeedVendorNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Default `numbering_formats` entry for vendors — `VN00001`. Admins
  can override under /settings/company.
  """

  def up do
    repo = repo()

    rows =
      repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "vendor") do
        merged = Map.put(formats, "vendor", %{"prefix" => "VN", "padding" => 5})

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

      if Map.has_key?(formats, "vendor") do
        stripped = Map.delete(formats, "vendor")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
