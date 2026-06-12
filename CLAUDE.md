# PSP — Project Rules

## HARD RULE: every editable form is realtime + collaborative ("head of room" pattern)

**Before you write any new form, OR touch any existing one, ask: does this allow a user to save or delete data? If yes, the realtime collab pattern is mandatory.** This rule is the #1 source of regressions in this codebase. You will forget it. Re-read this section every time.

Every form gated by an edit/create capability MUST support live multi-user collaboration. If a user has permission to edit, they MUST see in real time:

- **Who else** is in the form (header avatar stack — `<CollabAvatars />`)
- **Which field** each peer is focused on (per-input indicator — `<FieldEditingIndicator />`)
- **Where their cursor** is on the form (live cursor overlay — `<RemoteCursor />`)
- **Who is "head of room"** — the earliest joiner. **Only the head of room can hit Save or Delete the record.** Everyone else gets a `<CreatorLockBanner />` and inert buttons. This is the collision-prevention mechanism — without it, two simultaneous saves race.

Up to **10 simultaneous editors** per form (`MAX_COLLABORATORS = 10`, mirrored server-side as `@default_room_limit`).

This applies to: vendor forms, PO forms, PO line dialogs, qualification dialogs, invoice forms, certificate dialogs, settings sub-forms, item forms, lot forms, role forms, attribute-definition forms, storage-tag forms, role/user-access matrices — every single one. New forms ship with collab on day one; existing non-collab forms get migrated when next touched. No exceptions for "simple" forms — they grow.

### Pattern source of truth

Copy from these two files. Don't reinvent.

- `client/src/app/settings/warehouses/warehouse-form.tsx` — the canonical form
- `client/src/app/settings/warehouses/active-sessions.tsx` — list-page presence banner + per-row badge

Backend channel: `backend/lib/backend_web/channels/form_channel.ex` — one channel for everything, topic shape `"form:<resource>:<id>"` (e.g. `"form:vendor:abc-uuid"` / `"form:vendor:new"`).

### Required wiring on every form

1. **State via `useLiveForm<FormState>`** from `@/lib/realtime/use-live-form`. Pass:
   - `resource: "<entity>:<uuid>"` (or `"<entity>:new"`)
   - `disabled: !canEdit` — viewers skip the channel entirely
   - `initialState`
   - `onCommit` — handles a `{ kind: "created", uuid, name } | { kind: "saved", state }` discriminated union from peers
2. **`useFormPresenceBeacon(resource)`** so the list page shows "X is editing" badges.
3. **`<CollabAvatars peers={presence} />`** in the card header.
4. **Every input** wired through `focusField` / `blurField` with `<FieldEditingIndicator peer={fieldEditors.<field>} />` next to it. Use the `CollabRow` / `CollabTextareaRow` helpers from `warehouse-form.tsx` as the model.
5. **Remote cursors** anchored to the form Card via a ref + `onMouseMove` → `setCursor(x, y)` (normalised 0..1), `onMouseLeave` → `hideCursor()`, and a `ResizeObserver` for anchor size. Cursor layer: `absolute inset-0 z-30 overflow-hidden rounded-xl pointer-events-none`.
6. **Head-of-room gate (= `isCreator`)** — only the earliest joiner ("head of room") may finalise. Save AND Discard buttons disabled for non-creators with the "Only {creator.name} can save…" banner. Non-creator clicks never hit the server. This is the collision-prevention rule — without the gate, two peers' simultaneous saves race and one set of edits silently wins. **Delete** the record itself follows the same gate (head of room only).
7. **On successful save**: call `broadcastCommit({...})` AND `invalidateAudit(entity, id)` from `@/lib/audit/invalidator` so peers refresh their Activity card.
8. **Restore integration** (edit forms): `subscribeRestore(entity, id, ...)` so "Restore version" on an Activity row pushes state into the form.
9. **`<JoinErrorCard error={joinError} />`** when the channel join fails (`form_full` / `forbidden` / `bad_topic` / `unknown`). Never render a broken form.
10. **List page** renders `<ActiveSessionsBanner />` at the top and per-row `<EditorsBadge entityUuid=... />` (mirror `WarehouseEditorsBadge`).

### Backend wiring for a new resource

The channel is generic. To enable a new resource:

1. Add a `defp can_edit_resource?(user, "<resource>"), do: ...` clause in `form_channel.ex`. **Without this clause the channel returns `forbidden`** and the form is unusable.
2. (Optional) Add a `room_limit_for/1` clause if the default 10 is wrong (e.g. plan editor).

### Permission gating

