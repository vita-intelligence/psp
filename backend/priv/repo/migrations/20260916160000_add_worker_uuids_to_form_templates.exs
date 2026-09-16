defmodule Backend.Repo.Migrations.AddWorkerUuidsToFormTemplates do
  @moduledoc """
  Optional worker allowlist per form. Empty array = the form applies
  to every worker on the assigned workstation; non-empty = only fires
  for workers whose vita-perf `Worker.uuid` is in the list.

  Stored as `text[]` rather than a join table because:
    * The list is short (usually 1-5 names).
    * PSP doesn't own the identity — the string values are vita-perf
      worker uuids (opaque from PSP's point of view; produced by the
      FE picker off `Employee.external_id`).
    * A join table would demand a FK and cascade behaviour, but
      Employee↔Worker mirroring is best-effort — sync gaps must not
      break form authoring.

  The picker on the FormBuilder lists active HR Employees and stores
  each pick's `external_id` (= vita-perf `Worker.uuid`) into this
  column. Publisher passes the array through to vita-perf as-is; the
  kiosk audience check reads it locally.
  """

  use Ecto.Migration

  def change do
    alter table(:form_templates) do
      add :worker_uuids, {:array, :text}, null: false, default: []
    end
  end
end
