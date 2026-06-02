"use client";

import { create } from "zustand";

export interface PresenceMeta {
  name: string;
  email: string;
  online_at: number;
}

interface PresenceEntry {
  metas: PresenceMeta[];
}

interface PresenceState {
  byUserId: Record<string, PresenceEntry>;
  /** Replace state — used on initial `presence_state` from server. */
  reset: (state: Record<string, PresenceEntry>) => void;
  /** Merge a diff — used on every `presence_diff` from server. */
  diff: (joins: Record<string, PresenceEntry>, leaves: Record<string, PresenceEntry>) => void;
  /** Convenience: set of currently-online user ids (string form). */
  onlineUserIds: () => Set<string>;
}

export const usePresence = create<PresenceState>((set, get) => ({
  byUserId: {},

  reset(state) {
    set({ byUserId: { ...state } });
  },

  diff(joins, leaves) {
    set(({ byUserId }) => {
      const next = { ...byUserId };

      for (const [id, entry] of Object.entries(joins)) {
        const existing = next[id]?.metas ?? [];
        next[id] = { metas: [...existing, ...entry.metas] };
      }

      for (const [id, entry] of Object.entries(leaves)) {
        const existing = next[id]?.metas ?? [];
        const leftRefs = new Set(
          entry.metas.map((m) => `${m.online_at}:${m.name}`),
        );
        const remaining = existing.filter(
          (m) => !leftRefs.has(`${m.online_at}:${m.name}`),
        );
        if (remaining.length === 0) {
          delete next[id];
        } else {
          next[id] = { metas: remaining };
        }
      }

      return { byUserId: next };
    });
  },

  onlineUserIds() {
    return new Set(Object.keys(get().byUserId));
  },
}));
