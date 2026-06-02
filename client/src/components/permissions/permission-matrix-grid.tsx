"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type {
  PermissionMatrix,
  PermissionMatrixResource,
} from "@/lib/types";

type Action = "read" | "create" | "update" | "delete";
const ACTIONS: Action[] = ["read", "create", "update", "delete"];
const ACTION_LABELS: Record<Action, string> = {
  read: "Read",
  create: "Create",
  update: "Update",
  delete: "Delete",
};

interface PermissionMatrixGridProps {
  matrix: PermissionMatrix;
  /** Set of permission codes currently granted. Pass `state.permissions`
   *  wrapped in a `new Set(...)` from the parent. */
  selected: Set<string>;
  onToggle: (code: string) => void;
  onToggleResource: (resource: PermissionMatrixResource, on: boolean) => void;
  /** Visual dim when the parent has an override (e.g. Admin bypass on
   *  the user-access form). The grid stays interactive — the dim is
   *  purely "this is informational while X is on". */
  dimmed?: boolean;
}

/**
 * The MRPeasy-style permission grid, drawn from the backend matrix
 * config. Renders a desktop table at `≥ md` and a stacked card list
 * below that so phone layouts don't clip the rightmost action column.
 *
 * Either layout shares the same toggle handlers and the same
 * indeterminate row state (a resource row checkbox shows a dash when
 * some but not all of its actions are granted).
 */
export function PermissionMatrixGrid({
  matrix,
  selected,
  onToggle,
  onToggleResource,
  dimmed = false,
}: PermissionMatrixGridProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-border/60 overflow-hidden",
        dimmed && "opacity-60",
      )}
    >
      {/* Desktop table */}
      <table className="hidden w-full text-sm md:table">
        <thead className="bg-muted/40">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Resource
            </th>
            {ACTIONS.map((a) => (
              <th
                key={a}
                className="w-20 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {ACTION_LABELS[a]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.flatMap((section) => [
            <tr key={`s-${section.section}`} className="bg-muted/20">
              <td
                colSpan={1 + ACTIONS.length}
                className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {section.section}
              </td>
            </tr>,
            ...section.resources.map((res) => {
              const allGranted = ACTIONS.every((a) => {
                const code = res[a];
                return !code || selected.has(code);
              });
              const anyGranted = ACTIONS.some((a) => {
                const code = res[a];
                return code && selected.has(code);
              });
              return (
                <tr
                  key={`r-${section.section}-${res.key}`}
                  className="border-t border-border/40 hover:bg-muted/20"
                >
                  <td className="px-3 py-2">
                    <label className="flex cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={
                          allGranted
                            ? true
                            : anyGranted
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(v) =>
                          onToggleResource(res, Boolean(v))
                        }
                      />
                      <span className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {res.label}
                        </p>
                        {res.description && (
                          <p className="truncate text-xs text-muted-foreground">
                            {res.description}
                          </p>
                        )}
                      </span>
                    </label>
                  </td>
                  {ACTIONS.map((a) => {
                    const code = res[a];
                    if (!code) {
                      return (
                        <td
                          key={a}
                          className="px-2 py-2 text-center text-muted-foreground/30"
                        >
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={a} className="px-2 py-2 text-center">
                        <Checkbox
                          checked={selected.has(code)}
                          onCheckedChange={() => onToggle(code)}
                          aria-label={`${res.label} — ${ACTION_LABELS[a]}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>

      {/* Mobile stacked layout — one card per resource with action
          chips that wrap freely. No horizontal scroll required, every
          action stays visible. */}
      <div className="divide-y divide-border/40 md:hidden">
        {matrix.flatMap((section) => [
          <div
            key={`ms-${section.section}`}
            className="bg-muted/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {section.section}
          </div>,
          ...section.resources.map((res) => {
            const allGranted = ACTIONS.every((a) => {
              const code = res[a];
              return !code || selected.has(code);
            });
            const anyGranted = ACTIONS.some((a) => {
              const code = res[a];
              return code && selected.has(code);
            });
            return (
              <div
                key={`mr-${section.section}-${res.key}`}
                className="space-y-2 px-3 py-3"
              >
                <label className="flex cursor-pointer items-start gap-2">
                  <Checkbox
                    checked={
                      allGranted
                        ? true
                        : anyGranted
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(v) => onToggleResource(res, Boolean(v))}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{res.label}</p>
                    {res.description && (
                      <p className="text-xs text-muted-foreground">
                        {res.description}
                      </p>
                    )}
                  </span>
                </label>
                <div className="flex flex-wrap gap-2 pl-6">
                  {ACTIONS.map((a) => {
                    const code = res[a];
                    if (!code) return null;
                    const on = selected.has(code);
                    return (
                      <label
                        key={a}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                          on
                            ? "border-brand/40 bg-brand/[0.08] text-foreground"
                            : "border-border/60 bg-background text-muted-foreground hover:bg-muted/40",
                        )}
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={() => onToggle(code)}
                          aria-label={`${res.label} — ${ACTION_LABELS[a]}`}
                          className="size-3.5"
                        />
                        <span>{ACTION_LABELS[a]}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}
