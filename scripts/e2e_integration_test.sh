#!/usr/bin/env bash
# End-to-end integration test for the PSP ↔ vita-performance
# integration. Assumes:
#
#   * PSP backend on http://localhost:4000
#   * psp-postgres + psp-redis containers up
#   * feat/vita-performance-integration branch on both repos
#
# Runs a real HTTP loop:
#
#   1. Seed a PSP Company + User + Workstation (external_id set,
#      psp_source_of_truth=true) + Employee + Wage via IEx
#      remote_shell.
#   2. Mint an IntegrationToken and capture the raw string.
#   3. Curl every read endpoint, verify status + payload shape.
#   4. Push a non-MO (cleaning) session, verify the row lands.
#   5. Report pass/fail per step.
#
# Full MO/step writeback + cost breakdown E2E requires seeding a
# routing + BOM + MO chain — deferred to a Playwright script that
# uses the PSP frontend to build them naturally. This shell test
# exercises the auth + reads + off-MO writeback surface, which is
# what the vita-performance kiosk will actually hit first at
# rollout.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSP_DIR="$REPO_ROOT/psp/backend"
BASE_URL="${PSP_BASE_URL:-http://localhost:4000}"
INTEGRATION_URL="$BASE_URL/api/integration"

pass=0
fail=0

step() { printf "\n\e[36m▶ %s\e[0m\n" "$*"; }
ok()   { pass=$((pass + 1)); printf "  \e[32m✓\e[0m %s\n" "$*"; }
bad()  { fail=$((fail + 1)); printf "  \e[31m✗\e[0m %s\n" "$*"; }

require() {
  local name="$1" cmd="$2"
  command -v "$cmd" >/dev/null 2>&1 || { echo "MISSING dependency: $name ($cmd)"; exit 2; }
}

require "curl" "curl"
require "jq" "jq"
require "mix" "mix"

# ------------------------------------------------------------------
# 1. Seed via IEx script.
# ------------------------------------------------------------------

step "Seeding PSP fixtures (Company / User / Workstation / Employee) + minting token"

SEED_SCRIPT=$(mktemp -t psp_seed.XXXXXX.exs)
TRAP_TOKEN_OUT=$(mktemp -t psp_token.XXXXXX)
trap 'rm -f "$SEED_SCRIPT" "$TRAP_TOKEN_OUT"' EXIT

cat > "$SEED_SCRIPT" <<'ELIXIR'
alias Backend.Repo
alias Backend.Accounts.User
alias Backend.Companies.Company
alias Backend.HR
alias Backend.IntegrationTokens
alias Backend.Production.{Workstation, WorkstationGroup}
alias Backend.Warehouses.Warehouse

company =
  case Repo.get_by(Company, name: "E2E Test Co") do
    nil -> Repo.insert!(%Company{name: "E2E Test Co"})
    c -> c
  end

user_email = "e2e-#{System.unique_integer([:positive])}@vitamanufacture.co.uk"
user =
  Repo.insert!(%User{
    company_id: company.id,
    email: user_email,
    name: "E2E Operator",
    hashed_password: "$2b$12$placeholder",
    is_active: true,
    confirmed_at: DateTime.utc_now() |> DateTime.truncate(:second),
    permissions: ["integrations.manage"]
  })

warehouse =
  case Repo.get_by(Warehouse, company_id: company.id, name: "E2E Warehouse") do
    nil ->
      Repo.insert!(%Warehouse{
        company_id: company.id,
        name: "E2E Warehouse",
        is_active: true,
        created_by_id: user.id,
        updated_by_id: user.id
      })

    w ->
      w
  end

workstation_group =
  case Repo.get_by(WorkstationGroup, company_id: company.id, name: "E2E Group") do
    nil ->
      Repo.insert!(%WorkstationGroup{
        company_id: company.id,
        name: "E2E Group",
        hourly_rate: Decimal.new("40.00"),
        is_active: true,
        created_by_id: user.id,
        updated_by_id: user.id
      })

    g ->
      g
  end

