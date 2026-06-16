defmodule Backend.Numbering do
  @moduledoc """
  Render a display code for any numbered entity on the fly:

      Numbering.render(template.id, company, "template")
      # → "PT00007"

  No code is stored on the row — the integer PK is the canonical
  sequence and the prefix/padding live in `companies.numbering_formats`.
  Changing the format is a single JSONB write that takes immediate
  effect across every payload, with no row rewrites.

  Sorting by display code is equivalent to sorting by PK id (given
  the same prefix + padding), so contexts translate `:code` sort
  requests to `:id` before hitting Ecto.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Catalogs.{AttributeDefinition, ProductFamily}
  alias Backend.Certificates.Certificate
  alias Backend.Companies.Company
  alias Backend.Devices.LinkedDevice
  alias Backend.GoodsIn.Inspection, as: GoodsInInspection
  alias Backend.Items.Item
  alias Backend.Production.BOM
  alias Backend.Production.{Workstation, WorkstationGroup}
  alias Backend.RBAC.Role
  alias Backend.Repo
  alias Backend.Purchasing.PurchaseOrder
  alias Backend.Stock.Lot, as: StockLot
  alias Backend.Units.UnitOfMeasurement
  alias Backend.Vendors.Vendor
  alias Backend.Warehouses.{Floor, StorageCell, StorageLocation, StorageTag, Warehouse}

  @entity_schemas %{
    "warehouse" => Warehouse,
    "user" => User,
    "template" => Role,
    "floor" => Floor,
    "storage_location" => StorageLocation,
    "storage_cell" => StorageCell,
    "storage_tag" => StorageTag,
    "unit_of_measurement" => UnitOfMeasurement,
    "item" => Item,
    "product_family" => ProductFamily,
    "attribute_definition" => AttributeDefinition,
    "certificate" => Certificate,
    "stock_lot" => StockLot,
    "linked_device" => LinkedDevice,
    "vendor" => Vendor,
    "purchase_order" => PurchaseOrder,
    "goods_in_inspection" => GoodsInInspection,
    "bom" => BOM,
    "workstation_group" => WorkstationGroup,
    "workstation" => Workstation
  }

  @default_padding 5

  @doc "Map of entity-key → Ecto schema for callers that need to iterate."
  def entity_schemas, do: @entity_schemas

  @doc "Default zero-padding when the company hasn't configured one."
  def default_padding, do: @default_padding

  @doc """
  Render the display code for `id` under the given `company` and
  `entity_key`. Returns `nil` when no format is configured for that
  entity (the FE renders `—` for nil) — same behaviour as before so
  legacy payloads stay graceful.

      Numbering.render(7, company, "template")  # → "PT00007"
      Numbering.render(7, company, "unknown")   # → nil
  """
  def render(id, %Company{} = company, entity_key)
      when is_integer(id) and is_binary(entity_key) do
    case get_format(company, entity_key) do
      %{} = format ->
        case fetch_prefix(format) do
          {:ok, prefix} ->
            padding = fetch_padding(format)
            prefix <> String.pad_leading(Integer.to_string(id), padding, "0")

          :error ->
            nil
        end

      _ ->
        nil
    end
  end

  def render(_id, _company, _entity_key), do: nil

  @doc """
  Parse a search string that looks like a rendered code (`PT00007`)
  back into the underlying integer id, scoped to the given entity's
  format. Returns the id or `nil` if the string doesn't match the
  current prefix.

  Used by list contexts to support "search by code" on a column
  that isn't really stored.
  """
  def parse_search(search, %Company{} = company, entity_key)
      when is_binary(search) and is_binary(entity_key) do
    case get_format(company, entity_key) do
      %{} = format ->
        case fetch_prefix(format) do
          {:ok, prefix} ->
            pattern = ~r/^#{Regex.escape(prefix)}0*(\d+)$/i

            case Regex.run(pattern, String.trim(search)) do
              [_, digits] -> String.to_integer(digits)
              _ -> nil
            end

          :error ->
            nil
        end

      _ ->
        nil
    end
  end

  def parse_search(_search, _company, _entity_key), do: nil

  @doc """
  Legacy code generator — kept for entities that still **store** their
  code on the row (floor, storage_location, storage_cell). New entities
  should use `render/3` instead of stamping a column.

  Counts existing rows for the company and formats `prefix + lpad(n+1)`.
  Caller is expected to retry on unique-constraint collision (same
  contract as before).
  """
  def next_code(%Company{} = company, entity_key) when is_binary(entity_key) do
    with %{} = format <- get_format(company, entity_key),
         {:ok, prefix} <- fetch_prefix(format),
         padding <- fetch_padding(format),
         schema when not is_nil(schema) <- @entity_schemas[entity_key] do
      n =
        schema
        |> where([s], s.company_id == ^company.id)
        |> Repo.aggregate(:count, :id)
        |> Kernel.+(1)

      prefix <> String.pad_leading(Integer.to_string(n), padding, "0")
    else
      _ -> nil
    end
  end

  def next_code(_company, _entity_key), do: nil

  ## ------------------------------------------------------------------

  defp get_format(%Company{numbering_formats: nil}, _), do: nil

  defp get_format(%Company{numbering_formats: formats}, key)
       when is_map(formats),
       do: formats[key]

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
end
