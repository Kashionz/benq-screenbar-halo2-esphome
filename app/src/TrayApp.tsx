import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { bridge, flyout, type Preset } from "./bridge";
import { PowerIcon, SLIDERS, SliderTrack } from "./LightControls";
import {
  MODES,
  adjustable,
  lightSummary,
  presetValues,
  samePreset,
  tempColor,
  type Draft,
  type LightKey,
} from "./controlState";
import { ConnectionStatus, StatusLine } from "./StatusCards";
import { parseState, trayLine, type FlyoutState } from "./flyout";
import { detectPlatform } from "./platform";
import { loadTheme, useDocumentTheme, useResolvedTheme } from "./theme";

let counter = 0;
const nextId = () => `flyout-${Date.now().toString(36)}-${(counter += 1)}`;

/**
 * Tray / menu-bar flyout. It never talks to the bridge: it renders the main
 * window's published state and sends intents back. Lighting changes are
 * sent live by the main window; the flyout only keeps the value under the
 * pointer while a slider is being dragged.
 */
export default function TrayApp() {
  const native = isTauri();
  const platform = detectPlatform();
  const [state, setState] = useState<FlyoutState | null>(null);
  const [dragging, setDragging] = useState<Draft>({});
  const [presets, setPresets] = useState<Preset[]>([]);
  const [waiting, setWaiting] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const waitingRef = useRef<string | null>(null);
  waitingRef.current = waiting;
  // Until the main window publishes its theme, use the saved choice.
  const fallback = useResolvedTheme(loadTheme());
  useDocumentTheme(state?.theme ?? fallback);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const stops: Array<() => void> = [];
    const keep = (listening: Promise<() => void>) =>
      void listening.then((stop) => (disposed ? stop() : stops.push(stop))).catch(() => {});
    const loadPresets = () =>
      void bridge
        .presets()
        .then((items) => !disposed && setPresets(items))
        .catch(() => {});
    keep(
      flyout.onState((payload) => {
        const next = parseState(payload);
        if (!disposed && next) setState(next);
      }),
    );
    keep(
      flyout.onAck((payload) => {
        const ack = payload as { id?: unknown } | null;
        if (!disposed && ack && ack.id === waitingRef.current) setWaiting(null);
      }),
    );
    keep(
      flyout.onShown(() => {
        if (disposed) return;
        setDragging({});
        loadPresets();
      }),
    );
    loadPresets();
    // Ask the main window for its current state once the listeners exist.
    void flyout.send({ id: nextId(), kind: "sync" }).catch(() => {});
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void flyout.hide().catch(() => {});
    };
    window.addEventListener("keydown", escape);
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
      window.removeEventListener("keydown", escape);
    };
  }, [native]);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!native || !node || typeof ResizeObserver === "undefined") return;
    const report = () => void flyout.resize(Math.ceil(node.getBoundingClientRect().height)).catch(() => {});
    const observer = new ResizeObserver(report);
    observer.observe(node);
    report();
    return () => observer.disconnect();
  }, [native]);

  const connected = !!state?.connected && !!state.desired;
  const desired = state?.desired ?? null;
  const locked = !connected || !!state?.lock;
  useEffect(() => {
    if (locked) setDragging({});
  }, [locked]);
  const values = state?.values ? { ...state.values, ...dragging } : null;
  // The main window's own power command is in flight: keep the button's look
  // but ignore presses, as the main window does.
  const powerPending = connected && state?.status?.tone === "busy";
  const next = desired?.power ? "關燈" : "開燈";
  const line = trayLine(connected ? state : null, next);
  const has = (key: string) =>
    state?.features[key] === "verified" || state?.features[key] === "experimental";
  const adjust = (patch: Draft) => {
    if (locked) return;
    void flyout.send({ id: nextId(), kind: "adjust", patch }).catch(() => {});
  };
  const release = (key: LightKey) =>
    setDragging((current) => {
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
  return (
    <div ref={panel} className={`flyout flyout-${platform}`}>
      <div className="flyout-head">
        <div className="flyout-name">ScreenBar Halo 2</div>
        <button type="button" className="flyout-open" onClick={() => void flyout.openMain().catch(() => {})}>
          開啟 HaloDesk
        </button>
      </div>
      <div className="flyout-card">
        <div className="flyout-power">
          <button
            type="button"
            className={`power-button small${connected && desired?.power ? " on" : ""}`}
            disabled={locked && !powerPending}
            aria-disabled={waiting !== null || powerPending || undefined}
            aria-label={next}
            title={next}
            onClick={() => {
              if (!desired || waiting !== null || powerPending) return;
              const id = nextId();
              setWaiting(id);
              void flyout.send({ id, kind: "power", value: !desired.power }).catch(() => setWaiting(null));
            }}
          >
            <PowerIcon size={20} />
          </button>
          <div className="flyout-power-text">
            <div className="flyout-power-state">{connected ? (desired?.power ? "開啟" : "關閉") : "—"}</div>
            <StatusLine line={line} />
          </div>
          {line.lookup && (
            <button type="button" className={`flyout-lookup tone-${line.tone}`}
              onClick={() => void flyout.openMain().catch(() => {})}>
              查詢
            </button>
          )}
        </div>
        <div className={`flyout-controls${locked ? " locked" : ""}`}>
          <div className="segmented flyout-modes" role="radiogroup" aria-label="模式">
            {Object.entries(MODES).map(([key, label]) => {
              const active = values?.mode === key;
              return (
                <button key={key} type="button" role="radio" aria-checked={active}
                  className={active ? "active" : ""}
                  disabled={locked || !has("mode")} onClick={() => adjust({ mode: key })}>
                  {label}
                </button>
              );
            })}
          </div>
          {SLIDERS.map((slider) => {
            const value = values?.[slider.key] ?? slider.min;
            const unlit = !!values && !adjustable(values.mode, slider.key);
            return (
              <div key={slider.key} className="flyout-slider">
                <span className="flyout-slider-label">{slider.label}</span>
                <SliderTrack
                  slider={slider}
                  value={value}
                  className="compact"
                  disabled={locked || unlit || !has(slider.key)}
                  onChange={(next) => {
                    setDragging((current) => ({ ...current, [slider.key]: next }));
                    adjust({ [slider.key]: next });
                  }}
                  onPointerUp={() => release(slider.key)}
                  onKeyUp={() => release(slider.key)}
                  onBlur={() => release(slider.key)}
                />
                <span className="flyout-slider-value">{connected ? `${value}${slider.unit}` : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>
      {presets.length > 0 && (
        <div className={`flyout-presets${locked ? " locked" : ""}`}>
          {presets.map((preset) => {
            const active = !!values && samePreset(preset.values, values);
            return (
              <button key={preset.id} type="button" className={`flyout-tile${active ? " active" : ""}`}
                disabled={locked} title={lightSummary(preset.values)} aria-label={`帶入情境 ${preset.name}`}
                aria-pressed={active} onClick={() => adjust(presetValues(preset.values))}>
                <span className="swatch" style={{ background: tempColor(preset.values.temperature_k) }} />
                <span className="tile-name">{preset.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flyout-foot">
        <ConnectionStatus connected={connected} online={!!state?.online} updated={state?.updated ?? ""} />
        <button type="button" onClick={() => void flyout.quit().catch(() => {})}>
          結束
        </button>
      </div>
    </div>
  );
}
