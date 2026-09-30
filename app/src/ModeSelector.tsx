import { useId } from "react";
import { LazyMotion, MotionConfig, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { MODES } from "./controlState";

const loadMotionFeatures = () => import("./motionFeatures").then((module) => module.default);

/** The highlight follows the selected target mode in both control surfaces. */
export function ModeSelector({
  mode,
  disabled,
  className = "",
  onChange,
}: {
  mode: string | null;
  disabled: boolean;
  className?: string;
  onChange: (mode: string) => void;
}) {
  const highlightId = useId();
  const reducedMotion = useReducedMotion();

  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <div className={`segmented${className ? ` ${className}` : ""}`} role="radiogroup" aria-label="模式">
          {Object.entries(MODES).map(([key, label]) => {
            const active = mode === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={active}
                className={active ? "active" : ""}
                disabled={disabled}
                onClick={() => onChange(key)}
              >
                {active && (
                  <m.span
                    className="mode-highlight"
                    layoutId={highlightId}
                    transition={reducedMotion ? { duration: 0 } : { type: "spring", visualDuration: 0.28, bounce: 0.08 }}
                    aria-hidden="true"
                  />
                )}
                <span className="mode-label">{label}</span>
              </button>
            );
          })}
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
