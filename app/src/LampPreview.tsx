import type { LightState } from "./bridge";
import { beamColor, beamLevels, modeLabel, tempColor, type Feedback, type LockReason } from "./controlState";
import { PowerIcon } from "./LightControls";
import { StatusLine, powerLine } from "./StatusCards";

/**
 * Side-view sketch of the target, never of the lamp's real state, with the
 * power button and the command status beside it. Mode, brightness and
 * temperature follow the values being adjusted; power only follows
 * desired.power because adjustments never contain power. Power sends one
 * explicit value (never a toggle) derived from desired.power.
 */
export function LampPreview({
  power,
  preview,
  online,
  lock,
  powerPending = false,
  status = null,
  onPower,
}: {
  power: boolean;
  preview: LightState;
  online: boolean;
  lock: LockReason | null;
  /** Its own power command is in flight: keep the look, ignore repeat presses. */
  powerPending?: boolean;
  /** Command status shown in place of the power hint (sending, failure, result). */
  status?: Feedback | null;
  onPower: (value: boolean) => void;
}) {
  const levels = beamLevels(power, preview);
  const beam = beamColor(preview.temperature_k);
  const glow = tempColor(preview.temperature_k);
  const next = power ? "關燈" : "開燈";
  // A power command in flight locks everything else as 處理中, but the power
  // button keeps its normal look; repeat presses are ignored here.
  const disabled = lock !== null && !powerPending;
  return (
    <div className={`glass preview${online ? "" : " offline"}`} data-testid="lamp-preview">
      <div className="preview-scene" aria-hidden="true">
        <div className="preview-wall" />
        <div className="preview-desk" />
        <div className="preview-beam front" style={{ background: beam, opacity: levels.front }} />
        <div className="preview-beam back" style={{ background: beam, opacity: levels.back }} />
        <div className="preview-spill front" style={{ background: glow, opacity: levels.front }} />
        <div className="preview-spill back" style={{ background: glow, opacity: levels.back }} />
        <div className="preview-monitor" />
        <div className="preview-stand" />
        <div className="preview-foot" />
        <div
          className="preview-bar"
          style={{ boxShadow: power ? `0 0 18px ${glow}, 0 0 4px ${glow}` : "none" }}
        />
        <span className="preview-tag front">前 {levels.front ? `${preview.front_brightness}%` : "—"}</span>
        <span className="preview-tag back">後 {levels.back ? `${preview.back_brightness}%` : "—"}</span>
        <span className="preview-temp">{preview.temperature_k} K</span>
      </div>
      <div className="preview-info">
        <span className="preview-caption">目標示意</span>
        <div className="preview-power">
          <button
            type="button"
            className={`power-button${power ? " on" : ""}`}
            disabled={disabled}
            aria-disabled={powerPending || undefined}
            aria-label={next}
            title={next}
            onClick={() => {
              if (!powerPending) onPower(!power);
            }}
          >
            <PowerIcon size={26} />
          </button>
          <div className="preview-power-text">
            <div className="power-state">{power ? "開啟" : "關閉"}</div>
            <div className="power-sub">
              {power ? `${modeLabel(preview.mode)} · ${preview.temperature_k} K` : "燈已關閉"}
            </div>
            <StatusLine line={powerLine(status, next)} />
          </div>
        </div>
      </div>
    </div>
  );
}
