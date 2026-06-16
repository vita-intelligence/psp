// Mirrors `Backend.GoodsIn.MobileIncoming.@max_window_days`. The
// mobile "Expected deliveries" board SSR-fetches and polls this far
// out so chip counts paint with real numbers from first paint and
// long-lead-time POs (2-4 week vendor leads are common) aren't hidden
// behind a chip tap. Filtering down to today / tomorrow / this week
// happens client-side over the same payload.
export const INCOMING_WINDOW_DAYS = 90;
