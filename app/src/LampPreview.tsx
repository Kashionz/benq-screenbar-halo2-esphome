import { LazyMotion, MotionConfig, useReducedMotion } from "motion/react";
import * as motion from "motion/react-m";
import type { LightState } from "./bridge";
import { beamColor, beamLevels, modeLabel, tempColor, type Feedback, type LockReason } from "./controlState";
import { useMessages } from "./i18n";
import { PowerIcon } from "./LightControls";
import { StatusLine, powerLine } from "./StatusCards";

const loadMotionFeatures = () => import("./motionFeatures").then((module) => module.default);

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
  const m = useMessages();
  const levels = beamLevels(power, preview);
  const beam = beamColor(preview.temperature_k);
  const glow = tempColor(preview.temperature_k);
  const reducedMotion = useReducedMotion();
  const beamTransition = { duration: reducedMotion ? 0 : 0.35, ease: "easeOut" as const };
  const next = m.action.power(!power);
  // A power command in flight locks everything else as 處理中, but the power
  // button keeps its normal look; repeat presses are ignored here.
  const disabled = lock !== null && !powerPending;
  return (
    <div className={`glass preview${online ? "" : " offline"}`} data-testid="lamp-preview">
      <LazyMotion features={loadMotionFeatures} strict>
        <MotionConfig reducedMotion="user">
          <div className="preview-scene" aria-hidden="true">
            <div className="preview-wall" />
            <div className="preview-desk" />
            <motion.div className="preview-beam front" style={{ background: beam }} initial={false}
              animate={{ opacity: levels.front }} transition={beamTransition} />
            <motion.div className="preview-beam back" style={{ background: beam }} initial={false}
              animate={{ opacity: levels.back }} transition={beamTransition} />
            <motion.div className="preview-spill front" style={{ background: glow }} initial={false}
              animate={{ opacity: levels.front }} transition={beamTransition} />
            <motion.div className="preview-spill back" style={{ background: glow }} initial={false}
              animate={{ opacity: levels.back }} transition={beamTransition} />
            <div className="preview-monitor" />
            <div className="preview-stand" />
            <div className="preview-foot" />
            <div
              className="preview-bar"
              style={{ boxShadow: power ? `0 0 18px ${glow}, 0 0 4px ${glow}` : "none" }}
            />
            <span className="preview-tag front">{m.preview.front} {levels.front ? `${preview.front_brightness}%` : "—"}</span>
            <span className="preview-tag back">{m.preview.back} {levels.back ? `${preview.back_brightness}%` : "—"}</span>
            <span className="preview-temp">{preview.temperature_k} K</span>
          </div>
        </MotionConfig>
      </LazyMotion>
      <div className="preview-info">
        <span className="preview-caption">{m.preview.caption}</span>
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
            <div className="power-state">{power ? m.power.on : m.power.off}</div>
            <div className="power-sub">
              {power ? `${modeLabel(m, preview.mode)} · ${preview.temperature_k} K` : m.power.lightOff}
            </div>
            <StatusLine line={powerLine(m, status, next)} />
          </div>
        </div>
      </div>
    </div>
  );
}
