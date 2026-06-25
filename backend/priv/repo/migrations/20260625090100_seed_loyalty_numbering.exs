defmodule Backend.Repo.Migrations.SeedLoyaltyNumbering do
  use Ecto.Migration
  import Ecto.Query

  @moduledoc """
  Default numbering for loyalty entities:
    * `loyalty_program` → `LP00001`
    * `customer_credit` → `CRD00001`
  """

  @entries [
    {"loyalty_program", %{"prefix" => "LP", "padding" => 5}},
    {"customer_credit", %{"prefix" => "CRD", "padding" => 5}}
  ]

  def up do
    repo = repo()

    rows = repo.all(from(c in "companies", select: {c.id, c.numbering_formats}))

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}

      merged =
        Enum.reduce(@entries, formats, fn {key, value}, acc ->
          if Map.has_key?(acc, key), do: acc, else: Map.put(acc, key, value)
        end)

      if merged != formats do
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

    keys = Enum.map(@entries, fn {k, _} -> k end)

    Enum.each(rows, fn {id, formats} ->
      formats = formats || %{}
      stripped = Enum.reduce(keys, formats, &Map.delete(&2, &1))

      if stripped != formats do
        repo.update_all(
          from(c in "companies", where: c.id == ^id),
          set: [numbering_formats: stripped]
        )
      end
    end)
  end
end
