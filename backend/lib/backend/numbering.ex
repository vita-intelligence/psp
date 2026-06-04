defmodule Backend.Numbering do
  @moduledoc """
  Generate human-friendly codes for DB-backed entities using the
  per-entity format the company stored in `companies.numbering_formats`.

  Read the prefix + padding, count existing rows of that entity for
  the same company, format as `<PREFIX><zero-padded number>`.

  Concurrency: there's a `(warehouse_id, code)` unique constraint on
  storage_locations and similar elsewhere — if two concurrent inserts
  race on the same sequence number, Postgres rejects the second. The
  caller is expected to catch `:storage_locations_warehouse_id_code_index`
  conflicts and retry with `next_code/3` once; that's enough at the
  scale we operate at and avoids a separate `numbering_sequences`
  table for the MVP.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.RBAC.Role
  alias Backend.Repo
  alias Backend.Warehouses.{Floor, StorageCell, StorageLocation, StorageTag, Warehouse}

  @entity_schemas %{
    "warehouse" => Warehouse,
    "user" => User,
    "template" => Role,
    "floor" => Floor,
    "storage_location" => StorageLocation,
    "storage_cell" => StorageCell,
    "storage_tag" => StorageTag
  }

  @default_padding 5

  @doc "Public read of the entity-key → schema map, for callers that need to iterate all numbered entities (e.g. the re-stamp routine after a prefix change)."
  def entity_schemas, do: @entity_schemas

  @doc "Default zero-padding used when the company hasn't configured one."
  def default_padding, do: @default_padding

  @doc """
  Return the next code string for `entity_key` in the given company,
  or `nil` if no numbering format is configured (operator is expected
  to type a code by hand in that case).

      next_code(company, "storage_location")
      # → "SL00012"
  """
  def next_code(%Company{} = company, entity_key) when is_binary(entity_key) do
    with %{} = format <- get_format(company, entity_key),
         {:ok, prefix} <- fetch_prefix(format),
         padding <- fetch_padding(format),
         schema when not is_nil(schema) <- @entity_schemas[entity_key] do
      n = next_sequence(schema, company.id)
      prefix <> String.pad_leading(Integer.to_string(n), padding, "0")
    else
      _ -> nil
    end
  end

  def next_code(_company, _entity_key), do: nil

  ## ------------------------------------------------------------------

  defp get_format(%Company{numbering_formats: nil}, _), do: nil

  defp get_format(%Company{numbering_formats: formats}, key)
       when is_map(formats) do
    formats[key]
  end

  defp fetch_prefix(%{} = format) do
    case format["prefix"] || format[:prefix] do
      p when is_binary(p) and p != "" -> {:ok, p}
      _ -> :error
    end
  end

  defp fetch_padding(%{} = format) do
    case format["padding"] || format[:padding] do
      n when is_integer(n) and n > 0 -> n
      _ -> @default_padding
    end
  end

  # `+1` because we're returning the NEXT sequence number, not the
  # current count. Race-tolerant via the unique index on the caller's
  # table — see module doc.
  defp next_sequence(schema, company_id) do
    schema
    |> where([s], s.company_id == ^company_id)
    |> Repo.aggregate(:count, :id)
    |> Kernel.+(1)
  end
end