- No edit perm → don't join the channel (`disabled: !canEdit`). Form renders read-only from server fetch.
- Viewers see NO presence chips, NO cursors, NO field indicators. Correct.

### When NOT to apply

- Read-only detail pages (no fields to edit, no Save button).
- One-shot system actions with no user input (e.g. "Refresh ECB rates", "Approve PO" confirm).
- Modals that close on save in <5s with a single field — too short-lived to justify a channel.

Everything else: use the pattern.

### HARD RULE: every monetary field reads from `/settings/company`

**Don't hardcode currency anywhere.** Money displayed, stored, or computed must respect:
- `company.currency_code` (the base currency — GBP for Vita) as the default
- `company.currency_rates` (the bag of `{currency, rate}` rows) for FX conversion
- `company.tax_rate` for default tax %
- `company.decimal_separator` / `thousands_separator` / `currency_format` for display
- `company.csv_separator` for CSV exports

Use `formatCompanyMoney` from `client/src/lib/format/company.ts` for display. Use `company.currency_rates` (not a hardcoded table) when converting between currencies. If a place needs a currency input, use `<CurrencyPicker />` from `client/src/components/forms/currency-picker.tsx`, not a hardcoded `<Select>`. **If a feature looks like it ignores company settings, fix the feature — don't add another setting.**

Same goes for company-wide settings in general: dates (`date_format`, `first_day_of_week`), numbering (`numbering_formats`), working hours, holidays, allowed IPs. The settings page is the source of truth — every consumer reads from there.

---

## HARD RULE: compliance-first field design

Workers using PSP are following procedures. The system enforces the procedure — workers can't take shortcuts that break traceability, food-safety, or financial integrity. Every form must pass this five-point check before it ships.

### 1. Workers trigger ACTIONS, not states

A status `<Select>` that lets a worker pick "received / quarantine / rejected" is a compliance bypass. Status is a **computed projection** of recorded events: receive action → received, QC pass → available, QC fail → rejected, hold action → on_hold. Workers click action buttons; the system writes the event with actor + timestamp + reason + evidence; the status follows.

Same for: `source_kind` on a lot (derived from the flow that created it — manual form ⇒ `manual`, PO-receive ⇒ `purchase_order`), `approval_status` on a vendor, `traceability_verification_status`, `coa_status`, `allergen_status`, `quality_status`. **None of these are user-pickable dropdowns.** Workers trigger the action; the system records the verdict.

If you find yourself rendering a `<Select>` for a status / state / verdict field, **stop and re-think**. The compliant pattern is action button → event row → projected status.

### 2. If it can be computed, don't ask

Every field that's a deterministic function of other fields is read-only and derived. Never ask a worker to type something the system already knows.

Examples (apply this lens to every new field):
- `vendor.next_review_at` = `last_review_at + review_frequency_months`
- `vendor.review_frequency_months` default = `vendor_risk` driven (high=12 / med=24 / low=36)
- `purchase_order.expected_delivery_date` default = `today + vendor.default_lead_time_days`
- `purchase_order.currency_code` = `vendor.currency_code` (locked unless vendor flagged multi-currency)
- `purchase_order_line.unit_price` default = vendor's last paid price for that item
- `purchase_order.tax_amount` = `subtotal × tax_rate`
- `purchase_order.total_amount` = `subtotal + tax_amount`
- `stock_lot.expiry_at` default = `manufactured_at + item.default_shelf_life_months`
- `stock_lot.unit_cost` (PO-receive) = PO line unit_price
- `stock_lot.country_of_origin` (PO-receive) = vendor country
- `item.code` = next NUMBERING_ENTITIES sequence per item_type (worker never sees the field on create)
- `vendor_certificate.valid_until` = `valid_from + certificate.default_validity_months`
- `nutrition.nrv_percent[nutrient]` = `value / nrv_reference[nutrient] × 100`
- `working_hours.weekly_hours` summary = sum across days

UI: show the computed value as **read-only with an explicit "override" toggle** when an override is legitimate. Default toggle = off. Toggling on logs an audit reason.

### 3. Type your strings — no free-text where a constrained type fits

Open text where a constrained type belongs is the leading cause of bad data.

| Field | Type required |
|---|---|
| Any date | `<Input type="date">` (or `datetime-local`) — never `text` |
| Country (2-char) | `<CountryPicker>` against ISO 3166-1 alpha-2 |
| Currency (3-char) | `<CurrencyPicker>` against ISO 4217 |
| Money / decimal | `Decimal` server-side with explicit precision; positive-only check at boundary |
| Barcode | GTIN-8 / 13 / 14 checksum validator |
| Email | RFC-5321 validator at submit |
| URL | scheme + host validator |
| Phone | E.164 normalised on save |
| CIDR | network validator |
| Vocabulary code (numbering prefix, attribute key) | regex-constrained at input, immutable after first use |

