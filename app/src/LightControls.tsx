import type { LightState, Snapshot } from "./bridge";
import { MODES, supported, tempColor, type Draft, type LockReason } from "./controlState";

export type { LightPatch } from "./controlState";

export const SLIDERS = [
  { key: "front_brightness", label: "前燈", name: "前燈亮度", min: 1, max: 100, step: 1, unit: "%" },
  { key: "back_brightness", label: "後燈", name: "後燈亮度", min: 1, max: 100, step: 1, unit: "%" },
  { key: "temperature_k", label: "色溫", name: "色溫", min: 2700, max: 6500, step: 25, unit: " K" },
] as const;

export const sliderPct = (slider: (typeof SLIDERS)[number], value: number) =>
  `${((value - slider.min) / (slider.max - slider.min)) * 100}%`;

export function PowerIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.2v7.6" />
      <path d="M7.1 6.1a7.6 7.6 0 1 0 9.8 0" />
    </svg>
  );
}

/** Track, fill and knob drawn under a transparent native range input. */
export function SliderTrack({
  slider,
  value,
  disabled,
  className = "",
  onChange,
  ...release
}: {
  slider: (typeof SLIDERS)[number];
  value: number;
  disabled: boolean;
  className?: string;
  onChange: (value: number) => void;
  onPointerUp?: () => void;
  onKeyUp?: () => void;
  onBlur?: () => void;
}) {
  const pct = sliderPct(slider, value);
  return (
    <div className={`slider-track ${className}`.trim()}>
      <div className="track" />
      <div className="fill" style={{ width: pct }} />
      <div
        className="knob"
        style={{ left: pct, background: slider.key === "temperature_k" ? tempColor(value) : undefined }}
      />
      <input
        type="range"
        aria-label={slider.name}
        min={slider.min}
        max={slider.max}
        step={slider.step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        {...release}
      />
    </div>
  );
}

/**
 * Mode and sliders. Every change is sent live through adjust(); power lives
 * on the lamp preview.
 */
export function LightControls({
  snapshot,
  values,
  lock,
  adjust,
}: {
  snapshot: Snapshot;
  /** desired ⊕ transmitted ⊕ unsent values, as shown on screen. */
  values: LightState;
  lock: LockReason | null;
  adjust: (patch: Draft) => void;
}) {
  const disabled = lock !== null;
  return (
    <section aria-label="燈光" className="light-section">
      <div className="group-label">
        <span>燈光</span>
        {lock && <span className="group-label-end">已停用：{lock}</span>}
      </div>
      <div className="glass light-card">
        <div className={`light-controls${disabled ? " locked" : ""}`}>
          <div className="mode-row">
            <div className="segmented" role="radiogroup" aria-label="模式">
              {Object.entries(MODES).map(([key, label]) => {
                const active = values.mode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={active ? "active" : ""}
                    disabled={disabled || !supported(snapshot, "mode")}
                    onClick={() => adjust({ mode: key })}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          {SLIDERS.map((slider) => {
            const value = values[slider.key];
            return (
              <div key={slider.key} className="slider">
                <div className="slider-head">
                  <span>{slider.label}</span>
                  <span className="slider-value">
                    {value}
                    {slider.unit}
                  </span>
                </div>
                <SliderTrack
                  slider={slider}
                  value={value}
                  disabled={disabled || !supported(snapshot, slider.key)}
                  onChange={(next) => adjust({ [slider.key]: next })}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
