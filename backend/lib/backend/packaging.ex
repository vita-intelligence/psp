defmodule Backend.Packaging do
  @moduledoc """
  Boundary for the packaging-compliance subtable.
  """

  alias Backend.Accounts.User
  alias Backend.Audit
  alias Backend.Items.{Item, PackagingCompliance}
  alias Backend.Repo

  @audit_fields ~w(material food_contact_compliant food_contact_declaration_file_id recyclability_code migration_test_file_id migration_test_expires_at)a

  def get(item_id) when is_integer(item_id) do
    Repo.get(PackagingCompliance, item_id)
    |> case do
      nil -> nil
      row -> Repo.preload(row, [:food_contact_declaration_file, :migration_test_file])
    end
  end

  def upsert(%User{} = actor, %Item{} = item, attrs) do
    existing = Repo.get(PackagingCompliance, item.id)
    before_state = existing && snapshot(existing)
    base = existing || %PackagingCompliance{item_id: item.id}

    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("item_id", item.id)

    changeset = PackagingCompliance.changeset(base, attrs)

    case Repo.insert_or_update(changeset) do
      {:ok, row} ->
        after_state = snapshot(row)

        if before_state do
          Audit.record_updated(
            actor,
            "packaging_compliance",
            row,
            before_state,
            after_state
          )
        else
          Audit.record_created(actor, "packaging_compliance", row, after_state)
        end

        {:ok, Repo.preload(row, [:food_contact_declaration_file, :migration_test_file])}

      other ->
        other
    end
  end

  defp snapshot(%PackagingCompliance{} = p),
    do: Map.new(@audit_fields, fn k -> {k, Map.get(p, k)} end)

  defp stringify_keys(attrs) do
    Enum.into(attrs, %{}, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
