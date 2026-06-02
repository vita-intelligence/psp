defmodule BackendWeb.Errors do
  @moduledoc """
  Single source of truth for the public error-response shape.

  Every error returned by the API conforms to:

      %{
        "error" => "snake_case_code",     # machine-readable, frontend pivots on this
        "detail" => "Human-readable.",    # safe to show to the end user as-is
        "fields" => %{...}                # optional — per-field validation errors
      }

  Keep `error` codes stable; frontends ship lookup tables keyed on them.
  Change the `detail` string if the copy needs polishing; never quietly
  rename a code.
  """

  @doc """
  Build the standard error map. `fields` is optional and omitted when
  empty so the JSON stays clean.
  """
  def payload(code, detail, fields \\ %{}) when is_binary(code) and is_binary(detail) do
    base = %{error: code, detail: detail}
    if map_size(fields) == 0, do: base, else: Map.put(base, :fields, fields)
  end

  @doc """
  Flatten a changeset into the `fields` shape: `%{field => [messages]}`.
  Interpolated counts/values are substituted in so the messages are
  ready to display.
  """
  def changeset_fields(%Ecto.Changeset{} = changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end
end
