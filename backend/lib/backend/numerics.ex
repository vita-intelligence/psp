defmodule Backend.Numerics do
  @moduledoc """
  Precision-safe Float → Decimal conversions.

  Never call ``Decimal.from_float/1`` directly on user-supplied
  quantities. That helper preserves the float's binary representation
  exactly, so ``0.0004`` lands as ``0.00040000000000000002`` — the
  IEEE-754 approximation of the literal. Fine for a one-shot
  computation, poisonous for a stored qty: every subsequent
  ``Decimal.add`` / ``Decimal.sub`` on the value carries the drift,
  and a chain of bookings that should net to zero ends up flagging a
  fake ``0.0004`` shortage.

  ``from_float/1`` routes through the shortest unambiguous decimal
  string (via ``:erlang.float_to_binary/2`` with ``:compact`` +
  ``decimals: 15``), so ``0.0004`` becomes the exact
  ``#Decimal<0.0004>`` and downstream arithmetic stays clean.

  Use this whenever a qty / price / any physical-unit value could
  reach the BE as a JSON-parsed Float. Integer + string + Decimal
  inputs pass through untouched.
  """

  @doc "Coerce any numeric-ish input to a precision-safe ``Decimal``."
  def to_decimal(nil), do: nil
  def to_decimal(%Decimal{} = d), do: d
  def to_decimal(n) when is_integer(n), do: Decimal.new(n)
  def to_decimal(n) when is_float(n), do: from_float(n)

  def to_decimal(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, _} -> d
      :error -> nil
    end
  end

  def to_decimal(_), do: nil

  @doc """
  Convert a Float to Decimal without leaking IEEE-754 noise.

  ``:erlang.float_to_binary(n, [:compact, decimals: 15])`` returns the
  shortest round-trippable decimal string for ``n`` (e.g. ``"0.0004"``
  for ``0.0004``, not ``"4.0e-4"`` and not the underlying
  ``"0.00040000000000000002"``). Then ``Decimal.new/1`` parses it
  cleanly.
  """
  def from_float(n) when is_float(n) do
    n
    |> :erlang.float_to_binary([:compact, {:decimals, 15}])
    |> Decimal.new()
  end
end
