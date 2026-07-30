defmodule Backend.Repo.Migrations.AddNpdSourceAndCffFields do
  use Ecto.Migration

  @moduledoc """
  Two related changes bundled together — both are NPD-mirror plumbing
  on the CustomerOrder / Customer surface.

  1. ``customers.npd_source_uuid`` — the NPD-side ``Customer.id`` that
     spawned this row. Populated when the customer is auto-created
     from an NPD ``link_customer`` sync; nil for customers entered
     directly on PSP. Unique per company so re-syncing the same NPD
     customer flips back to the same PSP row rather than duplicating.

  2. ``customer_orders.npd_cff_*`` — denormalised CFF identity + link.
     NPD's ``assign_to_project`` / ``detach_from_project`` services
     fire a sync that carries the CFF fields; PSP's project page
     surfaces them so the operator sees the same "R&D story" the
     scientist sees on NPD.
  """

  def change do
    alter table(:customers) do
      add :npd_source_uuid, :uuid
    end

    # Unique per tenant so a re-sync from NPD lands on the same row
    # rather than creating another shell.
    create unique_index(:customers, [:company_id, :npd_source_uuid],
             name: :customers_company_id_npd_source_uuid_index,
             where: "npd_source_uuid IS NOT NULL"
           )

    alter table(:customer_orders) do
      add :npd_cff_uuid, :uuid
      add :npd_cff_url, :string, size: 500
      add :npd_cff_submitter_name, :string, size: 200
      add :npd_cff_submitter_email, :string, size: 200
    end
  end
end
