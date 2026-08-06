defmodule Backend.Repo.Migrations.AddNpdFrontendUrl do
  use Ecto.Migration

  # `npd_base_url` targets NPD's HTTP API (Django, port 8000 in dev) —
  # server-to-server calls (spec-sheet proxy, trial-validation sync)
  # depend on it. Deep-links surfaced in the browser (e.g. the Output
  # QC page's "Open on NPD" card) need a *different* URL — the Next.js
  # frontend (port 3001 in dev). Conflating the two forces one to
  # break the other, which is exactly what happened when the FE URL
  # was written into `npd_base_url` and the spec-sheet iframe 404'd.
  #
  # Nullable — legacy tenants keep working (the Output QC card just
  # hides until the FE URL is set).
  def change do
    alter table(:companies) do
      add :npd_frontend_url, :string, null: true
    end
  end
end
