defmodule BackendWeb.Router do
  use BackendWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :api_authed do
    plug :accepts, ["json"]
    plug BackendWeb.Plugs.RequireAuth
  end

  scope "/api", BackendWeb do
    pipe_through :api

    post "/auth/register", AuthController, :register
    post "/auth/login", AuthController, :login
    post "/auth/confirm", AuthController, :confirm
    post "/auth/forgot-password", PasswordResetController, :request
    post "/auth/reset-password", PasswordResetController, :confirm
  end

  scope "/api", BackendWeb do
    pipe_through :api_authed

    get "/auth/me", AuthController, :me
    put "/auth/me", ProfileController, :update
    put "/auth/password", ProfileController, :change_password
    get "/users", UserController, :index

    get "/company", CompanyController, :show
    put "/company", CompanyController, :update
    put "/company/locale", CompanyController, :update_locale
    put "/company/bag", CompanyController, :update_bag

    resources "/warehouses", WarehouseController, only: [:index, :show, :create, :update, :delete]
  end

  # Enable LiveDashboard and Swoosh mailbox preview in development
  if Application.compile_env(:backend, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through [:fetch_session, :protect_from_forgery]

      live_dashboard "/dashboard", metrics: BackendWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
