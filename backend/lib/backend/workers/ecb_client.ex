defmodule Backend.Workers.EcbClient do
  @moduledoc """
  Thin wrapper around the European Central Bank reference-rates feed
  (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml).

  The feed is free, no auth, returns a tiny XML doc with the previous
  business-day rates against EUR, refreshed around 16:00 CET on every
  ECB working day. We don't cache the response — the daily cron pulls
  once a day and that's the cadence the feed itself supports.

  Output shape: `{:ok, %{rate_date, rates}}` where `rates` is a map
  `%{currency_code => Decimal.t()}` keyed by ISO 4217 against 1 EUR.
  """

  @feed_url "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"

  @type rate_map :: %{String.t() => Decimal.t()}
  @type fetch_result :: %{rate_date: Date.t() | nil, rates: rate_map()}

  @doc """
  Fetch + parse in one step. The `:req_options` opt is for tests —
  pass `[plug: {Req.Test, :ecb}]` so `Req.Test.stub/2` can intercept.
  """
  @spec fetch(keyword()) :: {:ok, fetch_result()} | {:error, term()}
  def fetch(opts \\ []) do
    req_opts =
      Keyword.merge(
        [url: @feed_url, receive_timeout: 15_000, retry: :transient],
        Application.get_env(:backend, __MODULE__, [])
        |> Keyword.merge(Keyword.get(opts, :req_options, []))
      )

    case Req.get(req_opts) do
      {:ok, %Req.Response{status: 200, body: body}} when is_binary(body) ->
        parse(body)

      {:ok, %Req.Response{status: status}} ->
        {:error, {:http_status, status}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Parse the ECB XML response into `{:ok, %{rate_date, rates}}`. Public
  so tests can feed a fixture string directly.

  EUR itself isn't in the feed (it's the base) — we inject it as
  `Decimal.new("1")` so downstream rebasing doesn't have to
  special-case it.
  """
  @spec parse(binary()) :: {:ok, fetch_result()} | {:error, term()}
  def parse(xml) when is_binary(xml) do
    {doc, _rest} = :xmerl_scan.string(String.to_charlist(xml), quiet: true)

    # The ECB feed nests `<Cube>` three deep — the outer wrapper, the
    # date-bearing wrapper (`<Cube time='…'>`), and the per-currency
    # rows (`<Cube currency='X' rate='Y'/>`). xmerl's xpath honours
    # the default namespace declaration so a bare `//Cube` matches
    # every level; the attribute predicate scopes us to the rows we
    # care about.
    rates =
      :xmerl_xpath.string(~c"//Cube[@currency]", doc)
      |> Enum.reduce(%{}, &collect_rate/2)
      |> Map.put("EUR", Decimal.new("1"))

    rate_date =
      :xmerl_xpath.string(~c"//Cube[@time]", doc)
      |> List.first()
      |> extract_date()

    if map_size(rates) <= 1 do
      {:error, :no_rates_in_feed}
    else
      {:ok, %{rate_date: rate_date, rates: rates}}
    end
  rescue
    e -> {:error, {:parse_failed, Exception.message(e)}}
  end

  defp collect_rate({:xmlElement, _, _, _, _, _, _, attrs, _, _, _, _}, acc) do
    currency = attr(attrs, :currency)
    rate = attr(attrs, :rate)

    with cur when is_binary(cur) <- to_string_or_nil(currency),
         r when is_binary(r) <- to_string_or_nil(rate),
         {:ok, decimal} <- safe_decimal(r) do
      Map.put(acc, String.upcase(cur), decimal)
    else
      _ -> acc
    end
  end

  defp extract_date(nil), do: nil

  defp extract_date({:xmlElement, _, _, _, _, _, _, attrs, _, _, _, _}) do
    case attr(attrs, :time) do
      nil ->
        nil

      raw ->
        case Date.from_iso8601(to_string(raw)) do
          {:ok, date} -> date
          _ -> nil
        end
    end
  end

  # xmerl stores attribute names as atoms (`:currency`, `:rate`, …) and
  # values as charlists. The caller does its own charlist→string
  # coercion above.
  defp attr(attrs, key) when is_atom(key) do
    Enum.find_value(attrs, fn
      {:xmlAttribute, ^key, _, _, _, _, _, _, value, _} -> value
      _ -> nil
    end)
  end

  defp to_string_or_nil(nil), do: nil
  defp to_string_or_nil(list) when is_list(list), do: to_string(list)
  defp to_string_or_nil(bin) when is_binary(bin), do: bin

  defp safe_decimal(str) do
    {:ok, Decimal.new(str)}
  rescue
    _ -> :error
  end
end
