import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { bridge, flyout, type Preset } from "./bridge";
import { PowerIcon } from "./LightControls";
import {
  LIGHT_KEYS,
  MODES,
  pendingDraft,
  previewValues,
  stageDraft,
  tempColor,
  type Draft,
  type LightKey,
} from "./controlState";
import { flyoutStatus, parseState, type FlyoutState } from "./flyout";
import { detectPlatform } from "./platform";

const SLIDERS = [
  { key: "front_brightness", label: "前燈", name: "前燈亮度", min: 1, max: 100, step: 1, unit: "%" },
  { key: "back_brightness", label: "後燈", name: "後燈亮度", min: 1, max: 100, step: 1, unit: "%" },
  { key: "temperature_k", label: "色溫", name: "色溫", min: 2700, max: 6500, step: 25, unit: " K" },
] as const;

let counter = 0;
const nextId = () => `flyout-${Date.now().toString(36)}-${(counter += 1)}`;

/**
 * Tray / menu-bar flyout. It never talks to the bridge: it renders the main
 * window's published state and sends intents back. Its draft is local and is
 * dropped whenever the flyout opens again.
 */
export default function TrayApp() {
  const native = isTauri();
  const platform = detectPlatform();
  const [state, setState] = useState<FlyoutState | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [presets, setPresets] = useState<Preset[]>([]);
  const [waiting, setWaiting] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const waitingRef = useRef<string | null>(null);
  waitingRef.current = waiting;
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
        const ack = payload as { id?: unknown; done?: unknown } | null;
        if (disposed || !ack || ack.id !== waitingRef.current) return;
        setWaiting(null);
        if (ack.done === true) setDraft({});
      }),
    );
    keep(
      flyout.onShown(() => {
        if (disposed) return;
        setDraft({});
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
  const pending = desired ? pendingDraft(draft, desired) : {};
  const keys = Object.keys(pending) as LightKey[];
  const values = desired ? previewValues(desired, draft) : null;
  const disabled = !connected || !!state?.lock || waiting !== null;
  const status = flyoutStatus(state);
  const next = desired?.power ? "關燈" : "開燈";
  const has = (key: string) =>
    state?.features[key] === "verified" || state?.features[key] === "experimental";
  const stage = <K extends LightKey>(key: K, value: Draft[K]) => {
    if (desired) setDraft(stageDraft(pending, desired, key, value as never));
  };
  const send = (intent: { kind: "power"; value: boolean } | { kind: "apply"; patch: Draft }) => {
    if (disabled) return;
    const id = nextId();
    setWaiting(id);
    void flyout.send({ id, ...intent }).catch(() => setWaiting(null));
  };
  const foot = connected && state?.updated ? `同步 ${state.updated}` : "NO CLOUD";
  return (
    <div ref={panel} className={`flyout flyout-${platform}`}>
      <div className="flyout-head">
        <div className="flyout-title">
          <div className="flyout-name">ScreenBar Halo 2</div>
          <div className={`flyout-sub tone-${state?.badge.tone ?? "idle"}`}>
            <span className="dot" />
            <span className="flyout-sub-text">
              {state?.badge.text ?? "未連線"} · 目標{connected ? (desired?.power ? "開啟" : "關閉") : "—"} ·{" "}
              {connected && desired ? MODES[desired.mode] ?? desired.mode : "—"}
            </span>
          </div>
        </div>
        <button type="button" className="flyout-open" onClick={() => void flyout.openMain().catch(() => {})}>
          開啟 Halo 2 Control
        </button>
      </div>
      {status && (
        <div role="status" className={`flyout-status tone-${status.tone}`}>
          <span className="dot" />
          <span className="flyout-status-text">
            <b>{status.title}</b>
            {status.body && ` ${status.body}`}
          </span>
          {status.lookup && (
            <button type="button" onClick={() => void flyout.openMain().catch(() => {})}>
              查詢
            </button>
          )}
        </div>
      )}
      <div className={`flyout-card${disabled ? " locked" : ""}`}>
        <div className="flyout-power">
          <button
            type="button"
            className={`power-button small${connected && desired?.power ? " on" : ""}`}
            disabled={disabled}
            aria-label={next}
            title={next}
            onClick={() => desired && send({ kind: "power", value: !desired.power })}
          >
            <PowerIcon size={20} />
          </button>
          <div>
            <div className="flyout-power-state">{connected ? (desired?.power ? "開啟" : "關閉") : "—"}</div>
            <div className="flyout-power-hint">按一下{next}</div>
          </div>
        </div>
        <div className="settings">
          <div className="flyout-modes" role="radiogroup" aria-label="模式">
            {Object.entries(MODES).map(([key, label]) => {
              const active = values?.mode === key;
              const drafted = active && "mode" in pending;
              return (
                <button key={key} type="button" role="radio" aria-checked={active}
                  className={`${active ? "active" : ""}${drafted ? " drafted" : ""}`}
                  disabled={disabled || !has("mode")} onClick={() => stage("mode", key)}>
                  {label}
                  {drafted && <i className="mini-dot" />}
                </button>
              );
            })}
          </div>
          {SLIDERS.map((slider) => {
            const value = values?.[slider.key] ?? slider.min;
            const drafted = slider.key in pending;
            const pct = (v: number) => `${((v - slider.min) / (slider.max - slider.min)) * 100}%`;
            return (
              <div key={slider.key} className={`flyout-slider${drafted ? " drafted" : ""}`}>
                <span className="flyout-slider-label">
                  {slider.label}
                  {drafted && <i className="mini-dot" />}
                </span>
                <div className="slider-track compact">
                  <div className="track" />
                  <div className="fill" style={{ width: pct(value) }} />
                  {drafted && desired && (
                    <div className="target-mark" title="目前目標" style={{ left: pct(desired[slider.key]) }} />
                  )}
                  <div className="knob"
                    style={{ left: pct(value), background: slider.key === "temperature_k" ? tempColor(value) : undefined }} />
                  <input type="range" aria-label={slider.name} min={slider.min} max={slider.max} step={slider.step}
                    value={value} disabled={disabled || !has(slider.key)}
                    onChange={(e) => stage(slider.key, Number(e.target.value))} />
                </div>
                <span className="flyout-slider-value">
                  {connected ? `${value}${slider.unit}` : "—"}
                </span>
              </div>
            );
          })}
        </div>
        {keys.length > 0 && (
          <div className="flyout-apply">
            <span>{keys.length} 項變更尚未套用</span>
            <button type="button" className="ghost-pill" onClick={() => setDraft({})}>
              取消調整
            </button>
            <button type="button" className="primary-pill" disabled={disabled || !keys.every(has)}
              onClick={() => send({ kind: "apply", patch: pending })}>
              套用燈光設定
            </button>
          </div>
        )}
      </div>
      <div className="flyout-presets">
        <div className="flyout-presets-label">情境</div>
        <div className="pills">
          {presets.map((preset) => {
            const active =
              !!values && LIGHT_KEYS.every((key) => preset.values[key] === values[key]);
            return (
              <button key={preset.id} type="button" className={`pill flyout-pill${active ? " active" : ""}`}
                disabled={disabled} aria-label={`帶入情境 ${preset.name}`}
                onClick={() => {
                  if (!desired) return;
                  let staged: Draft = {};
                  for (const key of LIGHT_KEYS) staged = stageDraft(staged, desired, key, preset.values[key] as never);
                  setDraft(staged);
                }}>
                {preset.name}
              </button>
            );
          })}
          {!presets.length && <span className="muted">尚未保存情境</span>}
        </div>
      </div>
      <div className="flyout-foot">
        <span>{foot}</span>
        <button type="button" onClick={() => void flyout.quit().catch(() => {})}>
          結束
        </button>
      </div>
    </div>
  );
}
