/**
 * Rewrite an absolute NPD media URL into a same-origin proxy URL so
 * an ``<img>`` / ``<object>`` / ``<a href>`` on a PSP page can load
 * bytes that live on vita-cff. Every URL vita-cff ships on its sync
 * payload (label preview PNG, artwork PDF, invoice file, header
 * image, supplementary asset) is absolute — pipe those through this
 * helper before rendering.
 *
 * The proxy itself (``/api/npd-files``) SSRF-guards the URL, checks
 * the integration is on, and streams the upstream response through.
 *
 * Returns:
 * * ``null`` when the input is empty / null (caller renders the
 *   placeholder or hides the element).
 * * The proxied URL otherwise.
 */
export function npdFileUrl(absoluteUrl: string | null | undefined): string | null {
  if (!absoluteUrl) return null;
  return `/api/npd-files?url=${encodeURIComponent(absoluteUrl)}`;
}
