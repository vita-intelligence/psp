defmodule Backend.Repo.Migrations.AddComplianceStatusToItems do
  use Ecto.Migration

  @moduledoc """
  Two-state compliance gate on items — `draft` vs `ready_for_use`.

  Items default to `draft`. The mark-ready transition validates the
  full per-type regulatory required-fields set (BRCGS § 3.5.1 / FSSC
  § 7.1.6 / EU 1169/2011 / EU 1935/2004 essentials) and stamps the
  actor + timestamp. Going back to `draft` requires admin privilege
  + justification (mirrors the vendor approve / un-approve pattern).

  Downstream gates — PO line creation, BOM assembly, finished-product
  release — refuse to accept `draft` items so it's structurally
  impossible to ship something off the regulatory road.

  No FK constraint on the values: enforced via Ecto changeset because
  the enum surface is small + open to additions later (e.g. `archived`).
  """

  def change do
    alter table(:items) do
      add :compliance_status, :string,
        size: 20,
        null: false,
        default: "draft"

      add :compliance_readied_at, :utc_datetime
      add :compliance_readied_by_id, references(:users, on_delete: :nilify_all)
      add :compliance_revert_reason, :text
    end

    create index(:items, [:company_id, :compliance_status])
  end
end
