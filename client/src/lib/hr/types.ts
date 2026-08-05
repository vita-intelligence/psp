import type { AuditActor } from "../types";

/** Six event types mirror vita-performance's WorkerReputationEvent. */
export type ReputationEventType =
  | "auto_perf_excellent"
  | "auto_perf_high"
  | "auto_perf_low"
  | "auto_perf_very_low"
  | "manual_positive"
  | "manual_negative";

export interface HREmployeeSlim {
  id: number;
  uuid: string;
  name: string;
}

/**
 * One row on an employee's wage-history timeline. Interval semantics:
 * the row with `effective_to == null` is currently effective;
 * everything else has been closed out by a later insert.
 */
export interface HREmployeeWage {
  id: number;
  uuid: string;
  employee_id: number;
  effective_from: string; // ISO date
  effective_to: string | null;
  hourly_rate: string; // Decimal(10,4) as string
  currency_code: string;
  tax_treatment: string | null;
  source_kind: string | null;
  reason: string | null;
  approved_by: AuditActor | null;
  /** Populated only on the company-wide /hr/wages feed. Per-employee
   *  timelines omit the nested employee. */
  employee?: HREmployeeSlim | null;
  inserted_at: string;
  updated_at: string;
}

/** One row on the reputation-events timeline. */
export interface HREmployeeReputationEvent {
  id: number;
  uuid: string;
  employee_id: number;
  session_external_id: string | null;
  event_type: ReputationEventType;
  score_delta: number;
  reason: string | null;
  created_by_user: AuditActor | null;
  created_by_employee: HREmployeeSlim | null;
  /** Populated only on the company-wide /hr/reputation feed. */
  employee?: HREmployeeSlim | null;
  inserted_at: string;
  updated_at: string;
}

/** Statistics row rendered on the /hr/statistics page. One row per
 *  active employee across a rolling `days` window. */
export interface HRStatisticsRow {
  employee: {
    id: number;
    uuid: string;
    name: string;
    reputation_score: number;
    is_qa: boolean;
  };
  shift_count: number;
  shift_seconds: number;
  session_count: number;
  avg_performance: number | null;
  total_produced: string | null;
  hourly_rate: {
    hourly_rate: string | null;
    currency_code: string | null;
  } | null;
  estimated_labour_cost: string | null;
}

export interface HRStatisticsSummary {
  days: number;
  rows: HRStatisticsRow[];
  totals: {
    employees: number;
    shift_count: number;
    shift_seconds: number;
    session_count: number;
  };
}

/** One row on an employee's clock-in / clock-out timeline. Mirror of
 *  vita-performance's `WorkerShift`. `ended_at` and `duration_seconds`
 *  are null for open shifts. */
export interface HREmployeeShift {
  id: number;
  uuid: string;
  employee_id: number;
  external_id: string | null;
  started_at: string; // ISO datetime
  ended_at: string | null; // ISO datetime, null while open
  duration_seconds: number | null;
  device_id: string | null;
  notes: string | null;
  /** Populated only on the company-wide feed (/hr/shifts). Per-employee
   *  timelines omit the nested employee. */
  employee?: HREmployeeSlim;
  inserted_at: string;
  updated_at: string;
}

/** Full employee payload — used by the detail page. */
export interface HREmployee {
  id: number;
  uuid: string;
  /** Rendered display code (numbering format) if the company has one
   *  configured; otherwise falls back to `employee_number`. */
  code: string | null;
  employee_number: string | null;
  external_id: string | null;
  full_name: string;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  hire_date: string | null;
  termination_date: string | null;
  is_active: boolean;
  is_qa: boolean;
  reputation_score: number;
  has_kiosk_pin: boolean;
  current_wage: HREmployeeWage | null;
  company_id: number;
  user_id: number | null;
  user: AuditActor | null;
  created_by: AuditActor | null;
  updated_by: AuditActor | null;
  inserted_at: string;
  updated_at: string;
}

/** Slim payload for the ledger. Includes the current hourly rate + currency
 *  so the ledger's "Current rate" column doesn't need a fan-out. */
export interface HREmployeeSummary {
  id: number;
  uuid: string;
  code: string | null;
  employee_number: string | null;
  external_id: string | null;
  full_name: string;
  preferred_name: string | null;
  email: string | null;
  hire_date: string | null;
  is_active: boolean;
  is_qa: boolean;
  reputation_score: number;
  current_hourly_rate: string | null;
  current_currency_code: string | null;
  inserted_at: string;
  updated_at: string;
}

export interface HREmployeeLedgerPage {
  items: HREmployeeSummary[];
  next_cursor: string | null;
}

/** Create / edit form payload — server-side is permissive. */
export interface HREmployeeUpsertInput {
  full_name?: string;
  preferred_name?: string | null;
  email?: string | null;
  phone?: string | null;
  hire_date?: string | null;
  termination_date?: string | null;
  external_id?: string | null;
  employee_number?: string | null;
  is_active?: boolean;
  is_qa?: boolean;
  /** New PIN plaintext — server bcrypts + wipes. Send `null` /
   *  omit to leave the existing PIN in place. */
  kiosk_pin?: string | null;
}

export interface HREmployeeWageInput {
  effective_from: string;
  hourly_rate: string | number;
  currency_code?: string;
  tax_treatment?: string | null;
  source_kind?: string | null;
  reason?: string | null;
}

export interface HREmployeeReputationEventInput {
  event_type: ReputationEventType;
  score_delta: number;
  reason?: string | null;
  session_external_id?: string | null;
}
