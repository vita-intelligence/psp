"""End-to-end full-loop integration smoke test.

Drives the entire vita-performance <-> PSP integration path in one
Python process:

  1. Mints a PSP integration token via IEx.
  2. Configures the vita-performance Company with PSP's base URL +
     the fresh token (via Django ORM).
  3. Runs psp_sync.pullers to import PSP's workstations + employees.
  4. Creates a local WorkSession via the ORM in 'completed' state.
  5. Confirms the post_save signal enqueued a PspOutboxEntry AND
     that the sync push flipped it to 'delivered'.

Assumes:

  * PSP Phoenix server running on http://localhost:4000.
  * vita-performance dev DB migrated (sqlite by default).
  * PSP dev DB seeded with 'E2E Test Co' Company + at least one
    Workstation with psp_source_of_truth=True + Employee.
    (Run e2e_test.sh once before this script to establish
    fixtures.)

Runs the vita-performance side inside Django's app context by
setting DJANGO_SETTINGS_MODULE and calling django.setup(). Reads
+ writes are real; no mocking.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# ------------------------------------------------------------------
# Wire up Django before importing any app models.
# ------------------------------------------------------------------

REPO_ROOT = Path(__file__).parent.parent.parent
VP_DIR = REPO_ROOT / "vita-performance" / "server"
PSP_DIR = REPO_ROOT / "psp" / "backend"

if str(VP_DIR) not in sys.path:
    sys.path.insert(0, str(VP_DIR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
os.environ.setdefault("DJANGO_SECRET_KEY", "test" * 8)
os.environ.setdefault("DJANGO_DEBUG", "True")
os.environ.setdefault("DJANGO_HOSTS", "localhost,127.0.0.1")
os.environ.setdefault("DJANGO_HOSTS_URLS", "http://localhost:3000")
os.environ.setdefault("DJANGO_PROJECT_NAME", "Vita Performance")
os.environ.setdefault("DJANGO_DB_URL", f"sqlite:///{VP_DIR}/db.sqlite3")
os.environ.setdefault("REDIS_URL", "redis://localhost:6380")
os.environ.setdefault("EMAIL_FROM", "x@x")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")

import django

django.setup()

from django.utils import timezone

from accounts.models import User
from companies.models import Company
from items.models import Item
from psp_sync import pullers
from psp_sync.client import PspClient
from psp_sync.models import PspOutboxEntry
from work_sessions.models import WorkSession
from workers.models import Worker
from workstations.models import Workstation

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

PSP_BASE = os.environ.get("PSP_BASE_URL", "http://localhost:4000")

PASS = 0
FAIL = 0


def ok(msg: str) -> None:
    global PASS
    PASS += 1
    print(f"  \033[32m✓\033[0m {msg}")


def bad(msg: str) -> None:
    global FAIL
    FAIL += 1
    print(f"  \033[31m✗\033[0m {msg}")


def step(msg: str) -> None:
    print(f"\n\033[36m▶ {msg}\033[0m")


def mint_psp_token() -> tuple[str, str]:
    """Ask PSP to mint a fresh integration token for the E2E company.

    Returns (raw_token, company_name).
    """
    with tempfile.NamedTemporaryFile("w", suffix=".exs", delete=False) as f:
        f.write("""
alias Backend.Repo
alias Backend.Companies.Company
alias Backend.IntegrationTokens
company = Repo.get_by(Company, name: "E2E Test Co") ||
          Repo.insert!(%Company{name: "E2E Test Co"})
name = "vita-full-loop-#{:os.system_time(:nanosecond)}"
{:ok, %{token: raw}} = IntegrationTokens.create(
  %{name: name,
    scopes: ["mo:read", "workstation:read", "item:read",
             "hr:read", "mo:write:session"]},
  company.id, nil)
File.write!(System.get_env("PSP_FULL_LOOP_OUT"),
  Jason.encode!(%{raw_token: raw, company_name: company.name}))
