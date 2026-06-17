defmodule Backend.Repo.Migrations.CreateMoConsumerLinks do
  use Ecto.Migration

  @moduledoc """
  Shared-batch consumer links — many-to-many between a batch MO and
  any extra consumer MOs that pull from the same physical batch
  beyond its primary parent.

  Example: MO-A and MO-B both need 1 kg of magnesium base. The
  operator merges MO-B's auto-spawned blend sub-MO into MO-A's blend
  sub-MO (bumping its qty to 2 kg, cancelling MO-B's own sub-MO).
  The link table records that MO-A's blend feeds MO-B too.

  Single primary parent stays on `manufacturing_orders.parent_mo_id`
  (the MO that originally requested the batch). Secondary consumers
  live here.
  """

  def change do
    create table(:mo_consumer_links) do
      add :uuid, :uuid, null: false

      add :company_id, references(:companies, on_delete: :restrict), null: false

      # The batch — the MO doing the producing.
      add :batch_mo_id,
          references(:manufacturing_orders, on_delete: :delete_all),
          null: false

      # The additional consumer — an FG / SFG MO that pulls from
      # this batch (beyond its own primary sub-MO).
      add :consumer_mo_id,
          references(:manufacturing_orders, on_delete: :delete_all),
          null: false

      # How much of the batch is earmarked for this consumer. Helps
      # the parts table show "Awaiting X from shared batch MO-Y".
      add :shared_qty, :decimal, precision: 14, scale: 4, null: false

      add :created_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:mo_consumer_links, [:uuid])
    create index(:mo_consumer_links, [:batch_mo_id])
    create index(:mo_consumer_links, [:consumer_mo_id])

    create unique_index(:mo_consumer_links, [:batch_mo_id, :consumer_mo_id],
             name: :mo_consumer_links_unique_pair
           )

    create constraint(:mo_consumer_links, :mo_consumer_links_qty_positive,
             check: "shared_qty > 0"
           )

    # A batch can't consume itself.
    create constraint(:mo_consumer_links, :mo_consumer_links_no_self_link,
             check: "batch_mo_id <> consumer_mo_id"
           )
  end
end
