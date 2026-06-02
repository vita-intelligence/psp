export interface UserRole {
  id: number;
  slug: string;
  name: string;
}

export interface User {
  id: number;
  email: string;
  name: string;
  /** Base64 data URL or null. Returned by every user-facing endpoint
   *  (/me, /users, profile-update) since the compressed payload is
   *  small enough that a flat list of ~hundreds of users is fine. */
  avatar?: string | null;
  is_active: boolean;
  confirmed_at?: string | null;
  company_id?: number | null;
  /** Roles the user holds. Frontend gates UI off `permissions` instead
   *  of role slugs so future role renames don't ripple through code. */
  roles?: UserRole[];
  /** Deduped union of permission codes from every role. Owner role
   *  bypasses on the server but still receives the full list here so
   *  the UI can render the same way regardless. */
  permissions?: string[];
  inserted_at: string;
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

export interface AuthResponse {
  token: string;
  user: User;
}
