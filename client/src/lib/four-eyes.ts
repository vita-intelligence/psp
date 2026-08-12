/**
 * Client mirror of the backend's `Backend.FourEyes` toggle.
 *
 * Set `NEXT_PUBLIC_ENFORCE_FOUR_EYES=false` in `.env.local` (dev only)
 * to let a single developer walk MO approve / CO director-sign /
 * customer approve flows end-to-end from one seat. Any other value
 * (including unset) enforces the 4-eyes rule — the correct default
 * for prod builds.
 *
 * Keep the dev config in sync with `psp/backend/config/dev.exs`
 * (`config :backend, :enforce_four_eyes, false`) — the server-side
 * gate is the real one; this flag only hides the pre-emptive UI
 * disables that would otherwise stop you from ever hitting the
 * button.
 */
export const ENFORCE_FOUR_EYES =
  process.env.NEXT_PUBLIC_ENFORCE_FOUR_EYES !== "false";
