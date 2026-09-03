"use client";

/**
 * Dev-only bypass for the mandatory photo gate on mobile movement
 * flows (put-away, closeout, etc). Renders NOTHING in production so
 * there is zero risk of an operator hitting it on a real device.
 *
 * The bypass sets ``photoUrl`` to a fixed marker string that:
 *   * satisfies the BE ``ensure_photo`` gate — non-empty binary is
 *     the only thing it checks (see ``Backend.Production.ensure_photo/1``
 *     in ``psp/backend/lib/backend/production.ex``);
 *   * is easily identifiable in the audit trail (``dev-skip:<iso>``)
 *     so a QA scan can distinguish dev stubs from real photo URLs.
 *
 * Prod safety:
 *   * The env check runs at render time. Next.js inlines
 *     ``process.env.NODE_ENV`` at build so this branch is
 *     tree-shaken to ``null`` in the production bundle — the JSX
 *     is not shipped, not just hidden.
 *   * BE has no dev-only code path. The marker string is a normal
 *     photo_url value; only its recognisable prefix signals it was
 *     a dev bypass.
 */
/**
 * Sentinel string prefix stamped on `Stock.Movement.photo_url` when the
 * dev-only Skip button is used (see :func:`DevSkipPhotoButton`). Real
 * photo URLs always start with `/api/stock/movement-photos/…`; the
 * sentinel is `dev-skip:<iso-timestamp>`. Callers render an <img> from
 * `photo_url` and the sentinel is not a fetchable URL, so the browser
 * paints its broken-image icon — hence this helper for every consuming
 * component to normalise "no real photo" into `null`.
 */
export function isDevSkipPhoto(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("dev-skip:");
}

/**
 * Returns the photo URL only if it points at a real, fetchable file.
 * `null` / empty / dev-skip sentinel all collapse to `null` so the
 * caller renders its "no photo" placeholder instead of a broken image.
 */
export function realPhotoUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  if (isDevSkipPhoto(url)) return null;
  return url;
}


export function DevSkipPhotoButton({
  onSkip,
  label = "Skip photo (dev only)",
  className,
}: {
  /** Called with the marker string when the operator taps the button. */
  onSkip: (markerUrl: string) => void;
  label?: string;
  className?: string;
}) {
  if (process.env.NODE_ENV !== "development") return null;

  const marker = `dev-skip:${new Date().toISOString()}`;

  return (
    <button
      type="button"
      onClick={() => onSkip(marker)}
      className={
        className ??
        "w-full rounded-md border border-dashed border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-500/20 dark:text-amber-200"
      }
    >
      {label}
    </button>
  );
}