If a field is "2 characters" or "3 characters" or "a number string", it's the wrong primitive. Pick the strict one.

### 4. Notes → Comments, everywhere a discussion happens

Single-author textareas drop context: who said it, when, did anyone reply, was it before or after the decision. Replace with a comment thread (timestamped, attributable, peer-visible, audit-trailed) wherever the content represents discussion: vendor / PO / stock lot / receipt verdict / QC review / dispute.

Keep a plain note only when the field is **legally a single immutable line on a frozen record** — e.g. `risk_assessment_notes` on the artifact row itself. Anything that's collaborative drift over time → comments.

The Comments module is one polymorphic table — `(entity_type, entity_id)` — reused everywhere. Don't reinvent per-entity.

### 5. Files live on our server, not as URLs

Any "document" / "certificate" / "evidence" / "spec" / "photo" field is an upload, not a URL field. Bytes land in `Backend.Storage` (filesystem in dev, swappable to Azure / blob in prod) with metadata: filename, mime, byte_size, uploaded_by, uploaded_at, file FK on the entity.

External web links (a vendor's marketing website, a regulator's published guidance page) stay as URLs — that's content we link out to, not artefacts we ingest. Anything we'd be asked to produce in an audit is uploaded.

If you're considering a `document_url`, `evidence_url`, `proof_url`, `image_url` field — make it a file FK to a `*_files` table instead. Mirror the `vendor_files` shape.

### Bonus: incoming inspection is the default

Every lot created from a PO receipt or a manual receive **routes to quarantine** automatically, without exception. The receiver doesn't get a skip switch — `route_to_quarantine` is server-side, ignored from the request payload.

The only paths from `quarantine` → `available` are:

1. A **Goods-In Inspection** (`Backend.GoodsIn`) where the quality approver (different user from the operator) signs off with `decision = approved`. The approver's sign flips per-lot `qc_passed` lifecycle events.
2. An **expedited release** action (`POST /api/stock/lots/:uuid/expedite-release`) gated by `stock.qc`. Allowed only when the vendor is `vendor_risk = low` AND the item isn't on the "QC always required" list. Records an audit-defensible reason + the QC actor.

Receivers never set status. Per-pack toggles for "skip quarantine" don't exist. The compliance rule is BRCGS 3.5.1 / FSSC 22000 / GFSI: incoming goods are presumed non-conforming until QC clears them.

### Storage cells carry a purpose

The warehouse plan is split by intent. Cells / locations tag a `purpose`:

- `regular` — general storage
- `quarantine` — receipt awaiting QC verdict
- `hold` — QC-flagged for investigation but not rejected yet
- `rejected` — QC failed; awaiting return-to-supplier / disposal
- `dispatch` — picked + staged for outgoing

When a lot's status changes (`quarantine → available`, `available → rejected`, etc.), the system **auto-routes** it to a cell whose `purpose` matches. Operators can move a lot manually too, but the default lands on the right shelf without thinking.

### Bonus: immutability on traceability fields

Once a record crosses the line into the audit trail, fields that identify it become append-only:

- `stock_lot.supplier_batch_no`, `country_of_origin`, `manufactured_at`, `expiry_at` — immutable once `status ≥ received`. Edits require a dedicated capability + reason + creates an audit revision row, never a silent overwrite.
- `vendor.legal_name`, `tax_number`, `registration_number` — immutable once `approval_status = approved`. Identity changes void the approval; vendor must re-qualify.
- `purchase_order.lines` — immutable once `status ≠ draft`. Adding / removing lines after submission isn't an edit, it's a new amendment PO.

### Field-design checklist (run before every new form ships)

- [ ] Is any field on this form a status / state / verdict? → Replace with action button + event row.
- [ ] Is any field computable from other fields? → Read-only with override toggle.
- [ ] Is any "2-char" / "3-char" field a coded vocabulary? → Use the ISO picker.
- [ ] Is any "date" field a `type="text"`? → `type="date"`.
- [ ] Is any "notes" / "comments" / "remarks" textarea a discussion? → Comments module.
- [ ] Is any field accepting a URL to a document? → File upload.
- [ ] Is any traceability field editable after a state crossing? → Lock it.

If any box is unchecked, the form isn't done.
