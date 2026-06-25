defmodule Backend.Config do
  @moduledoc """
  Runtime config helpers. Kept thin on purpose — every value sourced
  here is something that may differ between local dev and the deployed
  Azure environment.
  """

  @doc """
  CORS allowed origins. Defaults to the local Next dev origin; override
  with `CORS_ORIGINS=https://psp.example.com,https://psp.staging.example.com`.
  Called by CORSPlug on every request — must stay pure / fast.
  """
  def cors_origins(_conn \\ nil) do
    System.get_env("CORS_ORIGINS", "http://localhost:3010,https://localhost:3010")
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1)
  end
end
