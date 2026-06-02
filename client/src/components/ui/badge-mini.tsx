import { cn } from "@/lib/utils";

type Tone =
  | "muted"
  | "brand"
  | "emerald"
  | "amber"
  | "destructive"
  | "indigo";

const TONE_CLASS: Record<Tone, string> = {
  muted: "bg-muted text-muted-foreground",
  brand: "bg-brand/10 text-brand",
  emerald:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  amber:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  destructive: "bg-destructive/10 text-destructive",
  indigo:
    "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400",
};

interface BadgeProps {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}

/**
 * Tiny pill — used inside table cells and lists for status indicators.
 * Smaller than shadcn's stock Badge (which targets buttons / actions).
 */
export function Badge({ tone = "muted", className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
