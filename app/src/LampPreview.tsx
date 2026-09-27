import type { LightState } from "./bridge";
import { beamColor, beamLevels, tempColor } from "./controlState";

/**
 * Side-view sketch of the target, never of the lamp's real state. Mode,
 * brightness and temperature follow the preview (desired ⊕ draft); power only
 * follows desired.power because a draft never contains power.
 */
export function LampPreview({
  power,
  preview,
  drafted,
  online,
}: {
  power: boolean;
  preview: LightState;
  drafted: boolean;
  online: boolean;
}) {
  const levels = beamLevels(power, preview);
  const beam = beamColor(preview.temperature_k);
  return (
    <div
      className={`group preview${online ? "" : " offline"}`}
      data-testid="lamp-preview"
      aria-hidden="true"
    >
      <div className="preview-wall" />
      <div className="preview-desk" />
      <div className="preview-beam front" style={{ background: beam, opacity: levels.front }} />
      <div className="preview-beam back" style={{ background: beam, opacity: levels.back }} />
      <div className="preview-monitor" />
      <div className="preview-stand" />
      <div className="preview-foot" />
      <div
        className="preview-bar"
        style={{ boxShadow: power ? `0 0 14px ${tempColor(preview.temperature_k)}` : "none" }}
      />
      <span className="preview-tag front">
        前 {levels.front ? `${preview.front_brightness}%` : "—"}
      </span>
      <span className="preview-tag back">
        後 {levels.back ? `${preview.back_brightness}%` : "—"}
      </span>
      <span className="preview-caption">{drafted ? "預覽 · 尚未套用" : "目標示意"}</span>
      <span className="preview-temp">{preview.temperature_k} K</span>
    </div>
  );
}
