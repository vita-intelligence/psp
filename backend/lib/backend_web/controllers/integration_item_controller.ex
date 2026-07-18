defmodule BackendWeb.IntegrationItemController do
  @moduledoc """
  Write-side endpoint for creating catalog Items from an upstream
  R&D system (NPD today). Only `semi_finished` and `finished_product`
  types are creatable through this surface — raw materials, packaging,
  consumables, and equipment stay operator-managed on PSP where the
  compliance sub-tables live.

  Semi-finished items are the anchor for a multi-stage BOM push: a
  capsule product = "Powder Blend" (semi_finished, its own BOM +
  routing) consumed by "Filled Capsules" (semi_finished) consumed by
  the finished-product SKU. NPD auto-creates the intermediate items
  the first time it pushes; subsequent pushes hit the same rows via
  the idempotency key.

  Idempotency: `external_sku` is the natural key. A repeated POST
  with the same `external_sku` returns the existing row (200) instead
  of erroring out. This lets NPD safely retry / re-push without
  duplicate ghost items.

  Payload shape (JSON):

      {
        "name": "Powder Blend — Vitamin C 500mg",
        "item_type": "semi_finished",
        "external_sku": "NPD-STAGE-<formulation_uuid>-1",
        "description": "Stage 1 output of formulation ...",
        "attributes": {}                 // optional
      }

  Returns:

      {"item": {"uuid": "...", "name": "...", "item_type": "...",
                "external_sku": "...", "created": true|false}}

  `created: false` means "an existing row matched your `external_sku`
  — nothing was inserted, here's the pre-existing uuid".
  """

  use BackendWeb, :controller

  import Ecto.Query
  import BackendWeb.IntegrationScopePlug

  alias Backend.Accounts.User
  alias Backend.Items
  alias Backend.Items.Item
  alias Backend.Repo

  # The write surface is intentionally narrow: NPD pushes stage
  # outputs (the semi-finished items each production stage produces)
  # and, optionally, the finished-product SKU when it wasn't
  # pre-created by an operator. Everything else stays out.
  @allowed_types ~w(semi_finished finished_product)

  plug :require_integration_scope, "item:write" when action == :create

  def create(conn, params) do
    company_id = conn.assigns.current_company_id
    token = conn.assigns.current_integration_token

    # Company scope is needed inside ``normalise`` to resolve the
    # UOM + product family UUIDs → local ids. We stash it on the
    # incoming params under a private ``__company_id`` key so the
    # normaliser stays a pure function on its args (no plug-conn
    # dependency) and remains easy to unit-test.
    scoped_params =
      if is_map(params), do: Map.put(params, "__company_id", company_id), else: params

    with {:ok, %User{} = actor} <- fetch_actor(token),
         {:ok, attrs} <- normalise(scoped_params) do
      case existing_by_sku(company_id, attrs["external_sku"]) do
        %Item{} = existing ->
          # Propagate name / description changes on subsequent pushes.
          # NPD lets scientists rename a stage after its PSP item was
          # created; without this branch the PSP item keeps the
          # original name and drifts from what the scientist sees in
          # NPD. Only the two integration-writable fields update — no
          # item_type / external_sku churn, no signal on the item's
          # compliance sub-tables.
          synced = maybe_sync_from_integration(actor, existing, attrs)
          maybe_upsert_finished_product_spec(
            synced,
            Map.get(params, "finished_product_spec"),
            company_id
          )
          maybe_set_allergens(actor, synced, Map.get(params, "allergen_uuids"))

          conn
          |> put_status(:ok)
          |> json(%{item: payload(synced, created: false)})

        nil ->
          case Items.create(actor, company_id, attrs) do
            {:ok, item} ->
              maybe_upsert_finished_product_spec(
                item,
                Map.get(params, "finished_product_spec"),
                company_id
              )
              maybe_set_allergens(
                actor,
                item,
                Map.get(params, "allergen_uuids")
              )

              conn
              |> put_status(:created)
              |> json(%{item: payload(item, created: true)})

            {:error, %Ecto.Changeset{} = cs} ->
              unprocessable(conn, "validation_failed", format_changeset(cs))

            {:error, reason} when is_atom(reason) ->
              unprocessable(conn, to_string(reason), nil)

            {:error, reason} ->
              unprocessable(conn, "unknown_error", inspect(reason))
          end
      end
    else
      {:error, code, detail} -> unprocessable(conn, code, detail)
    end
  end

  # ---- internals ----

  defp fetch_actor(%{created_by_id: nil}), do: {:error, "actor_missing", nil}

  defp fetch_actor(%{created_by_id: id}) do
    case Repo.get(User, id) do
      %User{} = user -> {:ok, user}
      _ -> {:error, "actor_missing", nil}
    end
  end

  defp normalise(params) when is_map(params) do
    with {:ok, name} <- fetch_string(params, "name", "missing name"),
         {:ok, item_type} <- fetch_string(params, "item_type", "missing item_type"),
         :ok <- ensure_allowed_type(item_type),
         {:ok, sku} <- fetch_string(params, "external_sku", "missing external_sku") do
      # Resolve UOM + product family UUIDs → local ids. NPD sends
      # uuids because that's what it fetched from the read-side list
      # endpoints; PSP's ``items`` table stores integer FK ids. On
      # unknown uuids we drop the field so the item still creates
      # (better than 400ing the whole save on a stale picker cache).
      company_id = Map.get(params, "__company_id")

      attrs =
        %{
          "name" => name,
          "item_type" => item_type,
          "external_sku" => sku,
          "description" => Map.get(params, "description"),
          "attributes" => Map.get(params, "attributes") || %{},
          # Barcode is optional and only persisted when a non-empty
          # string comes in — passing an empty string would otherwise
          # clobber a value the operator set on PSP directly.
          "barcode" => normalise_optional_string(Map.get(params, "barcode"))
        }
        |> put_if_resolved(
          "stock_uom_id",
          resolve_uom_id(company_id, Map.get(params, "stock_uom_uuid"))
        )
        |> put_if_resolved(
          "product_family_id",
          resolve_family_id(
            company_id,
            Map.get(params, "product_family_uuid")
          )
        )
        |> maybe_put_storage_tags(Map.get(params, "storage_tags"))
        |> maybe_put_reorder(
          "min_stock_qty",
          Map.get(params, "min_stock_qty")
        )
        |> maybe_put_reorder(
          "target_stock_qty",
          Map.get(params, "target_stock_qty")
        )

      {:ok, attrs}
    end
  end

  defp normalise(_), do: {:error, "invalid_payload", "expected an object"}

  # Storage tags on Item is a ``{:array, :string}``. NPD passes the
  # scientist's picked strings verbatim; blank / nil = leave existing.
  defp maybe_put_storage_tags(map, nil), do: map
  defp maybe_put_storage_tags(map, tags) when is_list(tags) do
    cleaned =
      Enum.flat_map(tags, fn
        v when is_binary(v) ->
          trimmed = String.trim(v)
          if trimmed == "", do: [], else: [trimmed]

        _ ->
          []
      end)

    Map.put(map, "storage_tags", cleaned)
  end
  defp maybe_put_storage_tags(map, _), do: map

  # min / target stock qty — numeric or string, coerced through the
  # changeset. Nil / empty = leave existing.
  defp maybe_put_reorder(map, _key, nil), do: map
  defp maybe_put_reorder(map, _key, ""), do: map
  defp maybe_put_reorder(map, key, value)
       when is_binary(value) or is_number(value) do
    Map.put(map, key, value)
  end
  defp maybe_put_reorder(map, _key, _), do: map

  defp put_if_resolved(map, _key, nil), do: map
  defp put_if_resolved(map, key, value), do: Map.put(map, key, value)

  defp resolve_uom_id(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from u in Backend.Units.UnitOfMeasurement,
            where: u.company_id == ^company_id and u.uuid == ^cast,
            select: u.id,
            limit: 1
        )

      :error ->
        nil
    end
  end

  defp resolve_uom_id(_company_id, _), do: nil

  defp resolve_family_id(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from f in Backend.Catalogs.ProductFamily,
            where: f.company_id == ^company_id and f.uuid == ^cast,
            select: f.id,
            limit: 1
        )

      :error ->
        nil
    end
  end

  defp resolve_family_id(_company_id, _), do: nil

  # Upsert the ``item_finished_product_spec`` sub-table when the
  # caller supplied a ``finished_product_spec`` map. Only applies to
  # finished-product items — semi-finished / raw material items get
  # nil-branched at the guard so the caller can send the same shape
  # for every type without worrying. Silent-degrade: bad payloads
  # get logged + skipped rather than 400ing the whole item write.
  defp maybe_upsert_finished_product_spec(_item, nil, _company_id), do: :ok

  defp maybe_upsert_finished_product_spec(%Backend.Items.Item{item_type: "finished_product"} = item, spec_map, company_id)
       when is_map(spec_map) do
    # UOM UUIDs → local ids. Unknown UUIDs are dropped rather than
    # rejected so a stale picker cache on NPD doesn't fail the save.
    spec_attrs =
      spec_map
      |> maybe_resolve_uom("serving_size_uom_uuid", "serving_size_uom_id", company_id)
      |> maybe_resolve_uom("net_quantity_uom_uuid", "net_quantity_uom_id", company_id)
      |> Map.put("item_id", item.id)

    existing =
      Backend.Repo.get_by(Backend.Items.FinishedProductSpec, item_id: item.id) ||
        %Backend.Items.FinishedProductSpec{item_id: item.id}

    changeset = Backend.Items.FinishedProductSpec.changeset(existing, spec_attrs)

    case Backend.Repo.insert_or_update(changeset) do
      {:ok, _spec} ->
        :ok

      {:error, cs} ->
        require Logger

        Logger.warning(fn ->
          "integration_item: finished_product_spec upsert failed for item #{item.id}: #{inspect(cs.errors)}"
        end)

        :ok
    end
  end

  # Other item types silently skip — semi-finished stages don't
  # need a finished-product spec.
  defp maybe_upsert_finished_product_spec(_item, _spec_map, _company_id), do: :ok

  # Wholesale-replace the item's allergens with the caller's list.
  # ``nil`` = "don't touch"; ``[]`` = "clear every allergen". Both
  # need to be honoured or the FE can never uncheck a mistake. Delegates
  # to ``Backend.RawMaterials.set_allergens/3`` which handles the
  # M:N diff + audit trail.
  defp maybe_set_allergens(_actor, _item, nil), do: :ok

  defp maybe_set_allergens(actor, item, uuids) when is_list(uuids) do
    case Backend.RawMaterials.set_allergens(actor, item, uuids) do
      {:ok, _} ->
        :ok

      other ->
        require Logger

        Logger.warning(fn ->
          "integration_item: set_allergens failed for item #{item.id}: " <>
            inspect(other)
        end)

        :ok
    end
  end

  defp maybe_set_allergens(_actor, _item, _), do: :ok

  defp maybe_resolve_uom(map, uuid_key, id_key, company_id) do
    case Map.get(map, uuid_key) do
      nil ->
        map

      uuid when is_binary(uuid) ->
        case resolve_uom_id(company_id, uuid) do
          nil -> map |> Map.delete(uuid_key)
          id -> map |> Map.delete(uuid_key) |> Map.put(id_key, id)
        end

      _ ->
        map
    end
  end

  # Trim + collapse whitespace-only strings to nil so downstream
  # Ecto changeset treats "no value" and "empty string" the same way.
  defp normalise_optional_string(v) when is_binary(v) do
    trimmed = String.trim(v)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalise_optional_string(_), do: nil

  defp fetch_string(map, key, missing_msg) do
    case Map.get(map, key) do
      v when is_binary(v) ->
        trimmed = String.trim(v)
        if trimmed == "",
          do: {:error, "invalid_payload", missing_msg},
          else: {:ok, trimmed}

      _ ->
        {:error, "invalid_payload", missing_msg}
    end
  end

  defp ensure_allowed_type(type) when type in @allowed_types, do: :ok

  defp ensure_allowed_type(type),
    do: {:error, "item_type_not_allowed",
         "only #{Enum.join(@allowed_types, ", ")} may be created via integration (got #{inspect(type)})"}

  defp existing_by_sku(company_id, sku) do
    Repo.one(
      from i in Item,
        where:
          i.company_id == ^company_id and i.external_sku == ^sku and
            i.is_active == true,
        limit: 1
    )
  end

  # Update just the fields the integration wire actually owns
  # (``name`` + ``description``). Item type + sku are load-bearing
  # identity so they never mutate here — a scientist can't rename a
  # semi-finished into a packaging by editing the stage name. If
  # nothing has changed we skip the write entirely so audit rows only
  # appear on real renames.
  defp maybe_sync_from_integration(actor, %Item{} = item, attrs) do
    incoming_name = attrs["name"]
    incoming_description = attrs["description"] || ""
    current_description = item.description || ""
    incoming_attributes = attrs["attributes"] || %{}
    current_attributes = item.attributes || %{}
    incoming_barcode = attrs["barcode"]
    incoming_uom_id = Map.get(attrs, "stock_uom_id")
    incoming_family_id = Map.get(attrs, "product_family_id")

    # Barcode / UOM / family overrides only fire when the caller sent
    # a resolved value. Missing = "leave the existing PSP value
    # alone" — the integration push isn't authoritative for these
    # fields; PSP operators can set them by hand too, and we don't
    # want an NPD save to wipe that.
    name_changed = item.name != incoming_name
    description_changed = current_description != incoming_description
    attributes_changed = current_attributes != incoming_attributes
    barcode_changed =
      not is_nil(incoming_barcode) and (item.barcode || "") != incoming_barcode
    uom_changed =
      not is_nil(incoming_uom_id) and item.stock_uom_id != incoming_uom_id
    family_changed =
      not is_nil(incoming_family_id) and
        item.product_family_id != incoming_family_id

    if not (name_changed or description_changed or attributes_changed or
              barcode_changed or uom_changed or family_changed) do
      item
    else
      update_params =
        %{
          "name" => incoming_name,
          "description" => incoming_description,
          "attributes" => incoming_attributes
        }
        |> then(fn m ->
          if barcode_changed, do: Map.put(m, "barcode", incoming_barcode), else: m
        end)
        |> then(fn m ->
          if uom_changed, do: Map.put(m, "stock_uom_id", incoming_uom_id), else: m
        end)
        |> then(fn m ->
          if family_changed,
            do: Map.put(m, "product_family_id", incoming_family_id),
            else: m
        end)

      case Backend.Items.update(actor, item, update_params) do
        {:ok, updated} -> updated
        # Silent-degrade: if the update fails (e.g. a name collision
        # on a company's unique constraint), keep the stale row so
        # the push cascade can still finish. The scientist can rename
        # by hand in PSP if it matters.
        _ -> item
      end
    end
  end

  defp payload(%Item{} = item, created: created?) do
    %{
      uuid: item.uuid,
      name: item.name,
      item_type: item.item_type,
      external_sku: item.external_sku,
      description: item.description,
      is_active: item.is_active,
      created: created?
    }
  end

  defp format_changeset(%Ecto.Changeset{errors: errors}) do
    errors
    |> Enum.map(fn {field, {msg, _}} -> "#{field}: #{msg}" end)
    |> Enum.join("; ")
  end

  defp unprocessable(conn, code, detail) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{error: code, detail: detail})
  end
end
