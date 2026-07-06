"use client";

/**
 * Real-time alert primitives for the "you have a new task" event.
 * Three surfaces stack up so the operator hears it wherever they are:
 *
 *   - `playTaskChime()` — WebAudio synth, no asset ship, works in-tab.
 *   - `fireBrowserTaskNotification()` — OS-level Notification API so
 *     the user gets a system banner even when the tab is backgrounded.
 *   - The caller layers a Sonner toast on top for in-tab context.
 *
 * The chime is never mutable — tasks in PSP are compliance-critical
 * (approvals, QC sign-off, dispatch checks) and quiet failure is
 * exactly what the head-of-room pattern exists to prevent. If someone
 * finds the sound intrusive the fix is a headphone jack, not a mute
 * switch.
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * Two-note ascending chime, ~200ms total. Triangle wave with a quick
 * attack + smooth exponential release so it lands as a soft ping
 * rather than a click. Autoplay-safe: creates the context lazily and
 * swallows a suspended-context failure — the next play attempt, after
 * any user gesture on the page, will succeed.
 */
export async function playTaskChime(): Promise<void> {
  const c = getContext();
  if (!c) return;

  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      return;
    }
  }

  const now = c.currentTime;
  playNote(c, 660, now, 0.09);
  playNote(c, 990, now + 0.09, 0.14);
}

function playNote(
  c: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

// -------------------------------------------------------------------
// Browser (OS-level) notifications
// -------------------------------------------------------------------

/**
 * The Notification permission prompt must run from a user gesture in
 * Chrome / Safari — calling `requestPermission()` on mount is silently
 * rejected. So we defer: attach a one-shot capture-phase listener for
 * the first click OR keydown anywhere on the page and fire the prompt
 * from that handler. Idempotent — if permission is already granted or
 * denied, we skip the listener entirely.
 */
export function ensureNotificationPermission(): void {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;

  const N = window.Notification;
  if (N.permission === "granted" || N.permission === "denied") return;

  const ask = () => {
    document.removeEventListener("click", ask, true);
    document.removeEventListener("keydown", ask, true);
    document.removeEventListener("pointerdown", ask, true);
    try {
      void N.requestPermission();
    } catch {
      // Older browsers don't return a Promise — swallow.
    }
  };

  document.addEventListener("click", ask, true);
  document.addEventListener("keydown", ask, true);
  document.addEventListener("pointerdown", ask, true);
}

/**
 * Fire a system notification for a task delta. `tag` collapses
 * consecutive notifications so a burst of 3 broadcasts doesn't fill
 * the notification centre — the newest one replaces the previous.
 *
 * On click: focus the tab (may or may not work depending on the
 * browser + focus-stealing rules) and navigate to /my-tasks.
 */
export function fireBrowserTaskNotification(
  delta: number,
  overdueTotal: number,
): void {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (window.Notification.permission !== "granted") return;

  const title =
    delta === 1 ? "New task for you" : `${delta} new tasks for you`;
  const body =
    overdueTotal > 0
      ? `${overdueTotal} overdue in total — open PSP to review`
      : "Open PSP to review";

  try {
    const notif = new window.Notification(title, {
      body,
      tag: "psp-my-tasks",
      // `renotify` needs a `tag` — flags the OS to re-alert (bounce
      // dock icon / vibrate) instead of silently replacing.
      renotify: true,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
    } as NotificationOptions);

    notif.onclick = () => {
      try {
        window.focus();
      } catch {
        // Some browsers block programmatic focus — the user still
        // gets the URL change if they're already on the tab.
      }
      window.location.href = "/my-tasks";
      notif.close();
    };
  } catch {
    // Some browsers (mobile Safari) throw on `new Notification` and
    // require the ServiceWorker path. Toast + chime still fire.
  }
}
