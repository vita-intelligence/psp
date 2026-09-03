defmodule Backend.Repo.Migrations.AddSourceToThreePlDispatches do
  @moduledoc """
  Portal-triggered 3PL dispatch requests (Phase 2 of the 3PL portal
  integration). A dispatch request can now come from the customer's
  portal button — not just a desktop operator — so we need to track
  WHERE the request originated + let ``requested_by_id`` be null
  when there's no PSP user on the wire.

  * ``source`` — enum-ish string. Defaults to ``"staff"`` so existing
    rows stay valid; new values (``"portal"``, ``"shopify_webhook"``,
    ``"custom_api"``) land as we build Phase 2/3. Enforced by the
    changeset (validate_inclusion), not by a DB constraint, so future
    values don't require a follow-up migration.
  * ``external_reference`` — nullable string for the caller's own
    order id (Shopify's order number, a custom-storefront reference).
    Powers the outbound webhook back-fill in Phase 3.
  * ``requested_by_id`` — dropped the NOT NULL. Portal-triggered
    rows carry ``nil`` because the customer isn't a User in PSP.
    Existing staff-triggered rows keep the operator FK.
  """

  use Ecto.Migration

  def change do
    alter table(:three_pl_dispatches) do
      add :source, :string, null: false, default: "staff"
      add :external_reference, :string
      modify :requested_by_id, references(:users), null: true, from: {references(:users), null: false}
    end
  end
end
