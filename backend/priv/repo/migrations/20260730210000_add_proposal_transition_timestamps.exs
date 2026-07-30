defmodule Backend.Repo.Migrations.AddProposalTransitionTimestamps do
  use Ecto.Migration

  @moduledoc """
  Timeline plumbing — mirror the NPD proposal's per-status transition
  timestamps + actor names onto the primary CustomerOrder so the wizard
  timeline can render the proposal lifecycle without a cross-app fetch.

  Fields all update-on-every-sync (NPD is authoritative and re-plants
  everything). Nulls until the transition happens.

  ``npd_proposal_created_at`` is redundant with the merge event's
  planting time, but recording it explicitly means the timeline shows
  "Proposal drafted on NPD" even for merges that happen well after the
  proposal's actual creation moment.
  """

  def change do
    alter table(:customer_orders) do
      add :npd_proposal_created_at, :utc_datetime
      add :npd_proposal_created_by_name, :string, size: 200

      add :npd_proposal_director_approved_at, :utc_datetime
      add :npd_proposal_director_name, :string, size: 200

      add :npd_proposal_sent_at, :utc_datetime
      add :npd_proposal_sent_by_name, :string, size: 200

      add :npd_proposal_accepted_at, :utc_datetime
      add :npd_proposal_accepted_by_name, :string, size: 200
    end
  end
end
