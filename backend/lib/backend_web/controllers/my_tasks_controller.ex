defmodule BackendWeb.MyTasksController do
  @moduledoc """
  Per-user tasks list — the desktop "my tasks" surface.

    * `GET /api/my-tasks` — paginated + filterable + searchable feed
      of every actionable CTA the user can pick up right now.
    * `GET /api/my-tasks/count` — lean counts summary. Used by the
      top-bar badge; deliberately cheaper than the full list because
      it fires on every entity broadcast.

  Both endpoints project the actor's own tasks (auth from the current
  session), so there are no path params for who.
  """

  use BackendWeb, :controller

  alias Backend.MyTasks
  alias BackendWeb.Payloads

  action_fallback BackendWeb.FallbackController

  def index(conn, params) do
    actor = conn.assigns.current_user

    opts = [
      limit: params["limit"],
      cursor: params["cursor"],
      phase: params["phase"],
      urgency: params["urgency"],
      search: params["search"]
    ]

    {tasks, next_cursor} = MyTasks.list_page(actor, opts)

    json(conn, %{
      tasks: Enum.map(tasks, &Payloads.my_task/1),
      next_cursor: next_cursor
    })
  end

  def count(conn, _params) do
    actor = conn.assigns.current_user
    json(conn, MyTasks.count(actor))
  end
end
