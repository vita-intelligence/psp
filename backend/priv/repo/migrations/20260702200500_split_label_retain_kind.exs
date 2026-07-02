defmodule Backend.Repo.Migrations.SplitLabelRetainKind do
  use Ecto.Migration

  @moduledoc """
  BRCGS Issue 9 splits label proof (§ 5.4.2) from retention samples
  (§ 5.7). The release form was collapsing both into a single
  `label_retain` file kind — clean enough for MVP but muddled for the
  audit trail. Split it going forward.

  Any historical `label_retain` rows get relabelled to `label_proof`
  so they stay valid (the split kinds are what the required-file
  gate now expects). Down migration reverses the rename.
  """

  def up do
    execute(
      "UPDATE production_final_release_files SET kind = 'label_proof' WHERE kind = 'label_retain'"
    )
  end

  def down do
    execute(
      "UPDATE production_final_release_files SET kind = 'label_retain' WHERE kind = 'label_proof'"
    )
  end
end
