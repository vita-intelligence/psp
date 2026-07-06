defmodule Backend.Items do
  @moduledoc """
  Boundary for stock items. Read paths return a single row plus its
  type-specific compliance subtable (added in Slices 2-4) when
  preloaded. Mutations validate `attributes` against the company's
  AttributeDefinitions for the item's type before insert/update.

  Per-type subtables and certificate attachments are managed by
  sibling contexts (RawMaterials, FinishedProducts, Packaging,
  Certificates) so a single item edit can compose them in a
  transaction without each context knowing about the others.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Catalogs
  alias Backend.Catalogs.AttributeDefinition
  alias Backend.Catalogs.ProductFamily
  alias Backend.Items.{Item, ItemFile}
  alias Backend.ListQueries
  alias Backend.Repo

  @audit_fields ~w(name description item_type external_sku barcode stock_uom_id product_family_id attributes storage_tags is_active)a
  @sortable_fields ~w(id name item_type external_sku barcode is_active
                      compliance_status stock_uom_id product_family_id
                      inserted_at updated_at)a
  @search_fields ~w(name external_sku barcode description)a
  @default_sort {:name, :asc}

  # ----- read ------------------------------------------------------

  def list_page(company_id, opts \\ []) do
    sort = normalise_sort(Keyword.get(opts, :sort, @default_sort))
    type_filter = opts[:item_type]

    # `product_family` is a joined column — peel it off before the
    # generic column-filter helper.
    {family_needle, column_filter} =
      ListQueries.pop_joined_text_filter(opts[:column_filter], "product_family")

    base =
      Item
      |> where([i], i.company_id == ^company_id)
      |> maybe_type_filter(type_filter)
      |> apply_item_search(company_id, opts[:search])
      |> maybe_product_family_filter(family_needle)
      |> ListQueries.apply_column_filters(column_filter, @sortable_fields)
      |> ListQueries.apply_sort(sort, @sortable_fields, @default_sort)
      |> preload([:stock_uom, :product_family, :created_by, :updated_by])

    ListQueries.paginate(Repo, base, sort, opts[:limit], opts[:cursor])
  end

  defp maybe_product_family_filter(query, nil), do: query

  defp maybe_product_family_filter(query, needle) when is_binary(needle) do
    like = "%" <> ListQueries.escape_like(needle) <> "%"

    from i in query,
      join: pf in ProductFamily,
      on: pf.id == i.product_family_id,
      where: ilike(pf.name, ^like)
  end

  # The DataTable search bar is a single field. Operators type whatever
  # they're staring at — name, SKU, barcode, or the rendered code chip
  # in the row (e.g. "MA00070"). The standard column ilike scan doesn't
  # catch the code because the code is computed from id + numbering
  # format, not stored as a column. Mirror the stock-lot pattern:
  # OR a parse-as-code branch onto the regular column scan.
  defp apply_item_search(query, _company_id, nil), do: query
  defp apply_item_search(query, _company_id, ""), do: query

  defp apply_item_search(query, company_id, term) when is_binary(term) do
    trimmed = String.trim(term)

    case trimmed do
      "" ->
        query

      _ ->
        needle = "%" <> escape_like(trimmed) <> "%"
        id_from_code = parse_item_code(company_id, trimmed)

        from i in query,
          where:
            ilike(i.name, ^needle) or
              ilike(i.external_sku, ^needle) or
              ilike(i.barcode, ^needle) or
              ilike(i.description, ^needle) or
              (^id_from_code != 0 and i.id == ^id_from_code)
    end
  end

  defp parse_item_code(company_id, term) do
    case Repo.get(Backend.Companies.Company, company_id) do
      nil ->
        0

      company ->
        case Backend.Numbering.parse_search(term, company, "item") do
          nil -> 0
          id when is_integer(id) -> id
        end
    end
  end

  defp escape_like(s),
    do: s |> String.replace("\\", "\\\\") |> String.replace("%", "\\%") |> String.replace("_", "\\_")

  defp maybe_type_filter(query, nil), do: query
  defp maybe_type_filter(query, ""), do: query

  defp maybe_type_filter(query, type) when is_binary(type) do
    # Support `?item_type=finished_product,semi_finished` so the BOM
    # picker can ask for all bommable types in a single round-trip.
    # Single-value calls still work — splitting a string with no
    # commas returns a one-element list.
    case String.split(type, ",", trim: true) |> Enum.map(&String.trim/1) do
      [] ->
        query

      [single] ->
        where(query, [i], i.item_type == ^single)

      list ->
        where(query, [i], i.item_type in ^list)
    end
  end

  defp maybe_type_filter(query, list) when is_list(list) do
    case Enum.reject(list, &(&1 in [nil, ""])) do
      [] -> query
      [single] -> where(query, [i], i.item_type == ^single)
      more -> where(query, [i], i.item_type in ^more)
    end
  end

  defp normalise_sort({:code, dir}), do: {:id, dir}
  defp normalise_sort(other), do: other

  def list_config do
    %{
      sortable_fields: Enum.map(@sortable_fields, &Atom.to_string/1),
      search_fields: Enum.map(@search_fields, &Atom.to_string/1),
      default_sort: %{
        field: Atom.to_string(elem(@default_sort, 0)),
        direction: Atom.to_string(elem(@default_sort, 1))
      }
    }
  end

  def get_for_company(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(i in Item,
            where: i.company_id == ^company_id and i.uuid == ^cast,
            preload: [:stock_uom, :product_family, :created_by, :updated_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_company(_company_id, _), do: nil

  @doc """
  Show variant that preloads the per-type compliance subtable +
  allergens. Used by the items show endpoint so the FE form renders
  the right sub-form on first paint. List endpoints stick with the
  lean variant above.
  """
  def get_for_company_full(company_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(i in Item,
            where: i.company_id == ^company_id and i.uuid == ^cast,
            preload: [
              :stock_uom,
              :product_family,
              :created_by,
              :updated_by,
              :compliance_readied_by,
              raw_material_compliance: [:last_reviewed_by, :spec_document_file],
              raw_material_risk: [:assessed_by],
              finished_product_spec: [
                :serving_size_uom,
                :net_quantity_uom,
                :may_contain_assessed_by,
                :spec_document_file
              ],
              packaging_compliance: [
                :food_contact_declaration_file,
                :migration_test_file
              ],
              certificate_attachments: [:certificate, :uploaded_by],
              images: ^from(im in Backend.Items.ItemImage,
                order_by: [desc: im.is_primary, asc: im.sort_order, asc: im.inserted_at],
                preload: [:uploaded_by]
              ),
              files: ^from(f in ItemFile,
                order_by: [desc: f.inserted_at],
                preload: [:uploaded_by]
              ),
              allergens: ^from(a in Backend.Allergens.Allergen, order_by: [asc: a.sort_order])
            ]
          )
        )

      :error ->
        nil
    end
  end

  def get_for_company_full(_company_id, _), do: nil

  # ----- mutation --------------------------------------------------

  def create(%User{} = actor, company_id, attrs) do
    attrs = attrs |> stringify_keys()

    with {:ok, validated_attrs} <-
           validate_attributes(company_id, attrs["item_type"], attrs["attributes"]) do
      payload =
        attrs
        |> Map.put("attributes", validated_attrs)
        |> Map.merge(%{
          "company_id" => company_id,
          "created_by_id" => actor.id,
          "updated_by_id" => actor.id
        })

      %Item{}
      |> Item.changeset(payload)
      |> Repo.insert()
      |> after_create(actor)
    end
  end

  def update(%User{} = actor, %Item{} = item, attrs) do
    before_state = snapshot(item)
    attrs = stringify_keys(attrs)
    # Caller may not be allowed to change item_type — defer to the
    # changeset to enforce. For attribute validation, look up the
    # *new* type from attrs (fallback to current) so a freshly-typed
    # item validates against the right scope.
    effective_type = attrs["item_type"] || item.item_type

    with {:ok, validated_attrs} <-
           validate_attributes(item.company_id, effective_type, attrs["attributes"]) do
      payload =
        attrs
        |> Map.put("updated_by_id", actor.id)
        |> maybe_put("attributes", validated_attrs)

      item
      |> Item.changeset(payload)
      |> Repo.update()
      |> after_update(actor, before_state)
    end
  end

  @doc """
  Atomic mega-save. Accepts a nested payload describing the item
  identity + the per-type compliance subtable that applies, persists
  everything in one transaction.

  Returns `{:ok, reloaded_item}` on success — reloaded with every
  preloaded sub-table so the FE can re-seed cleanly.

  Field errors come back as `{:error, %{section, changeset}}` so the
  FE can route each error to the right field group.
  """
  def update_full(%User{} = actor, %Item{} = item, sections) when is_map(sections) do
    sections = stringify_keys(sections)
    item_attrs = stringify_keys(sections["item"] || %{})

    # If item_type is changing, the OLD sub-tables become stale. Sub-table
    # writes go against the *new* type so the user sees the right shape
    # after save. Stale rows from previous types stay untouched (v1 keeps
    # them; cleanup can come later).
    effective_type = item_attrs["item_type"] || item.item_type

    result =
      Repo.transaction(fn ->
        with {:ok, validated_attrs} <-
               validate_attributes(item.company_id, effective_type, item_attrs["attributes"]),
             payload <-
               item_attrs
               |> Map.put("updated_by_id", actor.id)
               |> maybe_put("attributes", validated_attrs),
             {:ok, updated_item} <-
               item |> Item.changeset(payload) |> Repo.update() do
          before_state = snapshot(item)
          after_state = snapshot(updated_item)
          Audit.record_updated(actor, "item", updated_item, before_state, after_state)

          case maybe_upsert_subtable(actor, updated_item, sections) do
            :ok ->
              get_for_company_full(updated_item.company_id, updated_item.uuid)

            {:error, payload} ->
              Repo.rollback(payload)
          end
        else
          {:error, %Ecto.Changeset{} = cs} ->
            Repo.rollback(%{section: "item", changeset: cs})

          {:error, {:invalid_attributes, detail}} ->
            Repo.rollback({:invalid_attributes, detail})
        end
      end)

    case result do
      {:ok, reloaded} ->
        Backend.Broadcasts.entity_changed(
          "item",
          reloaded.uuid,
          reloaded.company_id,
          "updated"
        )

        {:ok, reloaded}

      {:error, %{section: _section, changeset: _cs} = err} ->
        {:error, err}

      {:error, {:invalid_attributes, _} = err} ->
        {:error, err}

      other ->
        other
    end
  end

  defp maybe_upsert_subtable(actor, %Item{item_type: "raw_material"} = item, sections) do
    with :ok <- run_section(actor, item, sections, "raw_material_compliance", &Backend.RawMaterials.upsert_compliance/3),
         :ok <- run_section(actor, item, sections, "raw_material_risk", &Backend.RawMaterials.upsert_risk/3) do
      maybe_set_allergens(actor, item, sections)
    end
  end

  # Allergens are a set of UUIDs (M:N) — full-replace semantics, no
  # per-row state. Folded into the same transaction so a peer's allergen
  # tick lands atomically with the compliance/risk save.
  defp maybe_set_allergens(actor, item, sections) do
    case sections["allergen_uuids"] do
      nil ->
        :ok

      uuids when is_list(uuids) ->
        case Backend.RawMaterials.set_allergens(actor, item, uuids) do
          {:ok, _} -> :ok
          _ -> {:error, %{section: "allergens", changeset: nil}}
        end

      _ ->
        :ok
    end
  end

  defp maybe_upsert_subtable(actor, %Item{item_type: "finished_product"} = item, sections) do
    run_section(actor, item, sections, "finished_product_spec", &Backend.FinishedProducts.upsert/3)
  end

  defp maybe_upsert_subtable(actor, %Item{item_type: "packaging"} = item, sections) do
    run_section(actor, item, sections, "packaging_compliance", &Backend.Packaging.upsert/3)
  end

  defp maybe_upsert_subtable(_actor, _item, _sections), do: :ok

  defp run_section(actor, item, sections, key, upsert_fn) do
    case sections[key] do
      nil ->
        :ok

      %{} = attrs ->
        case upsert_fn.(actor, item, attrs) do
          {:ok, _} -> :ok
          {:error, %Ecto.Changeset{} = cs} ->
            {:error, %{section: key, changeset: cs}}
        end
    end
  end

  def delete(%User{} = actor, %Item{} = item) do
    before_state = snapshot(item)

    case Repo.delete(item) do
      {:ok, deleted} ->
        Audit.record_deleted(actor, "item", item, before_state)
        Backend.Broadcasts.entity_changed("item", item.uuid, item.company_id, "deleted")
        {:ok, deleted}

      other ->
        other
    end
  end

  # ----- attribute validation --------------------------------------

  # `attributes` may be omitted on update (nil) — in which case we
  # leave it untouched. Empty map is also allowed (clears all custom
  # attribute values). Any value present must match the definition.
  defp validate_attributes(_company_id, _type, nil), do: {:ok, nil}

  defp validate_attributes(company_id, type, attrs) when is_map(attrs) do
    defs = Catalogs.active_attribute_definitions_for_scope(company_id, type)
    by_key = Map.new(defs, fn d -> {d.key, d} end)

    # Reject unknown keys eagerly — better than silently dropping a
    # typo. Keys must match an active definition for this scope.
    unknown =
      attrs
      |> Map.keys()
      |> Enum.reject(fn k -> Map.has_key?(by_key, to_string(k)) end)

    cond do
      unknown != [] ->
        {:error,
         {:invalid_attributes,
          "unknown attribute key(s): #{Enum.join(unknown, ", ")} — define them at /settings/attribute-definitions first"}}

      true ->
        validate_values(attrs, by_key)
    end
  end

  defp validate_attributes(_company_id, _type, _other),
    do: {:error, {:invalid_attributes, "attributes must be a JSON object"}}

  defp validate_values(attrs, by_key) do
    Enum.reduce_while(attrs, {:ok, %{}}, fn {key, value}, {:ok, acc} ->
      def_ = Map.fetch!(by_key, to_string(key))

      case coerce_value(def_, value) do
        {:ok, coerced} ->
          {:cont, {:ok, Map.put(acc, to_string(key), coerced)}}

        {:error, reason} ->
          {:halt, {:error, {:invalid_attributes, "#{key}: #{reason}"}}}
      end
    end)
  end

  defp coerce_value(_def, nil), do: {:ok, nil}

  defp coerce_value(%AttributeDefinition{attribute_type: "text"}, v) when is_binary(v),
    do: {:ok, v}

  defp coerce_value(%AttributeDefinition{attribute_type: "text"}, _),
    do: {:error, "must be a string"}

  defp coerce_value(%AttributeDefinition{attribute_type: "number"}, v)
       when is_number(v),
       do: {:ok, v}

  defp coerce_value(%AttributeDefinition{attribute_type: "number"}, v) when is_binary(v) do
    case Float.parse(v) do
      {f, ""} -> {:ok, f}
      _ -> {:error, "must be a number"}
    end
  end

  defp coerce_value(%AttributeDefinition{attribute_type: "number"}, _),
    do: {:error, "must be a number"}

  defp coerce_value(%AttributeDefinition{attribute_type: "boolean"}, v)
       when is_boolean(v),
       do: {:ok, v}

  defp coerce_value(%AttributeDefinition{attribute_type: "boolean"}, _),
    do: {:error, "must be true or false"}

  defp coerce_value(%AttributeDefinition{attribute_type: "date"}, v) when is_binary(v) do
    case Date.from_iso8601(v) do
      {:ok, _} -> {:ok, v}
      _ -> {:error, "must be ISO-8601 date (YYYY-MM-DD)"}
    end
  end

  defp coerce_value(%AttributeDefinition{attribute_type: "date"}, _),
    do: {:error, "must be a date string"}

  defp coerce_value(%AttributeDefinition{attribute_type: "url"}, v) when is_binary(v) do
    if String.starts_with?(v, "http://") or String.starts_with?(v, "https://") do
      {:ok, v}
    else
      {:error, "must be an http(s) URL"}
    end
  end

  defp coerce_value(%AttributeDefinition{attribute_type: "url"}, _),
    do: {:error, "must be a URL string"}

  defp coerce_value(%AttributeDefinition{attribute_type: "enum", enum_choices: choices}, v)
       when is_binary(v) do
    valid = Enum.map(choices, & &1["value"])

    if v in valid do
      {:ok, v}
    else
      {:error, "must be one of: #{Enum.join(valid, ", ")}"}
    end
  end

  defp coerce_value(%AttributeDefinition{attribute_type: "enum"}, _),
    do: {:error, "must be one of the configured choices"}

  defp coerce_value(_def, v), do: {:ok, v}

  # ----- compliance transitions ------------------------------------

  alias Backend.Items.Compliance

  @doc """
  Live readiness check for an item — runs the per-type validator
  against the fully-preloaded row. Used by the payload renderer so the
  FE can show the live "what's missing" panel without round-tripping.
  """
  def compliance_check(%Item{} = item), do: Compliance.check(item)

  @doc """
  Mark an item ready for use. Validates the per-type required field
  set; if anything is missing, refuses the transition and returns the
  exact blocker list so the FE can route each error to its field.
  """
  def mark_ready(%User{} = actor, %Item{} = item) do
    full = get_for_company_full(item.company_id, item.uuid)

    case Compliance.check(full) do
      {:ok, []} ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)
        before = snapshot(full)

        attrs = %{
          "compliance_status" => "ready_for_use",
          "compliance_readied_at" => now,
          "compliance_readied_by_id" => actor.id,
          "compliance_revert_reason" => nil,
          "updated_by_id" => actor.id
        }

        full
        |> Item.changeset(attrs)
        |> Repo.update()
        |> case do
          {:ok, updated} ->
            Audit.record_updated(actor, "item", updated, before, snapshot(updated))
            Backend.Broadcasts.entity_changed("item", updated.uuid, updated.company_id, "marked_ready")
            {:ok, get_for_company_full(updated.company_id, updated.uuid)}

          other ->
            other
        end

      {:missing, blockers} ->
        {:error, {:compliance_blocked, blockers}}
    end
  end

  @doc """
  Revert an item to `draft`. Requires a justification text — auditors
  ask "why did this stop being ready?" so we capture the reason on the
  same row + leave the timestamped readied_at as historical context
  (last successful readiness).
  """
  def revert_to_draft(%User{} = actor, %Item{} = item, reason)
      when is_binary(reason) do
    if String.trim(reason) == "" do
      {:error, :reason_required}
    else
      before = snapshot(item)

      attrs = %{
        "compliance_status" => "draft",
        "compliance_revert_reason" => reason,
        "updated_by_id" => actor.id
      }

      item
      |> Item.changeset(attrs)
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          Audit.record_updated(actor, "item", updated, before, snapshot(updated))
          Backend.Broadcasts.entity_changed("item", updated.uuid, updated.company_id, "reverted_to_draft")
          {:ok, updated}

        other ->
          other
      end
    end
  end

  def revert_to_draft(_actor, _item, _), do: {:error, :reason_required}

  # ----- file attachments ------------------------------------------

  @doc """
  Persist the metadata row backing an uploaded compliance file. Bytes
  are already in `Backend.Storage` by the time we get here — the
  controller calls `Storage.put/3` first, then asks us to record the
  resulting `blob_path` so the FE can resolve a serve URL.

  Compliance subtable writes (raw-material spec, packaging DoC, …)
  carry an FK back to the row this creates.
  """
  def record_file(%User{} = actor, %Item{} = item, attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("company_id", item.company_id)
      |> Map.put("item_id", item.id)
      |> Map.put("uploaded_by_id", actor.id)

    %ItemFile{}
    |> ItemFile.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, file} ->
        Backend.Broadcasts.entity_changed("item", item.uuid, item.company_id, "file_added")
        {:ok, Repo.preload(file, :uploaded_by)}

      other ->
        other
    end
  end

  @doc "Look up a file row scoped to the given item."
  def get_file(item_id, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        Repo.one(
          from(f in ItemFile,
            where: f.item_id == ^item_id and f.uuid == ^cast,
            preload: [:uploaded_by]
          )
        )

      :error ->
        nil
    end
  end

  def get_file(_, _), do: nil

  # ----- helpers ---------------------------------------------------

  defp after_create({:ok, item}, actor) do
    Audit.record_created(actor, "item", item, snapshot(item))
    Backend.Broadcasts.entity_changed("item", item.uuid, item.company_id, "created")
    {:ok, Repo.preload(item, [:stock_uom, :product_family, :created_by, :updated_by])}
  end

  defp after_create(other, _actor), do: other

  defp after_update({:ok, item}, actor, before_state) do
    Audit.record_updated(actor, "item", item, before_state, snapshot(item))
    Backend.Broadcasts.entity_changed("item", item.uuid, item.company_id, "updated")
    {:ok, Repo.preload(item, [:stock_uom, :product_family, :created_by, :updated_by])}
  end

  defp after_update(other, _actor, _before), do: other

  defp snapshot(%Item{} = i),
    do: Map.new(@audit_fields, fn k -> {k, Map.get(i, k)} end)

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
