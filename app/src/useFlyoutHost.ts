import { useEffect, useRef } from "react";
import { flyout } from "./bridge";
import type { Draft, LockReason } from "./controlState";
import { parseIntent, type FlyoutState } from "./flyout";

export interface FlyoutHandlers {
  lock: LockReason | null;
  /** Resolves true only when the explicit command was transmitted. */
  power: (value: boolean) => Promise<boolean>;
  /** Stages user-changed values for live sending; false when locked. */
  adjust: (patch: Draft) => boolean;
  /** Read-only resync (GET state) when the flyout opens. */
  sync: () => void;
}

/**
 * Main-window side of the tray flyout. Publishes the current view state and
 * turns flyout intents into the same guarded command calls the main window
 * uses. Intents are re-checked against the latest lock; nothing is retried.
 */
export function useFlyoutHost(native: boolean, state: FlyoutState, handlers: FlyoutHandlers) {
  const current = useRef({ state, handlers });
  current.current = { state, handlers };
  const serialized = JSON.stringify(state);
  useEffect(() => {
    if (native) void flyout.publish(current.current.state).catch(() => {});
  }, [native, serialized]);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const stops: Array<() => void> = [];
    const keep = (listening: Promise<() => void>) =>
      void listening
        .then((stop) => (disposed ? stop() : stops.push(stop)))
        .catch(() => {
          /* The main window keeps working without the flyout. */
        });
    const publish = () => void flyout.publish(current.current.state).catch(() => {});
    keep(
      flyout.onIntent(async (payload) => {
        const intent = parseIntent(payload);
        if (disposed || !intent) return;
        if (intent.kind === "sync") return publish();
        const { lock, power, adjust } = current.current.handlers;
        const done =
          lock === null && (intent.kind === "power" ? await power(intent.value) : adjust(intent.patch));
        void flyout.ack({ id: intent.id, done }).catch(() => {});
      }),
    );
    keep(
      flyout.onShown(() => {
        if (disposed) return;
        current.current.handlers.sync();
        publish();
      }),
    );
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, [native]);
}
