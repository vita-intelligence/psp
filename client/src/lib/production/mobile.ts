import "server-only";

/**
 * Mobile-side server helpers for production entities — all authed via
 * the device bearer cookie set at pair time, not the laptop session
 * cookie. The phone has no session, only a device token that inherits
 * the paired user's permissions.
 *
 * `getMachineForScan` was retired with the Machine → Equipment merge.
 * Mobile QR scanners that used to hit `/api/production/machines/:uuid`
 * should target `/api/equipment/:uuid` instead.
 */
export {};
