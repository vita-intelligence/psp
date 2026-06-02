import { cn } from "@/lib/utils";

interface WordmarkProps {
  className?: string;
  /** Pixel size of the square logo block. Default 28. */
  size?: number;
}

export function Wordmark({ className, size = 28 }: WordmarkProps) {
  return (
    <div className={cn("flex items-center gap-2.5 font-semibold", className)}>
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-md bg-foreground text-xs font-bold tracking-tight text-background shadow-sm"
        style={{ width: size, height: size }}
      >
        PSP
      </span>
      <span className="text-base tracking-tight">
        <span className="text-muted-foreground font-normal">Vita</span>{" "}
        <span>PSP</span>
      </span>
    </div>
  );
}
