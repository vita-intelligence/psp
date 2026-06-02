// Deterministic vivid color per user — used for live cursors, name
// labels, and any future "this thing belongs to that peer" badge.
//
// Avatars use a soft tinted palette (`avatar-color.ts`); cursors need
// strong primaries so the arrow + label read at a glance against any
// background. Different palette on purpose.

const PALETTE = [
  "#e11d48", // rose-600
  "#ea580c", // orange-600
  "#d97706", // amber-600
  "#16a34a", // green-600
  "#0d9488", // teal-600
  "#0ea5e9", // sky-500
  "#6366f1", // indigo-500
  "#7c3aed", // violet-600
  "#c026d3", // fuchsia-600
  "#db2777", // pink-600
];

export function peerColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}
