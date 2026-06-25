"use client";

import { useEffect, useRef, useState } from "react";
import type { Channel } from "phoenix";
import { getSocket } from "../realtime/socket";

export type WizardJoinError =
  | { reason: "forbidden" }
  | { reason: "not_found" }
  | { reason: "bad_topic" }
  | { reason: "unknown"; raw?: unknown };

interface Options {
  /** Customer-order UUID. Joins topic `wizard:co:<uuid>`. */
  coUuid: string;
  /** Called whenever the channel pushes `"changed"`. Use this to
   *  re-fetch the wizard snapshot. */
  onChanged: () => void;
  /** Skip the channel join entirely — used when the viewer doesn't
   *  have edit access; they still see the static snapshot but won't
   *  get live updates from peers. */
  disabled?: boolean;
}

interface Result {
  /** True after we've joined the channel. */
  connected: boolean;
  /** Populated when the BE rejected the join (forbidden, missing,
   *  bad topic). Distinct from a transient socket dropout. */
  joinError: WizardJoinError | null;
}

/**
 * Subscribe to `wizard:co:<co_uuid>`. The Phoenix channel
 * `WizardChannel` rebroadcasts a `"changed"` event whenever anything
 * touches the underlying CO / MO / booking / lot graph — the FE then
 * refetches its full snapshot to project the new state.
 *
 * Mirrors `useCommentChannel` (same socket helper, same join /
 * error contract) but stays tiny because the wizard channel is
 * one-event-fits-all: every relevant write fans out as `"changed"`.
 */
export function useWizardChannel({
  coUuid,
  onChanged,
  disabled = false,
}: Options): Result {
  const [connected, setConnected] = useState(false);
  const [joinError, setJoinError] = useState<WizardJoinError | null>(null);

  // Hold the latest callback identity in a ref so the effect doesn't
  // tear the channel down on every parent render.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });

  const channelRef = useRef<Channel | null>(null);

  useEffect(() => {
    if (disabled || !coUuid) return;

    let alive = true;
    let cleanup: (() => void) | null = null;

    (async () => {
      const socket = await getSocket();
      if (!socket || !alive) return;

      const topic = `wizard:co:${coUuid}`;
      const channel = socket.channel(topic, {});
      channelRef.current = channel;

      channel.on("changed", () => {
        onChangedRef.current();
      });

      channel
        .join()
        .receive("ok", () => {
          if (!alive) return;
          setConnected(true);
          setJoinError(null);
        })
        .receive("error", (resp: { reason?: string }) => {
          if (!alive) return;
          const reason = resp?.reason;
          if (
            reason === "forbidden" ||
            reason === "not_found" ||
            reason === "bad_topic"
          ) {
            setJoinError({ reason });
          } else {
            setJoinError({ reason: "unknown", raw: resp });
          }
        });

      cleanup = () => {
        try {
          channel.leave();
        } catch {
          // Channel teardown is best-effort.
        }
        channelRef.current = null;
      };
    })();

    return () => {
      alive = false;
      if (cleanup) cleanup();
    };
  }, [coUuid, disabled]);

  return { connected, joinError };
}