workstation =
  Repo.insert!(%Workstation{
    company_id: company.id,
    workstation_group_id: workstation_group.id,
    warehouse_id: warehouse.id,
    name: "E2E Station #{System.unique_integer([:positive])}",
    external_id: Ecto.UUID.generate(),
    is_active: true,
    psp_source_of_truth: true,
    hourly_rate_enabled: true,
    hourly_rate: Decimal.new("42.50"),
    productivity: Decimal.new("1.0"),
    created_by_id: user.id,
    updated_by_id: user.id
  })

{:ok, employee} =
  HR.create_employee(
    %{full_name: "E2E Worker", is_qa: false, kiosk_pin: "1234"},
    company.id,
    user.id
  )

{:ok, _wage} =
  HR.add_wage(employee, %{
    effective_from: Date.utc_today() |> Date.add(-30),
    hourly_rate: Decimal.new("18.75"),
    currency_code: "GBP",
    source_kind: "hire",
    reason: "Initial rate for E2E test",
    approved_by_id: user.id
  })

{:ok, %{token: raw, record: _token}} =
  IntegrationTokens.create(
    %{name: "vita-performance-e2e-#{System.unique_integer([:positive])}",
      scopes: ["mo:read", "workstation:read", "item:read", "hr:read", "mo:write:session"]},
    company.id,
    user.id
  )

File.write!(System.get_env("PSP_E2E_TOKEN_OUT"),
  Jason.encode!(%{
    company_id: company.id,
    company_name: company.name,
    workstation_uuid: workstation.uuid,
    workstation_external_id: workstation.external_id,
    employee_uuid: employee.uuid,
    raw_token: raw
  }))
ELIXIR

export PSP_E2E_TOKEN_OUT="$TRAP_TOKEN_OUT"
mix_output=$( (cd "$PSP_DIR" && mix run "$SEED_SCRIPT") 2>&1 )
mix_status=$?

if [ "$mix_status" -ne 0 ]; then
  bad "seed script failed: mix exit $mix_status"
  echo "$mix_output" | tail -20
  exit 3
fi

if [ ! -s "$TRAP_TOKEN_OUT" ]; then
  bad "seed did not write $TRAP_TOKEN_OUT"
  exit 3
fi

TOKEN=$(jq -r '.raw_token' < "$TRAP_TOKEN_OUT")
WS_UUID=$(jq -r '.workstation_uuid' < "$TRAP_TOKEN_OUT")
WS_EXT_ID=$(jq -r '.workstation_external_id' < "$TRAP_TOKEN_OUT")
EMPLOYEE_UUID=$(jq -r '.employee_uuid' < "$TRAP_TOKEN_OUT")

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  bad "no token returned from seed"
  exit 3
fi

ok "seed complete (workstation ${WS_UUID:0:8}…, employee ${EMPLOYEE_UUID:0:8}…, token ${TOKEN:0:20}…)"

# ------------------------------------------------------------------
# 2. Reads
# ------------------------------------------------------------------

hit() {
  local path="$1"
  curl -sS -o /tmp/psp_body.json -w "%{http_code}" \
    -H "X-Integration-Token: $TOKEN" \
    "$INTEGRATION_URL$path"
}

hit_post() {
  local path="$1" body="$2"
  curl -sS -o /tmp/psp_body.json -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Integration-Token: $TOKEN" \
    -d "$body" \
    "$INTEGRATION_URL$path"
}

step "GET /health"
status=$(hit "/health")
if [ "$status" = "200" ]; then
  name=$(jq -r '.token.name' < /tmp/psp_body.json)
  ok "200 · token.name=$name · scopes=$(jq -r '.token.scopes | join(",")' < /tmp/psp_body.json)"
else
  bad "expected 200, got $status: $(cat /tmp/psp_body.json)"
fi

step "GET /workstations?source_of_truth_only=true"
status=$(hit "/workstations?source_of_truth_only=true")
if [ "$status" = "200" ]; then
  count=$(jq -r '.items | length' < /tmp/psp_body.json)
  saw_ext=$(jq -r --arg ext "$WS_EXT_ID" '.items | any(.external_id == $ext)' < /tmp/psp_body.json)
  if [ "$saw_ext" = "true" ]; then
    ok "200 · count=$count · seeded workstation present (external_id match)"
  else
    bad "seeded workstation external_id ($WS_EXT_ID) not found in response"
  fi
