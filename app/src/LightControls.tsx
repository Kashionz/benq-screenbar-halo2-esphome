import type { PresetValues, Snapshot } from "./bridge";
import { PresetsPanel } from "./PresetsPanel";
import {
  LIGHT_KEYS,
  MODES,
  pendingDraft,
  previewValues,
  stageDraft,
  supported,
  tempColor,
  type Draft,
  type LightKey,
  type LockReason,
} from "./controlState";

export type { LightPatch } from "./controlState";

const SLIDERS = [
  { key: "front_brightness", label: "前燈", name: "前燈亮度", min: 1, max: 100, step: 1, unit: "%" },
  { key: "back_brightness", label: "後燈", name: "後燈亮度", min: 1, max: 100, step: 1, unit: "%" },
  { key: "temperature_k", label: "色溫", name: "色溫", min: 2700, max: 6500, step: 25, unit: " K" },
] as const;

export function PowerIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.2v7.6" />
      <path d="M7.1 6.1a7.6 7.6 0 1 0 9.8 0" />
    </svg>
  );
}

/**
 * Power, mode, sliders, presets and apply. Every edit only changes the draft;
 * power sends one explicit value (never a toggle) derived from desired.power.
 */
export function LightControls({
  snapshot,
  draft,
  setDraft,
  lock,
  power,
  apply,
}: {
  snapshot: Snapshot;
  draft: Draft;
  setDraft: (next: Draft) => void;
  lock: LockReason | null;
  power: (value: boolean) => void;
  apply: (patch: Draft) => void;
}) {
  const desired = snapshot.desired.values;
  const pending = pendingDraft(draft, desired);
  const values = previewValues(desired, draft);
  const keys = Object.keys(pending) as LightKey[];
  const disabled = lock !== null;
  const next = desired.power ? "關燈" : "開燈";
  const stage = <K extends LightKey>(key: K, value: Draft[K]) =>
    setDraft(stageDraft(pending, desired, key, value as (typeof desired)[K]));
  const canApply = !disabled && keys.length > 0 && keys.every((k) => supported(snapshot, k));
  const pick = (preset: PresetValues) => {
    let staged: Draft = {};
    for (const key of LIGHT_KEYS) staged = stageDraft(staged, desired, key, preset[key] as never);
    setDraft(staged);
  };
  return (
    <section aria-label="燈光">
      <div className="group-label">
        {lock && <span className="group-label-end">已停用：{lock}</span>}
      </div>
      <div className={`group light-group${disabled ? " locked" : ""}`}>
        <div className="row power-row">
          <button
            type="button"
            className={`power-button${desired.power ? " on" : ""}`}
            disabled={disabled}
            aria-label={next}
            title={next}
            onClick={() => power(!desired.power)}
          >
            <PowerIcon size={24} />
          </button>
          <div className="power-text">
            <div className="power-state">{desired.power ? "開啟" : "關閉"}</div>
            <div className="power-hint">按一下{next}</div>
          </div>
        </div>
        <div className="settings">
          <div className="row mode-row">
            <span className="row-title">
              模式{"mode" in pending && <i className="draft-dot" />}
            </span>
            <div className="segmented" role="radiogroup" aria-label="模式">
              {Object.entries(MODES).map(([key, label]) => {
                const active = values.mode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`${active ? "active" : ""}${active && "mode" in pending ? " drafted" : ""}`}
                    disabled={disabled || !supported(snapshot, "mode")}
                    onClick={() => stage("mode", key)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          {SLIDERS.map((slider) => {
            const drafted = slider.key in pending;
            const pct = (v: number) => `${((v - slider.min) / (slider.max - slider.min)) * 100}%`;
            const value = values[slider.key];
            return (
              <div key={slider.key} className={`row slider${drafted ? " drafted" : ""}`}>
                <div className="slider-head">
                  <span className="row-title">
                    {slider.label}
                    {drafted && <i className="draft-dot" />}
                  </span>
                  <span className="slider-value">
                    {value}
                    {slider.unit}
                  </span>
                </div>
                <div className="slider-track">
                  <div className="track" />
                  <div className="fill" style={{ width: pct(value) }} />
                  {drafted && (
                    <div className="target-mark" title="目前目標" style={{ left: pct(desired[slider.key]) }} />
                  )}
                  <div
                    className="knob"
                    style={{
                      left: pct(value),
                      background: slider.key === "temperature_k" ? tempColor(value) : undefined,
                    }}
                  />
                  <input
                    type="range"
                    aria-label={slider.name}
                    min={slider.min}
                    max={slider.max}
                    step={slider.step}
                    value={value}
                    disabled={disabled || !supported(snapshot, slider.key)}
                    onChange={(e) => stage(slider.key, Number(e.target.value))}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <PresetsPanel values={values} disabled={disabled} select={pick} />
        <div className={`row apply-row${keys.length && !disabled ? " has-draft" : ""}`}>
          <span className="apply-text">
            {lock
              ? `已停用：${lock}`
              : keys.length
                ? `${keys.length} 項變更尚未套用`
                : "按套用才會送出"}
          </span>
          <button type="button" className="ghost-pill" disabled={disabled || !keys.length}
            onClick={() => setDraft({})}>
            取消調整
          </button>
          <button type="button" className="primary-pill" disabled={!canApply}
            onClick={() => apply(pending)}>
            套用燈光設定
          </button>
        </div>
      </div>
    </section>
  );
}
