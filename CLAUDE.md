# PSP — Project Rules

## HARD RULE: every form is realtime + collaborative

Every form gated by an edit/create capability MUST support live multi-user collaboration. If a user has permission to edit, they MUST see in real time:

- **Who else** is in the form (header avatar stack)
- **Which field** each peer is focused on (per-input indicator)
- **Where their cursor** is on the form (live cursor overlay)

Up to **10 simultaneous editors** per form (`MAX_COLLABORATORS = 10`, mirrored server-side as `@default_room_limit`).

This is not optional. Vendor forms, PO forms, qualification dialogs, invoice forms, certificate dialogs, settings forms — all of them. New forms ship with collab on day one; existing non-collab forms get migrated when next touched.

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
6. **Creator gate** — only `isCreator` may finalise. Save AND Discard buttons disabled for non-creators with the "Only {creator.name} can save…" banner. Non-creator clicks never hit the server.
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

- Read-only detail pages (no form).
- One-shot action dialogs with no free-text input (e.g. "Approve PO" confirm).
- Modals that close on save in <5s with a single field — too short-lived to justify a channel.

Everything else: use the pattern.