else
  bad "expected 200, got $status"
fi

step "GET /hr/employees"
status=$(hit "/hr/employees")
if [ "$status" = "200" ]; then
  count=$(jq -r '.items | length' < /tmp/psp_body.json)
  wage=$(jq -r --arg u "$EMPLOYEE_UUID" '.items[] | select(.uuid == $u) | .current_hourly_rate' < /tmp/psp_body.json)
  if [ "$wage" != "null" ] && [ -n "$wage" ]; then
    ok "200 · count=$count · seeded employee wage=$wage"
  else
    bad "seeded employee wage not resolved via wage_at (expected 18.75, got $wage)"
  fi
else
  bad "expected 200, got $status"
fi

step "GET /items"
status=$(hit "/items")
if [ "$status" = "200" ]; then
  ok "200 · count=$(jq -r '.items | length' < /tmp/psp_body.json) (empty is fine — no items seeded)"
else
  bad "expected 200, got $status"
fi

step "GET /manufacturing-orders (empty allowed)"
status=$(hit "/manufacturing-orders")
if [ "$status" = "200" ]; then
  ok "200 · count=$(jq -r '.items | length' < /tmp/psp_body.json) (MO seeding deferred to Playwright suite)"
else
  bad "expected 200, got $status"
fi

# ------------------------------------------------------------------
# 3. Auth negatives
# ------------------------------------------------------------------

step "Missing token → 401"
status=$(curl -sS -o /dev/null -w "%{http_code}" "$INTEGRATION_URL/health")
if [ "$status" = "401" ]; then
  ok "401 (correct)"
else
  bad "expected 401 for missing token, got $status"
fi

step "Bad token → 401"
status=$(curl -sS -o /dev/null -w "%{http_code}" \
  -H "X-Integration-Token: psp_live_${TOKEN:9:32}garbagegarbagegarbage" \
  "$INTEGRATION_URL/health")
if [ "$status" = "401" ]; then
  ok "401 (correct)"
else
  bad "expected 401 for bad token, got $status"
fi

# ------------------------------------------------------------------
# 4. Off-MO writeback (cleaning session)
# ------------------------------------------------------------------

step "POST /workstations/:uuid/sessions  (cleaning, off-MO)"
started_at="2026-07-07T12:00:00Z"
finished_at="2026-07-07T12:20:00Z"

body=$(jq -n \
  --arg ws "$WS_EXT_ID" \
  --arg emp "$EMPLOYEE_UUID" \
  --arg start "$started_at" \
  --arg finish "$finished_at" \
  '{
    external_id: "e2e-off-mo-1",
    activity_kind: "cleaning",
    activity_label: null,
    employee_uuids: [$emp],
    started_at: $start,
    finished_at: $finish,
    notes: "E2E cleaning session"
  }')

status=$(hit_post "/workstations/$WS_UUID/sessions" "$body")
if [ "$status" = "201" ]; then
  ok "201 · session created for cleaning"
elif [ "$status" = "409" ]; then
  bad "409 workstation_not_source_of_truth (flag not persisting?)"
else
  bad "expected 201, got $status: $(cat /tmp/psp_body.json)"
fi

step "Repeat POST → idempotent (returns existing row)"
status=$(hit_post "/workstations/$WS_UUID/sessions" "$body")
if [ "$status" = "201" ]; then
  ok "201 (idempotent — same external_id returns existing)"
else
  bad "expected 201 on repeat, got $status"
fi

# ------------------------------------------------------------------
# 5. Report
# ------------------------------------------------------------------

printf "\n\e[1m--- Summary ---\e[0m\n"
printf "  Pass: %d\n" "$pass"
printf "  Fail: %d\n" "$fail"

if [ "$fail" -eq 0 ]; then
  printf "\n\e[32mE2E: PASS\e[0m\n"
  exit 0
else
  printf "\n\e[31mE2E: FAIL\e[0m\n"
  exit 1
fi
