"use client";

import { useEffect } from "react";
import { pushLobbyMeta } from "./use-lobby-presence";

/**
 * Tells the lobby presence layer "I'm currently on form X" so peers
 * who are looking at list views can see who's drafting/editing what
 * and choose to join. Mount on every form route; cleanup clears the
 * field so the user doesn't look like they're still editing after
 * they navigate away.
 *
 * `formKey` is `"<resource>:<id>"` — same shape the FormChannel uses,
 * so the list-side filter can pivot on the prefix.
 *
 *   useFormPresenceBeacon("warehouse:42")
 *   useFormPresenceBeacon("warehouse:new")
 */
export function useFormPresenceBeacon(formKey: string) {
  useEffect(() => {
    pushLobbyMeta({ current_form: formKey });
    return () => {
      pushLobbyMeta({ current_form: null });
    };
  }, [formKey]);
}
