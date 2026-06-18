# Handover — Production Schedule + Click-to-Edit Dialog

Last touched: 2026-06-18. Last commit: `a285fcf`.

## What this is

PSP — procurement / stock / production app for Vita Manufacture
(`vitamanufacture.co.uk`). Phoenix 1.8 + Ecto 3.14 backend, Next.js 16
+ Turbopack frontend, PostgreSQL.

## Where to pick up

Just shipped the **click-to-edit dialog** on calendar blocks
(`/production/schedule`). Click any block → modal opens scoped to:

- **Project block** → all MOs in chain + every op + every segment
- **MO block** → that MO's ops + segments
- **Op block** → that single op

Each op renders as editable **work rows** (datetime-local Start +
Finish) with **pause rows** between them (editable duration: typing
`1h 30m`, `90m`, `01:30`, `1.5h`, `0`, etc. shifts subsequent rows
by the delta).

The 4 phases (A–D) all landed:

- `6230c91` — BE schema + endpoint
- `c088916` — FE dialog shell + click handlers
- `cee24d7` — editing + realtime collab + save
- `3bd14af` — calendar blocks render manual pauses from segments
- `2f3fa77` — editable pause length + dropped past-time gate + field-error display
- `a285fcf` — fixed 404 by routing save through server action

**Next thing to verify with user**: that Save now lands BE-side after
the 404 fix. The dev server (FE) was wedged earlier in the session
on port 3000 — Turbopack stuck after many file changes. May need a
restart before testing.

## Critical files

### Backend
- `backend/lib/backend/production/manufacturing_order_step.ex` — schema, `planned_segments` jsonb field + changeset validation (no overlap, chronological)
- `backend/lib/backend/production.ex` — `set_mo_step_segments/3` (around line 1840), `move_mo_step/4` (line 1771)
- `backend/lib/backend_web/controllers/manufacturing_order_step_controller.ex` — `set_segments/2` + `move/2`
- `backend/lib/backend_web/channels/form_channel.ex` — collab gates, includes `"project"`, `"manufacturing-order"`, `"manufacturing-order-step"` clauses
- `backend/lib/backend_web/payloads.ex` — `mo_step/1` + `schedule_operation/1` both include `planned_segments`
- `backend/priv/repo/migrations/20260618150000_add_planned_segments_to_mo_steps.exs`

