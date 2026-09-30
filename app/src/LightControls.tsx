import type { LightState, Snapshot } from "./bridge";
import { adjustable, supported, tempColor, type Draft, type LockReason } from "./controlState";
import { useMessages } from "./i18n";
import { ModeSelector } from "./ModeSelector";

export type { LightPatch } from "./controlState";

export const SLIDERS = [
  { key: "front_brightness", min: 1, max: 100, step: 1, unit: "%" },
  { key: "back_brightness", min: 1, max: 100, step: 1, unit: "%" },
  { key: "temperature_k", min: 2700, max: 6500, step: 25, unit: " K" },
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
  const m = useMessages();
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
        aria-label={m.lights.sliders[slider.key].name}
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

/** Lamp settings sent as explicit on/off commands, in display order; texts are in Messages.lights.settings. */
export const SETTINGS: readonly SettingKey[] = ["auto_dimming", "ultrasonic_enabled"];

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
  const m = useMessages();
  const disabled = lock !== null;
  return (
    <section aria-label={m.lights.section} className="light-section">
      <div className="group-label">
        <span>{m.lights.section}</span>
        {/* Our own command already shows its progress; no second notice. */}
        {lock && !(progressShown && lock === "busy") && (
          <span className="group-label-end">{m.lights.disabled(m.lock[lock])}</span>
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
                  <span>{m.lights.sliders[slider.key].label}</span>
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
            SETTINGS.map((key) => {
              const { title, desc } = m.lights.settings[key];
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
                      {feature === "experimental" && <span className="feature-tag">{m.lights.experimental}</span>}
                    </span>
                    <span id={`${key}-desc`} className="action-desc">
                      {pending ? m.lights.sendingSetting : desc(on)}
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
