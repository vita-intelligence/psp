"use client";

import {
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  Hash,
  PenLine,
  ShieldCheck,
  Star,
  ToggleLeft,
  Type,
} from "lucide-react";
import type { FormFieldType } from "@/lib/forms/types";

interface Def {
  type: Exclude<FormFieldType, "header">;
  label: string;
  Icon: React.ElementType;
  description: string;
}

// `header` is intentionally omitted — it's an implementation detail of
// the cleaning publisher (task #6), inserted at publish time to render
// equipment section titles on the kiosk. Authors don't add headers by
// hand.
const PALETTE: Def[] = [
  { type: "text", label: "Text", Icon: Type, description: "Short or long text answer" },
  { type: "number", label: "Number", Icon: Hash, description: "Numeric input" },
  { type: "yes_no", label: "Yes / No", Icon: ToggleLeft, description: "Simple boolean toggle" },
  { type: "acknowledgement", label: "Acknowledgement", Icon: CheckCircle2, description: "Single confirmation tick — must be checked to submit (e.g. \"I know how to operate this station\")" },
  { type: "checkbox", label: "Checkbox", Icon: CheckSquare, description: "Multiple choice selection" },
  { type: "dropdown", label: "Dropdown", Icon: ChevronDown, description: "Single choice from list" },
  { type: "rating", label: "Rating", Icon: Star, description: "Star rating 1 to 10" },
  { type: "signature", label: "Signature", Icon: PenLine, description: "Draw signature on screen" },
  { type: "qc_approval", label: "QC approval", Icon: ShieldCheck, description: "Requires QC person sign-off" },
  { type: "task_select", label: "Task select", Icon: ClipboardList, description: "Task with target quantity + duration (overrides session targets)" },
];

interface Props {
  onAdd: (type: Exclude<FormFieldType, "header">) => void;
  disabled?: boolean;
}

export function FieldPalette({ onAdd, disabled }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Add a field
      </p>
      {PALETTE.map((def) => (
        <button
          key={def.type}
          type="button"
          onClick={() => onAdd(def.type)}
          disabled={disabled}
          className="flex items-start gap-3 rounded-md border border-border/60 bg-background px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <def.Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-sm font-medium">{def.label}</p>
            <p className="truncate text-xs text-muted-foreground">
              {def.description}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
