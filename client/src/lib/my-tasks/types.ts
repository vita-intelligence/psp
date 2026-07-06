import type { OrderWizardCta, OrderWizardPhaseKey } from "../types";

/** A single actionable row surfaced on `/my-tasks`. Mirrors
 *  `Backend.MyTasks` — every field the FE renders. */
export interface MyTask {
  /** Stable id — `co-<uuid>-<action>`. Safe as a React key. */
  id: string;
  co_uuid: string;
  co_code: string | null;
  customer_name: string | null;
  phase_key: OrderWizardPhaseKey;
  phase_label: string;
  /** Verb like `"sign_approver"` or the auto-slugged `"link:register-the-delivery"`
   *  for link CTAs. Useful for analytics + as a stable key alongside `co_uuid`. */
  action_code: string;
  title: string;
  detail: string | null;
  /** Full CTA the wizard emits — reuse as-is on the "Do it" button. */
  cta: OrderWizardCta | null;
  /** CO due date — `null` when nothing was captured. */
  due_date: string | null;
  updated_at: string;
}

export interface MyTasksPage {
  tasks: MyTask[];
  next_cursor: string | null;
}

export interface MyTasksCount {
  total: number;
  overdue: number;
  by_phase: Partial<Record<OrderWizardPhaseKey, number>>;
}

export type UrgencyFilter = "overdue" | "this_week" | "later" | "no_date";

