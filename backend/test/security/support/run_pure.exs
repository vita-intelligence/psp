# Standalone runner for the DB-free security regression tests.
#
# Invoked via `mix test.security.pure`. Bypasses the main `test`
# alias (which insists on `ecto.create` before running anything) so
# these tests are useful in CI stages that don't spin Postgres and
# locally when Docker isn't up.
#
# Adds a new file? Add it here.

ExUnit.start()

for file <- [
      "test/security/content_disposition_test.exs",
      "test/security/mime_sniffer_test.exs",
      "test/security/upload_validation_test.exs",
      "test/security/csv_escape_test.exs",
      "test/security/stock_lot_sort_test.exs",
      "test/security/http_rate_limit_test.exs",
      "test/security/security_log_test.exs"
    ] do
  Code.require_file(file)
end

ExUnit.run()
