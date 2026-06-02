import Link from "next/link";
import { cn } from "@/lib/utils";

interface WordmarkProps {
  className?: string;
  /** Pixel size of the square logo block. Default 28. */
  size?: number;
  /** Where the wordmark navigates. Defaults to home. */
  href?: string;
}

/**
 * Brand mark + name. Clickable by default — the brand block is the
 * universal "take me home" target, so wiring it as a link keeps users
 * one tap away from `/` from anywhere in the app.
 *
 * Pass `href={null}` to render an inert wordmark (e.g. in the auth
 * shell where there's nothing to navigate to yet).
 */
export function Wordmark({ className, size = 28, href = "/" }: WordmarkProps) {
  const content = (
    <>
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
    </>
  );

  if (!href) {
    return (
      <div className={cn("flex items-center gap-2.5 font-semibold", className)}>
        {content}
      </div>
    );
  }

  return (
    <Link
      href={href}
      aria-label="Go to home"
      className={cn(
        "flex items-center gap-2.5 rounded-md font-semibold transition-opacity hover:opacity-80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {content}
    </Link>
  );
}
