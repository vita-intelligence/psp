defmodule Backend.Repo.Migrations.AddProposalMergeFieldsToCustomerOrders do
  use Ecto.Migration

  @moduledoc """
  Proposal-driven merge on the CustomerOrder surface.

  When a Proposal is created on NPD bundling N spec sheets for the
  same customer, NPD fires a merge sync that consolidates the N R&D
  draft COs into ONE. The primary CO absorbs the metadata, comments,
  and lines from the sources; the others get pointed at the primary
  via ``merged_into_id`` and stay in the table for audit.

    * ``merged_into_id`` — self FK on ``customer_orders``. When set,
      this CO is a superseded R&D draft; every list view should hide
      it unless the caller opts in to the merged rows explicitly.
      Deferred FK constraint (``on_delete: :nilify_all``) so deleting
      the primary doesn't cascade-nuke the audit rows.

    * ``npd_proposal_uuid`` — the NPD-side ``Proposal.id`` planted on
      the merged (primary) CO. Unique per company so a re-fire of the
      merge from NPD (e.g. a proposal regenerated) idempotently lands
      on the same PSP CO instead of creating a duplicate. Also lets
      the merge context skip the reassignment work when it sees the
      identity is already committed.

    * ``npd_proposal_code`` / ``npd_proposal_url`` — display + deep
      link so the PSP project page can render "Proposal PROP-0421 →
      Open on NPD" without a cross-app lookup.
  """

  def change do
    alter table(:customer_orders) do
      add :merged_into_id,
          references(:customer_orders, on_delete: :nilify_all)

      add :npd_proposal_uuid, :uuid
      add :npd_proposal_code, :string, size: 64
      add :npd_proposal_url, :string, size: 500
    end

    # One PSP CO per NPD proposal. Partial index so pre-merge draft
    # rows (uuid = nil) don't collide.
    create unique_index(:customer_orders, [:company_id, :npd_proposal_uuid],
             name: :customer_orders_company_id_npd_proposal_uuid_index,
             where: "npd_proposal_uuid IS NOT NULL"
           )

    # Look-ups by "who did this row merge into" — used by list views
    # that need to hide superseded rows, and by the audit surface that
    # follows the chain back to the primary.
    create index(:customer_orders, [:merged_into_id],
             where: "merged_into_id IS NOT NULL"
           )
  end
end
