import type { LightState, Snapshot } from "./bridge";
import { adjustable, supported, tempColor, type Draft, type LockReason } from "./controlState";
import { ModeSelector } from "./ModeSelector";

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
    <div className={`slider-track ${className}${disabled ? " disabled" : ""}`.trim()}>
      <div className="track" />
      <div className="fill" style={{ width: pct }} />
      <div
        className="knob"
        style={{
          left: pct,
          background: slider.key === "temperature_k" && !disabled ? tempColor(value) : undefined,
        }}
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

export type SettingKey = "auto_dimming" | "ultrasonic_enabled";

/** Lamp settings sent as explicit on/off commands, in display order. */
export const SETTINGS: ReadonlyArray<{ key: SettingKey; title: string; desc: (on: boolean) => string }> = [
  {
    key: "auto_dimming",
    title: "自動調光",
    desc: (on) => (on ? "亮度由掛燈依環境光決定，手動調整亮度會關閉" : "掛燈依環境光自動調整亮度"),
  },
  { key: "ultrasonic_enabled", title: "入席感應", desc: () => "掛燈的超音波人體感應模式" },
];

/**
 * Mode and sliders. Every change is sent live through adjust(); power lives
 * on the lamp preview. Settings are explicit commands instead.
 */
export function LightControls({
  snapshot,
  values,
  lock,
  adjust,
  settingPending = null,
  progressShown = false,
  onSetting,
}: {
  snapshot: Snapshot;
  /** desired ⊕ transmitted ⊕ unsent values, as shown on screen. */
  values: LightState;
  lock: LockReason | null;
  adjust: (patch: Draft) => void;
  /** The setting whose command is in flight. */
  settingPending?: SettingKey | null;
  /** Our explicit command's progress is already shown (power status or setting row). */
  progressShown?: boolean;
  /** Send an explicit setting value; omitted hides the switches. */
  onSetting?: (key: SettingKey, value: boolean) => void;
}) {
  const disabled = lock !== null;
  return (
    <section aria-label="燈光" className="light-section">
      <div className="group-label">
        <span>燈光</span>
        {/* Our own command already shows its progress; no second notice. */}
        {lock && !(progressShown && lock === "處理中") && (
          <span className="group-label-end">已停用：{lock}</span>
        )}
      </div>
      <div className="glass light-card">
        <div className={`light-controls${disabled ? " locked" : ""}`}>
          <div className="mode-row">
            <ModeSelector
              mode={values.mode}
              disabled={disabled || !supported(snapshot, "mode")}
              onChange={(mode) => adjust({ mode })}
            />
          </div>
          {SLIDERS.map((slider) => {
            const value = values[slider.key];
            // A lamp the mode leaves unlit keeps its value but cannot be adjusted.
            const unlit = !adjustable(values.mode, slider.key);
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
                  disabled={disabled || unlit || !supported(snapshot, slider.key)}
                  onChange={(next) => adjust({ [slider.key]: next })}
                />
              </div>
            );
          })}
          {onSetting &&
            SETTINGS.map(({ key, title, desc }) => {
              const feature = snapshot.features[key];
              // Firmware that predates a setting does not report it at all.
              if (feature === undefined) return null;
              // Only the bridge's target is shown; nothing flips before a fresh read.
              const on = snapshot.desired.values[key] ?? false;
              const pending = settingPending === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-busy={pending}
                  aria-labelledby={`${key}-title`}
                  aria-describedby={`${key}-desc`}
                  className="switch-row setting-row"
                  disabled={disabled || !supported(snapshot, key)}
                  onClick={() => onSetting(key, !on)}
                >
                  <span className="action-text">
                    <span id={`${key}-title`} className="action-title">
                      {title}
                      {feature === "experimental" && <span className="feature-tag">實驗性</span>}
                    </span>
                    <span id={`${key}-desc`} className="action-desc">
                      {pending ? "正在送出…" : desc(on)}
                    </span>
                  </span>
                  <span className={`switch${on ? " on" : ""}`} aria-hidden="true">
                    <span />
                  </span>
                </button>
              );
            })}
        </div>
      </div>
    </section>
  );
}