### Frontend
- `client/src/app/production/schedule/schedule-workspace.tsx` — main page wrapper, holds dialog state + parentByMo map + workingIntervals, owns DnD context + sensors (`PointerSensor` distance: 4)
- `client/src/app/production/schedule/schedule-edit-dialog.tsx` — the dialog. `ScheduleEditDialog` → `ScheduleEditDialogInner` (only mounts when open so we don't hold a channel for closed dialog)
- `client/src/app/production/schedule/schedule-shared.ts` — `walkForwardClient` (TS port of Elixir walker), `pausesFromWorkSpans`, `workSpansForOps`, `anyOpHasManualSegments`, contexts (`ScheduleEditContext`, `LivePreviewContext`, `DragBoundsContext`, `WorkingIntervalsContext`, `ScheduleScaleContext`)
- `client/src/app/production/schedule/schedule-view-{mo,project,workstation}.tsx` — the three view variants + their block components (`MOblock`, `ProjectBlock`, `OperationBlock`). Each has an onClick → `editor?.openEditor({kind, uuid})`.
- `client/src/lib/production/actions.ts` — `setManufacturingOrderStepSegmentsAction` (around line 871) is the server action used by Save.

## HARD RULES — non-negotiable

Reread `psp/CLAUDE.md` before editing forms. The two big ones:

1. **Every editable form is realtime + collaborative.** Mandatory
   pattern: `useLiveForm` + `CollabAvatars` + `FieldEditingIndicator`
   + `RemoteCursor` + head-of-room save gate + `JoinErrorCard`. Copy
   from `client/src/app/settings/warehouses/warehouse-form.tsx`. The
   click-to-edit dialog follows this — keep it that way.

2. **Compliance-first field design.** No status `<Select>`s — workers
   trigger ACTIONS that emit events; the system projects the status.
   Computed values are read-only with override toggle. Notes that are
   discussions → Comments module. Documents → file uploads, not URLs.
   `set_mo_step_segments` is the "manual override" path — audit
   captures every change, walker stays out.

## User working style (learned this session)

- **Iterates fast.** Wants visible progress every few minutes. Break
  big work into phases, commit per phase.
- **Terse.** No long preambles, no recaps, no "I'll now..." narration.
  One sentence per update, results-first.
- **NEVER add AI attribution to commits.** No `Co-Authored-By: Claude`,
  no 🤖 emoji, no "Generated with Claude Code" footer.
- **No `./deploy.sh` on own initiative.** Wait for explicit request.
- **PSP DB cleanup is targeted only — never `TRUNCATE`.**
- **Registration locked to `@vitamanufacture.co.uk`.**
- **UUIDs in URLs / APIs / channels — never integer PKs.**
- **Tests with real DB — no mocks** (from prior incident with broken migration that mocked tests missed).

## Dev environment quirks

- BE on port `4000` (Phoenix). FE on `3000` (Next.js + Turbopack).
- Postgres: db `psp_dev`, user `psp`, password `psp_dev`.
- Playwright auth fixtures at `client/.auth/{maksym,alt,laptop,phone}.json`.
  For user's own session use `maksym.json`. Run smoke scripts FROM the
  `client/` dir so `node_modules/playwright` resolves.
- API calls from the FE go via **server actions** (`"use server"` in
  `client/src/lib/*/actions.ts`) which use the `api()` helper to
  forward to Phoenix. Don't `fetch("/api/...")` directly from a client
  component — Next.js owns `/api/*` and you'll 404.
- Pre-existing TS errors in `client/src/lib/production/actions.ts`
  (TS2783 "ok specified more than once" object-spread complaints) —
  unrelated to current work, don't get distracted.
- Pre-existing BE warnings in `stock_lot_controller.ex` (duplicate
  `@doc` lines) and `audit_controller.ex` — not yours.

## Likely next asks

Watch for any of these — they were in scope or adjacent:

- **Per-pause peer indicator** — pause row currently has no
  `FieldEditingIndicator`; the per-row indicator on the work row
  covers it transitively. CLAUDE.md hard rule says every input
  should have one, so likely to come up.
- **Restore from audit** — `subscribeRestore("manufacturing_order_step", id, ...)`
  not wired in the dialog. The warehouse-form does it.
- **Date column in segment rows** — currently `<input type="datetime-local">`
  uses browser locale; company `date_format` is bypassed. If the user
  wants company-formatted dates alongside the inputs, add a read-only
  text column using `formatCompanyDate`.
- **Segment overlap warning in dialog** — BE rejects on save, but
  the dialog should highlight overlapping rows before Save so the
  user doesn't waste a round-trip.
- **Drag-to-edit-pause directly on calendar** — currently you can drag
  a block (whole-MO) but resizing the paused gap requires the modal.
  Possible request: drag-resize on segments.

## Domain mental model

- An **MO** (manufacturing order) is one production batch. Has many
  **steps** (operations) each tied to a **workstation group**.
- MOs chain via `parent_mo_id` — sub-MOs feed their parent. A
  **project** = MO chain rooted at an MO with `parent_mo_id = nil`.
- The **walker** (`Backend.Production.ScheduleWalker.walk_forward/3`)
  takes a list of working intervals + a cursor + a duration, and
  places the work segment-by-segment, skipping closed time. Returns
  `{start_at, finish_at, segments, outside_hours_seconds}`.
- A step's `planned_segments` (NEW this session) overrides the walker
  when set — literal pinned times the planner typed. NULL → walker
  derives at render time.
- Calendar blocks at three zooms: **day** (1d / 1920px), **week**
  (14d / 240px/day), **month** (84d / 60px/day). Defined in
  `ZOOM_PRESETS` in `schedule-shared.ts`.
- Head-of-room ("creator") = earliest joiner of the form channel.
  Only they can hit Save / Delete. Everyone else sees a banner.

## When in doubt

- `git log --oneline -20` — recent commits explain the why.
- `psp/CLAUDE.md` — project rules. Reread before editing forms.
- Existing canonical form: `client/src/app/settings/warehouses/warehouse-form.tsx`.
- Existing canonical list-page presence: `client/src/app/settings/warehouses/active-sessions.tsx`.
- Schedule walker tests / examples: search for `ScheduleWalker.walk_forward` in tests.
