import { useState } from "react";
import type { DiscoveredBridge, Fault, SavedConnection } from "./bridge";
import { DiscoveryPanel } from "./DiscoveryPanel";
import { CREDENTIAL_STORE, type Platform } from "./platform";

export interface ConnectionFields {
  host: string;
  port: number;
  username: string;
  password: string;
}

/**
 * First-connection flow: saved profile, LAN search and manual entry. Nothing
 * here connects on its own; only 「連線」 or 「使用已保存帳密連線」 does.
 */
export function ConnectPage({
  native,
  platform,
  busy,
  fields,
  edit,
  remember,
  setRemember,
  saved,
  fault,
  settingsMessage,
  retryForget,
  submit,
  useSaved,
  forget,
  pick,
}: {
  native: boolean;
  platform: Platform;
  busy: boolean;
  fields: ConnectionFields;
  edit: (patch: Partial<ConnectionFields>) => void;
  remember: boolean;
  setRemember: (value: boolean) => void;
  saved: SavedConnection | null;
  fault: Fault | null;
  settingsMessage: string;
  retryForget: boolean;
  submit: (event: React.FormEvent) => void;
  useSaved: () => void;
  forget: () => void;
  pick: (candidate: DiscoveredBridge) => void;
}) {
  const [searching, setSearching] = useState(false);
  const field = (
    label: string,
    input: React.InputHTMLAttributes<HTMLInputElement>,
  ) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input {...input} disabled={busy} required />
    </label>
  );
  return (
    <div className="setup">
      {!native && (
        <p role="alert" className="notice">
          請在 Tauri 桌面或手機 App 中開啟；瀏覽器預覽不會連接燈具。
        </p>
      )}
      <div>
        <h1 className="page-title">連線橋接器</h1>
        <p className="page-subtitle">本機連線，不經雲端。</p>
      </div>
      {saved && (
        <section aria-label="已保存">
          <div className="group-label">已保存</div>
          <div className="group">
            <div className="kv saved-address">
              <span>{saved.host}:{saved.port}</span>
            </div>
            <button type="button" className="list-button" disabled={busy || searching || !native}
              onClick={useSaved}>
              使用已保存帳密連線
            </button>
            <button type="button" className="list-button danger" disabled={busy} onClick={forget}>
              忘記已保存連線
            </button>
          </div>
        </section>
      )}
      <DiscoveryPanel
        disabled={busy || !native}
        dimmed={busy}
        current={`${fields.host}:${fields.port}`}
        platform={platform}
        onSearching={setSearching}
        select={pick}
      />
      <form className="setup-form" onSubmit={submit}>
        <section aria-label="手動輸入">
          <div className="group-label">手動輸入</div>
          <div className="group">
            {field("主機", {
              value: fields.host,
              onChange: (e) => edit({ host: e.target.value }),
              placeholder: "192.168.1.10",
              autoCapitalize: "none",
              autoCorrect: "off",
              spellCheck: false,
            })}
            {field("連接埠", {
              type: "number",
              inputMode: "numeric",
              min: 1,
              max: 65535,
              value: fields.port,
              onChange: (e) => edit({ port: Number(e.target.value) }),
            })}
            {field("帳號", {
              value: fields.username,
              onChange: (e) => edit({ username: e.target.value }),
              placeholder: "必填",
              autoComplete: "username",
              autoCapitalize: "none",
            })}
            {field("密碼", {
              type: "password",
              value: fields.password,
              onChange: (e) => edit({ password: e.target.value }),
              placeholder: "必填",
              autoComplete: "current-password",
            })}
            <button type="button" role="switch" aria-checked={remember} className="list-button switch-row"
              disabled={busy} onClick={() => setRemember(!remember)}>
              <span>記住此連線與帳密</span>
              <span className={`switch${remember ? " on" : ""}`} aria-hidden="true">
                <span className="knob-small" />
              </span>
            </button>
          </div>
          <p className="group-note">密碼存於{CREDENTIAL_STORE[platform]}</p>
        </section>
        <button type="submit" className="connect-button" disabled={busy || searching || !native}>
          {busy && <span className="spinner light" aria-hidden="true" />}
          {busy ? "連線中…" : "連線"}
        </button>
      </form>
      {fault && (
        <p role="alert" className="form-error">
          {fault.message}
        </p>
      )}
      {settingsMessage && (
        <p role="status" className="group-note tight">
          {settingsMessage}
        </p>
      )}
      {retryForget && (
        <button type="button" className="text-button" disabled={busy} onClick={forget}>
          重試移除保存資料
        </button>
      )}
    </div>
  );
}
