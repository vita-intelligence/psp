defmodule Backend.Release do
  @moduledoc """
  Release-time helpers used by the Docker entrypoint.

  Migrations run on container start via `mix eval`:

      bin/backend eval "Backend.Release.migrate()"

  Rollback with `Backend.Release.rollback(Backend.Repo, version)`.
  """

  @app :backend

  def migrate do
    load_app()

    for repo <- repos() do
      {:ok, _, _} =
        Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end

  def rollback(repo, version) do
    load_app()
    {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :down, to: version))
  end

  defp repos do
    Application.fetch_env!(@app, :ecto_repos)
  end

  defp load_app do
    Application.load(@app)
  end
end
