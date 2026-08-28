defmodule Backend.Repo.Migrations.AddNpdProposalUuidToMos do
  @moduledoc """
  Denormalise ``npd_proposal_uuid`` onto ``manufacturing_orders`` so
  per-order MO queries don't have to walk MO → customer_order_lines →
  customer_orders → npd_proposal_uuid every time. Populated at MO
  create from the parent CO; back-filled here for existing rows.

  The RTG multi-order fix made this hot: the customer portal now
  needs to answer "which MOs belong to THIS order?" on every
  production-card render, and doing that through two joins across
  potentially large tables was fine for Custom's 1-per-formulation
  but slow at RTG scale where a formulation can have N orders each
  with their own MO tree.
  """

  use Ecto.Migration

  def up do
    alter table(:manufacturing_orders) do
      add :npd_proposal_uuid, :uuid
    end

    # Back-fill by walking each MO through its CO line to its CO.
    # ``customer_order_line_id`` is nullable (some legacy MOs are
    # orphaned — the whole reason we're doing this cleanup) so those
    # stay NULL.
    execute """
    UPDATE manufacturing_orders mo
    SET npd_proposal_uuid = co.npd_proposal_uuid
    FROM customer_order_lines col
    JOIN customer_orders co ON co.id = col.customer_order_id
    WHERE mo.customer_order_line_id = col.id
      AND co.npd_proposal_uuid IS NOT NULL
    """

    create index(:manufacturing_orders, [:npd_proposal_uuid],
             where: "npd_proposal_uuid IS NOT NULL",
             name: :manufacturing_orders_npd_proposal_uuid_index
           )
  end

  def down do
    drop_if_exists index(:manufacturing_orders, [:npd_proposal_uuid],
                     name: :manufacturing_orders_npd_proposal_uuid_index
                   )

    alter table(:manufacturing_orders) do
      remove :npd_proposal_uuid
    end
  end
end
