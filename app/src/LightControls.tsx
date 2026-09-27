import { useState } from "react";
import type { LightState, Snapshot } from "./bridge";

export type LightPatch = Partial<Omit<LightState, "ultrasonic_enabled">>;
export function LightControls({
  snapshot,
  disabled,
  send,
}: {
  snapshot: Snapshot;
  disabled: boolean;
  send: (patch: LightPatch, experimental: boolean) => Promise<boolean>;
}) {
  const [experimental, setExperimental] = useState(false);
  const [draft, setDraft] = useState<LightPatch>({});
  const values = { ...snapshot.desired.values, ...draft };
  const supported = (key: string) =>
    snapshot.features[key] === "verified" ||
    (experimental && snapshot.features[key] === "experimental");
  const keys = Object.keys(draft);
  return (
    <section className="light-settings">
      <h3>前後燈與色溫</h3>
      <label className="experimental-toggle">
        <input
          type="checkbox"
          checked={experimental}
          disabled={disabled}
          onChange={(e) => {
            setExperimental(e.target.checked);
            setDraft({});
          }}
        />
        啟用實驗性控制（尚待實機驗證）
      </label>
      <label>
        照明模式
        <select
          aria-label="照明模式"
          value={values.mode}
          disabled={disabled || !supported("mode")}
          onChange={(e) => setDraft((d) => ({ ...d, mode: e.target.value }))}
        >
          <option value="front">前燈</option>
          <option value="back">後燈</option>
          <option value="both">前後燈</option>
        </select>
      </label>
      {(["front_brightness", "back_brightness", "temperature_k"] as const).map(
        (key) => {
          const temperature = key === "temperature_k";
          const label = temperature
            ? "色溫"
            : key === "front_brightness"
              ? "前燈亮度"
              : "後燈亮度";
          return (
            <label key={key}>
              {label}：{values[key]} {temperature ? "K" : "%"}
              <input
                aria-label={label}
                type="range"
                min={temperature ? 2700 : 1}
                max={temperature ? 6500 : 100}
                step={temperature ? 25 : 1}
                value={values[key]}
                disabled={disabled || !supported(key)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [key]: Number(e.target.value) }))
                }
              />
            </label>
          );
        },
      )}
      <p className="hint">
        拖曳只預覽，按套用才發送。只修改你調整過的欄位，其餘沿用橋接器最新設定。
      </p>
      <div className="power-actions">
        <button
          className="primary"
          disabled={disabled || !keys.length || keys.some((k) => !supported(k))}
          onClick={async () => {
            if (await send(draft, experimental)) setDraft({});
          }}
        >
          套用燈光設定
        </button>
        <button
          className="secondary"
          disabled={disabled || !keys.length}
          onClick={() => setDraft({})}
        >
          取消調整
        </button>
      </div>
    </section>
  );
}
