import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bridge, failure, type Preset, type PresetValues } from "./bridge";
import { lightSummary, samePreset, tempColor } from "./controlState";

export const MAX_PRESETS = 4;
const UNDO_MS = 6000;

/** 「4300 K · 70/30%」 */
const tileSummary = (v: PresetValues) => `${v.temperature_k} K · ${v.front_brightness}/${v.back_brightness}%`;

/**
 * Up to four local presets. Tapping one sends its lighting values once
 * through select() (never power). Adding, deleting and undo only touch the
 * local store; none of them sends anything to the lamp.
 */
export function PresetsPanel({
  values,
  disabled,
  select,
}: {
  values: PresetValues;
  /** Controls are locked: tiles cannot be applied and nothing new is saved. */
  disabled: boolean;
  select: (values: PresetValues) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [confirm, setConfirm] = useState<Preset | null>(null);
  const [undo, setUndo] = useState<{ preset: Preset; index: number } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    bridge
      .presets()
      .then((items) => {
        if (!mounted.current) return;
        setPresets(items);
        setAvailable(true);
      })
      .catch((e) => {
        if (mounted.current) setMessage(failure(e).message);
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
    return () => {
      mounted.current = false;
      window.clearTimeout(undoTimer.current);
    };
  }, []);
  const showAdd = adding && !disabled;
  useEffect(() => {
    if (!showAdd && !confirm) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirm) setConfirm(null);
      else setAdding(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [showAdd, confirm]);

  const full = presets.length >= MAX_PRESETS;
  const canAdd = available && !busy && !disabled && !full;
  const clearUndo = () => {
    window.clearTimeout(undoTimer.current);
    setUndo(null);
  };
  async function run(action: () => Promise<Preset[]>) {
    setBusy(true);
    setMessage("");
    try {
      const next = await action();
      if (mounted.current) setPresets(next);
      return next;
    } catch (e) {
      if (mounted.current) setMessage(failure(e).message);
      return null;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    const name = draftName.trim();
    if (!name || !canAdd) return;
    // Copy only the lighting fields; never power or credentials.
    const { mode, front_brightness, back_brightness, temperature_k } = values;
    const next = await run(() => bridge.savePreset(name, { mode, front_brightness, back_brightness, temperature_k }));
    if (next && mounted.current) {
      setAdding(false);
      setDraftName("");
    }
  }
  async function remove(preset: Preset) {
    setConfirm(null);
    const index = presets.findIndex((p) => p.id === preset.id);
    const next = await run(() => bridge.deletePreset(preset.id));
    if (!next || !mounted.current) return;
    window.clearTimeout(undoTimer.current);
    setUndo({ preset, index });
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
    if (!next.length) setEditing(false);
  }
  async function restore() {
    if (!undo) return;
    const { preset, index } = undo;
    clearUndo();
    await run(() => bridge.restorePreset(preset, index));
  }
  const empty = Math.max(0, MAX_PRESETS - presets.length);
  return (
    <section aria-label="情境" className="presets">
      <div className="presets-head">
        <span>
          情境<span className="num"> · {presets.length}/{MAX_PRESETS}</span>
        </span>
        {undo ? (
          <>
            <span className="undo-text" role="status">已刪除「{undo.preset.name}」</span>
            <button type="button" className="link strong" disabled={busy} onClick={() => void restore()}>
              復原
            </button>
          </>
        ) : (
          <button
            type="button"
            className="link"
            disabled={!canAdd}
            title={full ? "最多 4 組情境" : "以目前設定新增情境"}
            onClick={() => {
              setAdding(true);
              setDraftName("");
              setEditing(false);
            }}
          >
            ＋ 新增
          </button>
        )}
        <span className="head-sep" aria-hidden="true" />
        <button
          type="button"
          className={`link${editing ? " strong" : ""}`}
          aria-pressed={editing}
          disabled={!editing && !presets.length}
          onClick={() => {
            if (editing) {
              setEditing(false);
              clearUndo();
            } else {
              setEditing(true);
              setAdding(false);
            }
          }}
        >
          {editing ? "完成" : "編輯"}
        </button>
      </div>
      <div className="glass presets-card">
        <div className={`tiles${disabled && !editing ? " locked" : ""}`}>
          {presets.map((preset) => {
            const active = !editing && samePreset(preset.values, values);
            return (
              <div key={preset.id} className="tile-slot">
                <button
                  type="button"
                  className={`tile${active ? " active" : ""}${editing ? " editing" : ""}`}
                  title={lightSummary(preset.values)}
                  aria-label={`帶入情境 ${preset.name}`}
                  aria-pressed={active}
                  disabled={disabled || busy || editing}
                  onClick={() => select({ ...preset.values })}
                >
                  <span className="swatch" style={{ background: tempColor(preset.values.temperature_k) }} />
                  <span className="tile-text">
                    <span className="tile-name">{preset.name}</span>
                    <span className="tile-sub">{tileSummary(preset.values)}</span>
                  </span>
                </button>
                {editing && (
                  <button
                    type="button"
                    className="tile-delete"
                    aria-label={`刪除情境 ${preset.name}`}
                    title="刪除"
                    disabled={busy}
                    onClick={() => setConfirm(preset)}
                  >
                    −
                  </button>
                )}
              </div>
            );
          })}
          {Array.from({ length: empty }, (_, index) => (
            <div key={`empty-${index}`} className="tile-empty" aria-hidden="true" />
          ))}
        </div>
      </div>
      {showAdd && (
        <form
          className="add-panel"
          aria-label="新增情境"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="add-row">
            <span className="add-title">新增情境</span>
            <span className="add-hint">以目前的燈光設定保存</span>
          </div>
          <div className="add-row">
            <span className="swatch" style={{ background: tempColor(values.temperature_k) }} />
            <input
              aria-label="情境名稱"
              value={draftName}
              maxLength={40}
              placeholder="名稱"
              autoFocus
              onChange={(e) => setDraftName(e.target.value.slice(0, 40))}
            />
          </div>
          <div className="add-row">
            <span className="add-summary ellipsis">{lightSummary(values)}</span>
            <button type="button" className="text-pill" onClick={() => setAdding(false)}>
              取消
            </button>
            <button type="submit" className="primary-pill" disabled={!draftName.trim() || busy}>
              保存
            </button>
          </div>
        </form>
      )}
      {message && (
        <p role="status" className="group-note err">
          {message}
        </p>
      )}
      {confirm &&
        createPortal(
          <div className="scrim" onClick={() => setConfirm(null)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="preset-delete-title"
              className="dialog"
              onClick={(event) => event.stopPropagation()}
            >
              <div id="preset-delete-title" className="dialog-title">
                刪除這個情境？
              </div>
              <div className="dialog-preview">
                <span className="swatch" style={{ background: tempColor(confirm.values.temperature_k) }} />
                <div className="dialog-preview-text">
                  <span className="ellipsis">{confirm.name}</span>
                  <span className="ellipsis">{lightSummary(confirm.values)}</span>
                </div>
              </div>
              <div className="dialog-actions">
                <button type="button" className="cancel" autoFocus onClick={() => setConfirm(null)}>
                  取消
                </button>
                <button type="button" className="destructive" onClick={() => void remove(confirm)}>
                  刪除
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
