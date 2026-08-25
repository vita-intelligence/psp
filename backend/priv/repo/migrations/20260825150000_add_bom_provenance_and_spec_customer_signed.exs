defmodule Backend.Repo.Migrations.AddBomProvenanceAndSpecCustomerSigned do
  use Ecto.Migration

  @moduledoc """
  BOM provenance + spec-customer-signature mirror.

  Two additions in one migration because they both surface on the
  same "trust card" the operator sees when clicking Create MO — the
  card compares the BOM's source spec against the CO's spec-signed
  timestamp to prove the BOM matches what the customer approved.

  1. `boms.npd_spec_sheet_uuid` / `npd_formulation_version_id` /
     `npd_synced_at` — recorded on every integration BOM push. Lets
     the FE render "this BOM was pushed from spec X on Y" and warn
     when a spec drift is detected (BOM synced AFTER the customer
     signature).

  2. `customer_orders.npd_spec_customer_signed_at` /
     `npd_spec_customer_signed_by_name` — the SPEC's customer
     signature (distinct from the PROPOSAL's `npd_customer_signed_at`
     which already exists). Populated from vita-cff's
     `SpecificationSheet.customer_signed_at` on every spec-approved
     sync. Compared against `bom.npd_synced_at` to detect drift.
  """

  def change do
    alter table(:boms) do
      # NPD spec sheet the BOM belongs to. Null on BOMs that were
      # authored directly on PSP (rare; production BOMs come from
      # NPD). Uuid, not FK — spec sheets live on NPD.
      add :npd_spec_sheet_uuid, :uuid

      # NPD Formulation.version at push time. Free-form string so a
      # future NPD versioning change (e.g. semver) doesn't need a
      # coordinated PSP migration.
      add :npd_formulation_version_id, :string, size: 64

      # When the integration writer last landed a push for this BOM.
      # Distinct from `updated_at` which advances on ANY edit; this
      # one only moves when NPD syncs, so the FE can detect "BOM was
      # synced after customer signed the spec" drift.
      add :npd_synced_at, :utc_datetime
    end

    alter table(:customer_orders) do
      # Customer signature on the SPEC sheet (not the proposal).
      # `npd_customer_signed_at` already carries the PROPOSAL
      # signature — different signing surface, different legal
      # meaning. Both may be null at different phases of the project;
      # trust card treats spec-signed as the compliance gate for
      # BOM-vs-spec alignment.
      add :npd_spec_customer_signed_at, :utc_datetime
      add :npd_spec_customer_signed_by_name, :string, size: 200
    end
  end
end
