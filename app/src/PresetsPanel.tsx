import { useEffect, useState } from "react";
import { bridge, failure, type Preset, type PresetValues } from "./bridge";

export function PresetsPanel({ values, disabled, select }: {
  values: PresetValues;
  disabled: boolean;
  select: (values: PresetValues) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    bridge.presets().then((items) => {
      if (!cancelled) { setPresets(items); setAvailable(true); }
    }).catch((e) => {
      if (!cancelled) setMessage(failure(e).message);
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);
  async function save() {
    setBusy(true);
    try {
      // Copy only supported lighting fields; never save power or credentials.
      const { mode, front_brightness, back_brightness, temperature_k } = values;
      setPresets(await bridge.savePreset(name.trim(), { mode, front_brightness, back_brightness, temperature_k }));
      setName("");
      setMessage("情境已保存，沒有發送燈光命令。");
    } catch (e) { setMessage(failure(e).message); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true);
    try { setPresets(await bridge.deletePreset(id)); setMessage("情境已刪除。"); }
    catch (e) { setMessage(failure(e).message); }
    finally { setBusy(false); }
  }
  return <details className="presets">
    <summary>情境預設</summary>
    <p className="hint">保存目前畫面上的模式、亮度與色溫。選取只帶入草稿，按套用才發送；電源維持原設定。</p>
    <label>情境名稱<input value={name} maxLength={40} disabled={disabled || busy || !available}
      onChange={(e) => setName(e.target.value)} placeholder="例如：閱讀、夜晚" /></label>
    <button type="button" className="secondary" disabled={disabled || busy || !available || !name.trim() || presets.length >= 20}
      onClick={() => void save()}>保存為新情境</button>
    <ul className="preset-list">{presets.map((preset) => <li key={preset.id}>
      <span><strong>{preset.name}</strong><small>{({ front: "前燈", back: "後燈", both: "前後燈" })[preset.values.mode]}
        {" · 前 "}{preset.values.front_brightness}%{" · 後 "}{preset.values.back_brightness}%{" · "}{preset.values.temperature_k} K</small></span>
      <button type="button" className="secondary" disabled={disabled || busy} aria-label={`帶入情境 ${preset.name}`}
        onClick={() => { select({ ...preset.values }); setMessage("已帶入草稿，請確認後按套用燈光設定。"); }}>帶入草稿</button>
      <button type="button" className="text-button" disabled={disabled || busy} aria-label={`刪除情境 ${preset.name}`}
        onClick={() => void remove(preset.id)}>刪除</button>
    </li>)}</ul>
    {available && !presets.length && <p className="hint">尚未保存情境。</p>}
    <p className="hint" role="status">{message}</p>
  </details>;
}
