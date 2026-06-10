defmodule Backend.Repo.Migrations.SeedLinkedDeviceNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Seed every company's `numbering_formats` with a default `linked_device`
  entry (`DEV00001`-style). Operators rarely cite a device by code, but
  the numbering registry is the single source of truth so admins can
  override under /settings/company without code changes.
  """

  def up do
    repo = repo()

    rows =
      repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      unless Map.has_key?(formats, "linked_device") do
        merged =
          Map.put(formats, "linked_device", %{"prefix" => "DEV", "padding" => 5})

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

      if Map.has_key?(formats, "linked_device") do
        stripped = Map.delete(formats, "linked_device")

        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
