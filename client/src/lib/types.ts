/** Permission template — what `/api/roles` returns. A saved bundle
 *  of permission codes admins can apply to a user's matrix with one
 *  click. DB table is still `roles`; the user-facing term is
 *  "template". No persistent link to any user. */
export interface PermissionTemplate {
  /** Internal DB id. Kept for React keys + analytics; never appears
   *  in URLs / API paths / channel topics — those use `uuid`. */
  id: number;
  /** Public identifier — what URLs, API paths and channel topics use. */
  uuid: string;
  slug: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: string[];
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

/** Per-user permission matrix shape. One row = one resource; the four
 *  CRUD columns map to permission codes (or `null` when an action
 *  doesn't apply to a resource). Renders as the MRPeasy-style grid. */
export interface PermissionMatrixResource {
  key: string;
  label: string;
  description?: string | null;
  read: string | null;
  create: string | null;
  update: string | null;
  delete: string | null;
}

export interface PermissionMatrixSection {
  section: string;
  resources: PermissionMatrixResource[];
}

export type PermissionMatrix = PermissionMatrixSection[];

export interface User {
  /** Internal DB id. Kept for React keys + token decoding; never
   *  appears in URLs / API paths / channel topics — those use `uuid`. */
  id: number;
  /** Public identifier — what URLs, API paths and channel topics use. */
  uuid: string;
  email: string;
  name: string;
  /** Base64 data URL or null. Returned by every user-facing endpoint
   *  (/me, /users, profile-update) since the compressed payload is
   *  small enough that a flat list of ~hundreds of users is fine. */
  avatar?: string | null;
  is_active: boolean;
  /** True ⇒ every `hasPermission` check short-circuits to true. The
   *  bypass flag — now the source of Owner-level access. */
  is_admin?: boolean;
  /** Admin-set hourly wage. Stringified Decimal from the backend
   *  (e.g. `"12.50"`); null until populated. */
  hourly_wage?: string | null;
  confirmed_at?: string | null;
  company_id?: number | null;
  /** Deduped permission codes the user holds. `is_admin` bypasses
   *  these on the server but still receives the full list here so
   *  the UI can render the same way regardless. */
  permissions?: string[];
  inserted_at: string;
  updated_at?: string | null;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

export interface Company {
  id: number;
  name: string;
  legal_address: string | null;
  email: string | null;
  website: string | null;
  phone: string | null;
  registration_number: string | null;
  tax_number: string | null;
  tax_rate: string | null;
  payment_details: string | null;
  timezone: string;
  date_format: string;
  first_day_of_week: number;
  decimal_separator: string;
  thousands_separator: string;
  csv_separator: string;
  currency_code: string;
  currency_format: string;
  generic_place_name: string;
  working_hours: Record<string, unknown>;
  holidays: Record<string, unknown>;
  currency_rates: Record<string, unknown>;
  allowed_ips: Record<string, unknown>;
  numbering_formats: Record<string, unknown>;
}

export interface UserListEntry extends User {
  is_online: boolean;
}

/** Slim user shape embedded inside audit meta + history events.
 *  Snapshotted at event time on the backend so a later rename /
 *  deactivation can't rewrite history. `null` when the actor was
 *  deleted before the snapshot column shipped (older rows). */
export interface AuditActor {
  id: number;
  /** Present on `created_by` / `updated_by` (live preloaded actor)
   *  but omitted from history snapshots since those embed the
   *  name/email at event time. */
  uuid?: string;
  name: string;
  email: string;
  avatar: string | null;
}

/** One row from `GET /api/audit?entity_type=&entity_id=`. */
export interface AuditEvent {
  id: number;
  entity_type: "warehouse" | "user" | "template";
  entity_id: number;
  entity_uuid: string | null;
  event: "created" | "updated" | "deleted";
  /** `{"field": {"old": ..., "new": ...}, ...}` — unchanged fields
   *  are excluded. */
  changes: Record<string, { old: unknown; new: unknown }>;
  at: string;
  actor: AuditActor | null;
}

/** Slim org-roster row from `GET /api/team`. Powers the home-page
 *  "who's here" widget. Distinct from `UserListEntry` (admin list,
 *  gated on `users.view`) — `TeamMember` is what any authed user can
 *  see about their colleagues: name + email + avatar + online dot. */
export interface TeamMember {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  is_online: boolean;
}

/** Slim org-wide context payload from `GET /api/company/defaults`.
 *  Available to every authed user (no `company.view` required) since
 *  it's the baseline timezone / locale / working-hours that warehouses
 *  and other entities inherit — context, not configuration access. */
export interface CompanyDefaults {
  id: number;
  name: string;
  timezone: string;
  working_hours: Record<string, unknown>;
  holidays: Record<string, unknown>;
  date_format: string;
  first_day_of_week: number;
  decimal_separator: string;
  thousands_separator: string;
  currency_code: string;
  currency_format: string;
  generic_place_name: string;
}

export interface Contact {
  type: "phone" | "email" | "url" | "other";
  label?: string;
  value: string;
}

export interface Warehouse {
  /** Internal DB id. Never in URLs — those use `uuid`. */
  id: number;
  /** Public identifier — what URLs, API paths and channel topics use. */
  uuid: string;
  company_id: number;
  name: string;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  /** `null` ⇒ inherit from company. */
  timezone: string | null;
  /** `null` ⇒ inherit from company. */
  working_hours: Record<string, unknown> | null;
  /** `null` ⇒ inherit from company. */
  holidays: Record<string, unknown> | null;
  contacts: { items: Contact[] };
  plan: Record<string, unknown> | null;
  inserted_at: string;
  updated_at: string;
  created_by?: AuditActor | null;
  updated_by?: AuditActor | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}