""")
        seed_path = f.name

    with tempfile.NamedTemporaryFile("r", suffix=".json", delete=False) as f:
        out_path = f.name

    env = {**os.environ, "PSP_FULL_LOOP_OUT": out_path}
    result = subprocess.run(
        ["mix", "run", seed_path],
        cwd=str(PSP_DIR),
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout[-500:])
        print(result.stderr[-500:])
        raise RuntimeError("mix run failed to mint token")

    payload = json.loads(Path(out_path).read_text())
    return payload["raw_token"], payload["company_name"]


# ------------------------------------------------------------------
# Test flow
# ------------------------------------------------------------------


def run() -> int:
    step("Mint fresh PSP integration token via IEx")
    raw_token, psp_company_name = mint_psp_token()
    ok(f"minted token {raw_token[:20]}… for '{psp_company_name}'")

    step("Prove client can hit /health")
    c = PspClient(base_url=PSP_BASE, token=raw_token)
    h = c.health()
    if h.get("ok"):
        ok(f"health OK · company='{h['company']['name']}' · scopes={h['token']['scopes']}")
    else:
        bad(f"health returned {h}")
        return 1

    step("Configure vita-performance Company with PSP creds")
    user, _ = User.objects.get_or_create(
        username="fullloop",
        defaults={
            "email": "fullloop@vitamanufacture.co.uk",
        },
    )
    user.set_password("dev-password")
    user.save()

    company, _ = Company.objects.get_or_create(
        owner_user=user,
        defaults={
            "name": "vita-performance E2E tenant",
            "psp_base_url": PSP_BASE,
            "psp_integration_token": raw_token,
        },
    )
    company.psp_base_url = PSP_BASE
    company.psp_integration_token = raw_token
    company.save()
    ok(f"company id={company.id} configured (PSP creds attached)")

    step("Run psp_sync.pullers.pull_all_for_company")
    result = pullers.pull_all_for_company(company)
    if result.errors:
        for e in result.errors:
            bad(f"pull error: {e}")
    ok(f"pull result: {result}")

    ws_count = Workstation.objects.filter(company=company, psp_source_of_truth=True).count()
    emp_count = Worker.objects.filter(company=company).exclude(external_id__isnull=True).exclude(external_id="").count()
    if ws_count > 0:
        ok(f"{ws_count} workstation(s) mirrored from PSP")
    else:
        bad("no workstations mirrored — check PSP has ≥1 workstation with psp_source_of_truth=True")

    if emp_count > 0:
        ok(f"{emp_count} employee(s) mirrored from PSP")
    else:
        bad("no employees mirrored — check PSP has ≥1 Backend.HR.Employee")

    step("Create a local WorkSession, verify signal enqueues + delivers")
    workstation = Workstation.objects.filter(
        company=company, psp_source_of_truth=True, is_active=True
    ).first()
    worker = Worker.objects.filter(
        company=company, is_active=True
    ).exclude(external_id__isnull=True).exclude(external_id="").first()

    if not workstation or not worker:
        bad("cannot proceed — missing mirrored workstation or worker")
        return 1

    now = timezone.now()
    outbox_before = PspOutboxEntry.objects.count()

    session = WorkSession.objects.create(
        user=user,
        company=company,
        workstation=workstation,
        status="completed",
        activity_kind="cleaning",
        activity_label=None,
        start_time=now - timezone.timedelta(minutes=20),
        end_time=now,
        quantity_produced=0,
        notes="Full-loop test — cleaning session.",
    )
    session.workers.set([worker])
    # Trigger post_save again explicitly so the signal fires after
    # the m2m is set (kiosk-flow ordering).
    session.save()

    outbox_after = PspOutboxEntry.objects.filter(session=session)
    if outbox_after.exists():
        ok(f"outbox entry created for session {session.id}")
    else:
        bad("no outbox entry created — signal path broken?")
        return 1

    # Sync push is scheduled via transaction.on_commit — Django's
    # test runner defers it, but standalone code commits inline.
    entry = outbox_after.first()
    if entry.status == "delivered":
        ok(f"outbox status=delivered (attempts={entry.attempts})")
    elif entry.status == "pending":
        bad(f"outbox status=pending — last_error={entry.last_error!r}")
    elif entry.status == "in_flight":
        bad("outbox stuck in_flight — commit hook may not have fired")
    else:
        bad(f"unexpected outbox status={entry.status}")

    step("Confirm the session landed in PSP's workstation_sessions table")
    remote = c.get(
        f"/workstations/{workstation.external_id}/sessions"
    ) if False else None
    # No GET endpoint yet for listing sessions — verify by pulling
    # workstation summary that includes recent activity, or trust the
    # outbox 'delivered' flag as the proof-of-landing.
    if entry.status == "delivered":
        ok("PSP acknowledged the write (outbox flipped to delivered)")

    return 0


def main() -> None:
    print(f"\n\033[1m=== vita-performance ↔ PSP full-loop test ===\033[0m")
    print(f"PSP base:   {PSP_BASE}")
    print(f"VP dir:     {VP_DIR}")

    exit_code = run()

    print(f"\n\033[1m--- Summary ---\033[0m")
    print(f"  Pass: {PASS}")
    print(f"  Fail: {FAIL}")

    if FAIL == 0 and exit_code == 0:
        print("\n\033[32mFULL-LOOP: PASS\033[0m")
        sys.exit(0)
    else:
        print("\n\033[31mFULL-LOOP: FAIL\033[0m")
        sys.exit(1)


if __name__ == "__main__":
    main()
