"use client";

import { create } from "zustand";

export interface PresenceMeta {
  name: string;
  email: string;
  avatar?: string | null;
  /** `"<resource>:<id>"` (e.g. `"warehouse:42"`, `"warehouse:new"`) or
   *  `null` when the user isn't on any form route. Updated via the
   *  lobby channel's `meta:update` event. */
  current_form?: string | null;
  online_at: number;
}

interface PresenceEntry {
  metas: PresenceMeta[];
}

interface PresenceState {
  byUserId: Record<string, PresenceEntry>;
  /** Replace state — fed from Phoenix.Presence.onSync. We never
   *  hand-roll diff merging; Phoenix's JS Presence client tracks
   *  metas by phx_ref internally and gives us the canonical view. */
  reset: (state: Record<string, PresenceEntry>) => void;
  /** Convenience: set of currently-online user ids (string form). */
  onlineUserIds: () => Set<string>;
}

export const usePresence = create<PresenceState>((set, get) => ({
  byUserId: {},

  reset(state) {
    set({ byUserId: { ...state } });
  },

  onlineUserIds() {
    return new Set(Object.keys(get().byUserId));
  },
}));
