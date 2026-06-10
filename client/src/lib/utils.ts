import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Random-ID helper for transient client-side IDs (form row keys,
 * dialog keys, etc.). `crypto.randomUUID()` is gated to secure
 * contexts in some browsers — Safari throws on plain-HTTP LAN, which
 * was breaking the manual-lot form during dev pairing. Falls back to
 * timestamp + Math.random when the Web Crypto API is unavailable.
 */
export function clientId(prefix = ""): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return prefix + crypto.randomUUID();
  }
  return (
    prefix +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}
