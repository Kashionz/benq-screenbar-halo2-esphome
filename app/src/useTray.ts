import { useEffect, useRef } from "react";
import { bridge } from "./bridge";

export function useTray(native: boolean, available: boolean, power: (value: boolean) => Promise<void>) {
  const current = useRef({ available, power });
  current.current = { available, power };
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void bridge.onTrayPower((value) => {
      if (!disposed && current.current.available) void current.current.power(value);
    }).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => { /* Main window controls remain available. */ });
    return () => { disposed = true; unlisten?.(); };
  }, [native]);
  useEffect(() => {
    if (native) void bridge.trayAvailable(available).catch(() => {});
  }, [native, available]);
}
