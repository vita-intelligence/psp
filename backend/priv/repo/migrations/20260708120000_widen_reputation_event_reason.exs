defmodule Backend.Repo.Migrations.WidenReputationEventReason do
  @moduledoc """
  `employee_reputation_events.reason` was `varchar(500)`, which cut
  off legitimate multi-sentence performance notes coming across from
  vita-performance during the HR seed. Widen to `text` — no length
  cap at the DB layer; the changeset carries a `max: 4000` cap so
  operators typing paragraph after paragraph still get a friendly
  boundary.
  """

  use Ecto.Migration

  def change do
    alter table(:employee_reputation_events) do
      modify :reason, :text, from: :string
    end
  end
end
