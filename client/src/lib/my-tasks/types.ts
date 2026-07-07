import type { OrderWizardCta, OrderWizardPhaseKey } from "../types";

/** Which flavour of task this row is. Drives the FE's per-row
 *  renderer switch — CO tasks show a customer + CO code; reorder
 *  tasks show an item + suggested qty. */
export type MyTaskEntityType = "customer_order" | "reorder";

/** A single actionable row surfaced on `/my-tasks`. Mirrors
 *  `Backend.MyTasks` — every field the FE renders. */
export interface MyTask {
  /** Stable id — `co-<uuid>-<action>` for CO tasks, `reorder-<item-uuid>`
   *  for reorder tasks. Safe as a React key. */
  id: string;
  entity_type: MyTaskEntityType;
  /** CO-task fields — nil for reorder tasks. */
  co_uuid: string | null;
  co_code: string | null;
  customer_name: string | null;
  /** Reorder-task fields — nil for CO tasks. */
  item_uuid: string | null;
  item_code: string | null;
  item_name: string | null;
  phase_key: OrderWizardPhaseKey | "reorder";
  phase_label: string;
  /** Verb like `"sign_approver"` or the auto-slugged `"link:register-the-delivery"`
   *  for link CTAs. `"raise_po"` for reorder tasks. */
  action_code: string;
  title: string;
  detail: string | null;
  /** Full CTA the wizard emits — reuse as-is on the "Do it" button. */
  cta: OrderWizardCta | null;
  /** CO due date — `null` when nothing was captured (also always
   *  null for reorder tasks — they surface on threshold crossing). */
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
  this_week: number;
  later: number;
  no_date: number;
  by_phase: Partial<Record<OrderWizardPhaseKey | "reorder", number>>;
}

export type UrgencyFilter = "overdue" | "this_week" | "later" | "no_date";

