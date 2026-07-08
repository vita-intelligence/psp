// Deterministic colour pick per user — same name → same avatar tint
// every reload. Hash gives an integer mod the palette length.

const PALETTE = [
  { bg: "bg-rose-100", text: "text-rose-700" },
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-emerald-100", text: "text-emerald-700" },
  { bg: "bg-sky-100", text: "text-sky-700" },
  { bg: "bg-violet-100", text: "text-violet-700" },
  { bg: "bg-fuchsia-100", text: "text-fuchsia-700" },
  { bg: "bg-teal-100", text: "text-teal-700" },
  { bg: "bg-orange-100", text: "text-orange-700" },
];

export function avatarColour(seed: string | null | undefined) {
  // Null-safe — an audit event actor with no email + no name would
  // otherwise crash here. Empty seed hashes to the first palette
  // slot, which is fine as a stable "unknown user" fallback.
  const safe = seed ?? "";
  let h = 0;
  for (let i = 0; i < safe.length; i++) {
    h = (h * 31 + safe.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % PALETTE.length;
  return PALETTE[idx]!;
}
