import { useEffect, useState } from "react";
import { bridge, failure, type Preset, type PresetValues } from "./bridge";
import { lightSummary } from "./controlState";

const same = (a: PresetValues, b: PresetValues) =>
  a.mode === b.mode &&
  a.front_brightness === b.front_brightness &&
  a.back_brightness === b.back_brightness &&
  a.temperature_k === b.temperature_k;

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
  const [editing, setEditing] = useState(false);
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
      setMessage("已保存");
    } catch (e) { setMessage(failure(e).message); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true);
    try { setPresets(await bridge.deletePreset(id)); setMessage("情境已刪除。"); }
    catch (e) { setMessage(failure(e).message); }
    finally { setBusy(false); }
  }
  return <div className="presets">
    <div className="presets-head">
      <span>情境</span>
      <button type="button" className="link" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
        {editing ? "完成" : "編輯"}
      </button>
    </div>
    <div className="pills">
      {presets.map((preset) => (
        <button key={preset.id} type="button"
          className={`pill${same(preset.values, values) ? " active" : ""}`}
          title={lightSummary(preset.values)} disabled={disabled || busy}
          aria-label={`帶入情境 ${preset.name}`}
          onClick={() => { select({ ...preset.values }); setMessage(""); }}>
          {preset.name}
        </button>
      ))}
      {available && !presets.length && <span className="muted">尚未保存情境</span>}
    </div>
    {editing && <div className="preset-editor">
      {presets.map((preset) => <div key={preset.id} className="preset-row">
        <span className="preset-text"><span>{preset.name}</span><small>{lightSummary(preset.values)}</small></span>
        <button type="button" className="link danger" disabled={disabled || busy}
          aria-label={`刪除情境 ${preset.name}`} onClick={() => void remove(preset.id)}>刪除</button>
      </div>)}
      <div className="preset-row">
        <input aria-label="情境名稱" value={name} maxLength={40} placeholder="以目前設定新增情境"
          disabled={disabled || busy || !available} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="link" aria-label="保存為新情境"
          disabled={disabled || busy || !available || !name.trim() || presets.length >= 20}
          onClick={() => void save()}>保存</button>
      </div>
    </div>}
    {message && <p className="preset-message" role="status">{message}</p>}
  </div>;
}
