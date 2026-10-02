"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  /** 0-based current page index. */
  readonly page: number;
  /** Rows per page the caller is paginating with — used to compute
   *  total pages against ``total``. */
  readonly pageSize: number;
  /** Total matching rows across every page. */
  readonly total: number;
  /** True while a fetch is in flight. Disables all controls so a
   *  jittery click can't fire two parallel page requests. */
  readonly disabled?: boolean;
  readonly onPageChange: (nextPage: number) => void;
}

/**
 * Numbered-page controls. Renders:
 *
 *   « · 1 2 3 … 42 · »
 *
 * with a window of pages around the current one. Compact enough to
 * live inside a card footer; identical shape across the three
 * vendor-detail cards (approved items, purchase terms, price
 * history) so operators learn one navigation pattern.
 *
 * The row counter ("Showing 26-50 of 1,832") lives outside this
 * component — callers render it next to the controls when the
 * page's local range matters more than the raw page number.
 */
export function PageControls({
  page,
  pageSize,
  total,
  disabled,
  onPageChange,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  if (totalPages <= 1) return null;

  const current = Math.min(Math.max(page, 0), totalPages - 1);
  const pages = buildPageList(current, totalPages);

  return (
    <nav
      aria-label="Pagination"
      className="inline-flex items-center gap-1 text-xs"
    >
      <PageButton
        label="Previous page"
        disabled={disabled || current === 0}
        onClick={() => onPageChange(current - 1)}
      >
        <ChevronLeft className="size-3.5" />
      </PageButton>
      {pages.map((entry, i) =>
        entry === "ellipsis" ? (
          <span
            key={`gap-${i}`}
            className="px-1 text-muted-foreground"
            aria-hidden
          >
            …
          </span>
        ) : (
          <PageButton
            key={entry}
            label={`Page ${entry + 1}`}
            disabled={disabled}
            active={entry === current}
            onClick={() => onPageChange(entry)}
          >
            {entry + 1}
          </PageButton>
        ),
      )}
      <PageButton
        label="Next page"
        disabled={disabled || current >= totalPages - 1}
        onClick={() => onPageChange(current + 1)}
      >
        <ChevronRight className="size-3.5" />
      </PageButton>
    </nav>
  );
}

type PageEntry = number | "ellipsis";

/** Build a compact page list of at most 7 entries:
 *   1 … (n-1) n (n+1) … LAST
 *
 *  Keeps the first + last always visible so the user can jump to
 *  the ends, with a 3-wide window around the current page. For
 *  small total-page counts (≤ 7) all pages render inline.
 */
function buildPageList(current: number, totalPages: number): PageEntry[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const entries: PageEntry[] = [0];
  const start = Math.max(1, current - 1);
  const end = Math.min(totalPages - 2, current + 1);

  if (start > 1) entries.push("ellipsis");
  for (let i = start; i <= end; i++) entries.push(i);
  if (end < totalPages - 2) entries.push("ellipsis");

  entries.push(totalPages - 1);
  return entries;
}

function PageButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={[
        "inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md border px-2 font-mono",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-muted",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
