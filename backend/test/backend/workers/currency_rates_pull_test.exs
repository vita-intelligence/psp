defmodule Backend.Workers.CurrencyRatesPullTest do
  use Backend.DataCase, async: false

  alias Backend.Audit.AuditEvent
  alias Backend.Companies
  alias Backend.Companies.Company
  alias Backend.Repo
  alias Backend.Workers.CurrencyRatesPull
  alias Backend.Workers.EcbClient

  # Snapshot of a real ECB feed payload, trimmed to the currencies the
  # rebase math needs to exercise. Order and time match the live feed
  # (USD first, GBP somewhere mid-list) so any future parser tweak
  # that's sensitive to attribute ordering catches the difference.
  @ecb_fixture """
  <?xml version="1.0" encoding="UTF-8"?>
  <gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"
                   xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
    <gesmes:subject>Reference rates</gesmes:subject>
    <gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
    <Cube>
      <Cube time='2026-06-10'>
        <Cube currency='USD' rate='1.0800'/>
        <Cube currency='JPY' rate='170.00'/>
        <Cube currency='GBP' rate='0.8500'/>
        <Cube currency='CHF' rate='0.9700'/>
      </Cube>
    </Cube>
  </gesmes:Envelope>
  """

  describe "EcbClient.parse/1" do
    test "extracts currencies + rates + date and injects EUR=1" do
      assert {:ok, %{rate_date: ~D[2026-06-10], rates: rates}} =
               EcbClient.parse(@ecb_fixture)

      assert Decimal.equal?(rates["USD"], Decimal.new("1.0800"))
      assert Decimal.equal?(rates["GBP"], Decimal.new("0.8500"))
      assert Decimal.equal?(rates["EUR"], Decimal.new("1"))
      assert map_size(rates) == 5
    end

    test "errors on an empty feed" do
      empty = """
      <?xml version="1.0" encoding="UTF-8"?>
      <gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
        <Cube/>
      </gesmes:Envelope>
      """

      assert {:error, :no_rates_in_feed} = EcbClient.parse(empty)
    end
  end

  describe "rebase/2" do
    test "EUR base passes through unchanged (with EUR row dropped)" do
      {:ok, %{rates: eur_rates}} = EcbClient.parse(@ecb_fixture)
      assert {:ok, rebased} = CurrencyRatesPull.rebase(eur_rates, "EUR")

      assert Decimal.equal?(rebased["USD"], Decimal.new("1.08000000"))
      assert Decimal.equal?(rebased["GBP"], Decimal.new("0.85000000"))
      refute Map.has_key?(rebased, "EUR")
    end

    test "rebases EUR-keyed feed onto GBP" do
      {:ok, %{rates: eur_rates}} = EcbClient.parse(@ecb_fixture)
      assert {:ok, rebased} = CurrencyRatesPull.rebase(eur_rates, "GBP")

      # 1 GBP = (1/0.85) EUR = 1.17647059 EUR
      assert Decimal.equal?(rebased["EUR"], Decimal.new("1.17647059"))
      # 1 GBP = (1.08 / 0.85) USD = 1.27058824 USD
      assert Decimal.equal?(rebased["USD"], Decimal.new("1.27058824"))
      refute Map.has_key?(rebased, "GBP")
    end

    test "errors when the base currency isn't in the feed" do
      {:ok, %{rates: eur_rates}} = EcbClient.parse(@ecb_fixture)

      assert {:error, :unknown_base_currency} =
               CurrencyRatesPull.rebase(eur_rates, "XYZ")
    end
  end

  describe "run_now/1 — end-to-end" do
    setup do
      stub_name = String.to_atom("ecb-#{System.unique_integer([:positive])}")

      Req.Test.stub(stub_name, fn conn ->
        Plug.Conn.put_resp_header(conn, "content-type", "application/xml")
        |> Plug.Conn.resp(200, @ecb_fixture)
      end)

      # Singleton — `Companies.current/0` creates lazily on first call.
      company = Companies.current()

      {:ok, stub: stub_name, company: company}
    end

    test "writes rates rebased to the company's base currency", %{
      stub: stub,
      company: company
    } do
      # Base GBP — what's in the bootstrap row by default.
      assert company.currency_code == "GBP"

      assert {:ok, %{processed: 1, skipped: 0}} =
               CurrencyRatesPull.run_now(req_options: [plug: {Req.Test, stub}])

      reloaded = Repo.get!(Company, company.id)
      assert reloaded.currency_rates_source == "ecb_auto"
      assert %DateTime{} = reloaded.currency_rates_pulled_at

      rates_by_currency =
        reloaded.currency_rates["rates"]
        |> Enum.into(%{}, fn %{"currency" => c, "rate" => r} -> {c, r} end)

      # Sanity-check one rebased value end-to-end. The full math is
      # exercised by the rebase/2 tests above.
      eur_rate = Decimal.new(rates_by_currency["EUR"])
      assert Decimal.equal?(eur_rate, Decimal.new("1.17647059"))
    end

    test "skips companies with auto-pull disabled", %{
      stub: stub,
      company: company
    } do
      {:ok, _} =
        Companies.update_auto_pull(
          company,
          %{currency_rates_auto_pull: false},
          nil
        )

      assert {:ok, %{processed: 0, skipped: 1}} =
               CurrencyRatesPull.run_now(req_options: [plug: {Req.Test, stub}])

      reloaded = Repo.get!(Company, company.id)
      # Untouched — `currency_rates_source` stays at the bootstrap
      # default since the cron never wrote anything.
      assert reloaded.currency_rates_source == "manual"
      assert reloaded.currency_rates == %{}
      assert is_nil(reloaded.currency_rates_pulled_at)
    end

    test "two consecutive pulls on the same day are idempotent", %{
      stub: stub,
      company: _company
    } do
      assert {:ok, _} =
               CurrencyRatesPull.run_now(req_options: [plug: {Req.Test, stub}])

      audits_after_first =
        from(e in AuditEvent,
          where: e.entity_type == "company",
          where: e.event == "updated"
        )
        |> Repo.aggregate(:count, :id)

      assert {:ok, _} =
               CurrencyRatesPull.run_now(req_options: [plug: {Req.Test, stub}])

      audits_after_second =
        from(e in AuditEvent,
          where: e.entity_type == "company",
          where: e.event == "updated"
        )
        |> Repo.aggregate(:count, :id)

      # Second pull writes the same values → empty diff → audit
      # helper returns :noop, so no second audit row.
      assert audits_after_first == audits_after_second
    end

    test "audit row carries the system actor snapshot", %{
      stub: stub,
      company: _company
    } do
      assert {:ok, _} =
               CurrencyRatesPull.run_now(req_options: [plug: {Req.Test, stub}])

      [audit] =
        from(e in AuditEvent,
          where: e.entity_type == "company",
          where: e.event == "updated",
          order_by: [desc: e.at]
        )
        |> Repo.all()

      assert audit.actor_snapshot["kind"] == "system"
      assert audit.actor_snapshot["source"] == "ecb_auto"
      assert is_nil(audit.actor_id)
    end
  end
end
