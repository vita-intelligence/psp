defmodule Backend.Equipment.RunningCosts do
  @moduledoc """
  Boundary for equipment running-cost line items.

  Each equipment unit can carry any number of active running-cost
  components (electricity, compressed air, consumables, maintenance
  reserve, licence fees, …). The SUM of ``amount_per_hour`` across
  active components is cached onto ``equipment.hourly_running_cost``
  so the workstation cost roll-up (`Backend.Production.WorkstationCosts`)
  doesn't have to join + sum per equipment row on every call.

  All writes go through this module so the cache stays coherent —
  ``recompute_cache/2`` runs inside the same transaction that
  changed the component list.
  """

  # Cherry-pick imports so the local `update/3` isn't shadowed by
  # Ecto.Query.update — the two have very different call shapes.
  import Ecto.Query, only: [from: 2, where: 3, order_by: 2]

  alias Backend.Accounts.User
  alias Backend.Equipment.{Equipment, RunningCostComponent}
  alias Backend.Repo

  @doc """
  List active-first, newest-first for a piece of equipment.
  """
  def list_for_equipment(%Equipment{id: id}) do
    from(c in RunningCostComponent,
      where: c.equipment_id == ^id,
      order_by: [desc: c.is_active, desc: c.inserted_at, asc: c.id]
    )
    |> Repo.all()
  end

  def get_for_equipment(%Equipment{id: eq_id, company_id: cid}, uuid) when is_binary(uuid) do
    case Ecto.UUID.cast(uuid) do
      {:ok, cast} ->
        RunningCostComponent
        |> where(
          [c],
          c.equipment_id == ^eq_id and c.company_id == ^cid and c.uuid == ^cast
        )
        |> Repo.one()

      _ ->
        nil
    end
  end

  @doc """
  Attach a new cost line and refresh the cached total.
  """
  def create(%Equipment{} = equipment, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.put("company_id", equipment.company_id)
      |> Map.put("equipment_id", equipment.id)
      |> Map.put("created_by_id", actor.id)
      |> Map.put("updated_by_id", actor.id)

    Repo.transaction(fn ->
      with {:ok, comp} <-
             %RunningCostComponent{} |> RunningCostComponent.changeset(attrs) |> Repo.insert(),
           {:ok, _eq} <- recompute_cache(equipment.id) do
        comp
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  def update(%RunningCostComponent{} = comp, attrs, %User{} = actor) do
    attrs =
      attrs
      |> Map.drop(["company_id", "equipment_id", "created_by_id"])
      |> Map.put("updated_by_id", actor.id)

    Repo.transaction(fn ->
      with {:ok, updated} <-
             comp |> RunningCostComponent.changeset(attrs) |> Repo.update(),
           {:ok, _eq} <- recompute_cache(comp.equipment_id) do
        updated
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  @doc """
  Soft-delete — flip ``is_active`` to false. History value is kept.
  """
  def deactivate(%RunningCostComponent{} = comp, %User{} = actor) do
    update(comp, %{"is_active" => false}, actor)
  end

  def reactivate(%RunningCostComponent{} = comp, %User{} = actor) do
    update(comp, %{"is_active" => true}, actor)
  end

  @doc """
  Recompute the cached ``hourly_running_cost`` +
  ``hourly_running_cost_currency`` for the given equipment id. Runs
  inside the caller's transaction — safe to call from any write path
  that touches ``equipment_running_cost_components``.

  Currency policy: first active component's currency wins. Mixed
  currencies in the same stack aren't summed sensibly, so we don't
  try — operators reconcile at their own level.
  """
  def recompute_cache(equipment_id) when is_integer(equipment_id) do
    {sum, currency} =
      from(c in RunningCostComponent,
        where: c.equipment_id == ^equipment_id and c.is_active == true,
        order_by: [asc: c.id]
      )
      |> Repo.all()
      |> Enum.reduce({Decimal.new(0), nil}, fn c, {acc, ccy} ->
        {Decimal.add(acc, c.amount_per_hour || Decimal.new(0)),
         ccy || c.currency}
      end)

    Equipment
    |> where([e], e.id == ^equipment_id)
    |> Repo.one()
    |> case do
      nil ->
        {:ok, nil}

      %Equipment{} = eq ->
        eq
        |> Ecto.Changeset.change(
          hourly_running_cost: if(Decimal.gt?(sum, 0), do: sum, else: nil),
          hourly_running_cost_currency: currency
        )
        |> Repo.update()
    end
  end
end
