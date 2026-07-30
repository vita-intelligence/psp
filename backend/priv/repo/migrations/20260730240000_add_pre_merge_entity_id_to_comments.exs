defmodule Backend.Repo.Migrations.AddPreMergeEntityIdToComments do
  @moduledoc """
  Provenance breadcrumb so a proposal-driven merge is reversible.

  When ``ProposalMerge.merge_from_proposal`` fans N R&D CustomerOrders
  into one primary, every comment on a secondary CO gets its
  ``entity_id`` rewritten to the primary. That's lossy on its own — an
  unmerge can't tell which secondary a given comment came from.

  This column captures the original ``entity_id`` at merge time so
  ``ProposalMerge.unmerge_from_proposal`` can fan them back to their
  home CO. Nullable + no default so untouched rows stay untouched.
  """

  use Ecto.Migration

  def change do
    alter table(:comments) do
      add :pre_merge_entity_id, :integer
    end
  end
end
