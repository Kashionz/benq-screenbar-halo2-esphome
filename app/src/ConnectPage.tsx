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
 * First-connection flow: saved profile, LAN search and login. Nothing here
 * connects on its own; only 「連線」 or 「使用已保存帳密連線」 does.
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
  const store = CREDENTIAL_STORE[platform];
  const [showPassword, setShowPassword] = useState(false);
  const field = (label: string, input: React.InputHTMLAttributes<HTMLInputElement>, trailing?: React.ReactNode) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input {...input} disabled={busy} required />
      {trailing}
    </label>
  );
  return (
    <form className="setup" onSubmit={submit}>
      <div className="setup-head">
        <h1 className="page-title">連接掛燈</h1>
      </div>
      {!native && (
        <p role="alert" className="notice">
          請在 Tauri 桌面或手機 App 中開啟；瀏覽器預覽不會連接掛燈。
        </p>
      )}
      <div className="setup-col">
        {saved && (
          <section aria-label="已保存">
            <div className="group-label">已保存</div>
            <div className="glass">
              <div className="action-row">
                <div className="action-text">
                  <div className="action-title mono">{saved.host}:{saved.port}</div>
                  <div className="action-desc">密碼存於 {store}。</div>
                </div>
                <button type="button" className="pill-button" disabled={busy || searching || !native}
                  onClick={useSaved}>
                  使用已保存帳密連線
                </button>
              </div>
              <div className="action-row">
                <div className="action-text">
                  <div className="action-title">忘記已保存連線</div>
                  <div className="action-desc">移除保存的位址、帳號與密碼。</div>
                </div>
                <button type="button" className="pill-button danger" disabled={busy}
                  aria-label="忘記已保存連線" onClick={forget}>
                  忘記
                </button>
              </div>
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
      </div>
      <section aria-label="登入" className="setup-col">
        <div>
          <div className="group-label">登入</div>
          <div className="glass">
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
            {field(
              "密碼",
              {
                type: showPassword ? "text" : "password",
                value: fields.password,
                onChange: (e) => edit({ password: e.target.value }),
                placeholder: "必填",
                autoComplete: "current-password",
                autoCapitalize: "none",
                autoCorrect: "off",
                spellCheck: false,
              },
              <button type="button" className="field-reveal" aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
                aria-pressed={showPassword} title={showPassword ? "隱藏密碼" : "顯示密碼"} disabled={busy}
                onClick={() => setShowPassword((shown) => !shown)}>
                <EyeIcon crossed={showPassword} />
              </button>,
            )}
            <button type="button" role="switch" aria-checked={remember} className="switch-row"
              aria-labelledby="remember-title" aria-describedby="remember-desc"
              disabled={busy} onClick={() => setRemember(!remember)}>
              <span className="action-text">
                <span id="remember-title" className="action-title">記住此連線與帳密</span>
                <span id="remember-desc" className="action-desc" style={{ display: "block" }}>
                  密碼存於 {store}。
                </span>
              </span>
              <span className={`switch${remember ? " on" : ""}`} aria-hidden="true">
                <span />
              </span>
            </button>
          </div>
        </div>
      </section>
      <button type="submit" className="connect-button" disabled={busy || searching || !native}>
        {busy && <span className="spinner light" aria-hidden="true" />}
        {busy ? "連線中…" : "連線"}
      </button>
      {(fault || settingsMessage || retryForget) && (
        <div className="setup-messages">
          {fault && (
            <p role="alert" className="form-error">
              {fault.message}
            </p>
          )}
          {settingsMessage && (
            <p role="status" className="group-note">
              {settingsMessage}
            </p>
          )}
          {retryForget && (
            <button type="button" className="text-button" disabled={busy} onClick={forget}>
              重試移除保存資料
            </button>
          )}
        </div>
      )}
    </form>
  );
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}
