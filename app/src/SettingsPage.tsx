import { useState } from "react";
import type { SavedConnection, Snapshot } from "./bridge";
import { tempColor } from "./controlState";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { CREDENTIAL_STORE, type Platform } from "./platform";
import { THEME_LABELS, type ThemePref } from "./theme";

type Tab = "device" | "look" | "diag";

function pairingText(snapshot: Snapshot | null) {
  if (!snapshot) return "—";
  if (snapshot.pairing_status !== "ready") return "未就緒";
  return snapshot.pairing_persisted ? "已保存" : "未保存";
}

function ActionRow({
  title,
  description,
  label,
  name,
  danger = false,
  disabled,
  run,
}: {
  title: string;
  description: string;
  label: string;
  /** Accessible name when the visible label alone is ambiguous. */
  name?: string;
  danger?: boolean;
  disabled: boolean;
  run: () => void;
}) {
  return (
    <div className="action-row">
      <div className="action-text">
        <div className="action-title">{title}</div>
        <div className="action-desc">{description}</div>
      </div>
      <button type="button" className={`pill-button${danger ? " danger" : ""}`} disabled={disabled}
        aria-label={name} onClick={run}>
        {label}
      </button>
    </div>
  );
}

/**
 * Settings: device and connection, appearance, and the local diagnostics log.
 * Desktop shows them as tabs on the left; a narrow window stacks all three.
 */
export function SettingsPage({
  compact,
  native,
  platform,
  snapshot,
  address,
  online,
  updated,
  busy,
  saved,
  settingsMessage,
  raw,
  theme,
  setTheme,
  refresh,
  disconnect,
  forget,
}: {
  compact: boolean;
  native: boolean;
  platform: Platform;
  snapshot: Snapshot | null;
  address: string;
  online: boolean;
  updated: string;
  busy: boolean;
  saved: SavedConnection | null;
  settingsMessage: string;
  raw: unknown;
  theme: ThemePref;
  setTheme: (theme: ThemePref) => void;
  refresh: () => void;
  disconnect: () => void;
  forget: () => void;
}) {
  const [tab, setTab] = useState<Tab>("device");
  const radioReady = snapshot?.radio_status === "ready";
  const temperature = snapshot?.desired.values.temperature_k ?? 4000;

  const device = (
    <div className="stack">
      <div className="glass" role="group" aria-label="裝置">
        <div className="device-top">
          <div className="device-icon" aria-hidden="true">
            <span style={{ boxShadow: `0 0 10px ${tempColor(temperature)}` }} />
          </div>
          <div className="device-text">
            <div className="device-name">ScreenBar Halo 2</div>
            <div className="device-address">{address}</div>
          </div>
          <span className={`status-pill tone-${online ? "ok" : "warn"}`}>
            <span className={`dot${online ? "" : " pulse"}`} />
            {online ? "已連線" : "已斷線 · 重試中"}
          </span>
        </div>
        <div className="device-facts">
          <div>
            <div className="fact-label">無線模組</div>
            <div className={`fact-value${radioReady ? "" : " danger"}`}>{radioReady ? "就緒" : "未就緒"}</div>
          </div>
          <div>
            <div className="fact-label">配對</div>
            <div className="fact-value">{pairingText(snapshot)}</div>
          </div>
          <div>
            <div className="fact-label">最後同步</div>
            <div className="fact-value">{updated || "—"}</div>
          </div>
        </div>
      </div>
      <section aria-label="連線">
        <div className="group-label">連線</div>
        <div className="glass">
          <ActionRow title="重新整理" description="立即向控制盒讀取最新狀態。" label="重新整理"
            disabled={busy} run={refresh} />
          <ActionRow title="更換裝置" description="中斷目前連線，回到連線畫面。" label="中斷連線"
            disabled={busy} run={disconnect} />
          {saved && (
            <ActionRow title="已保存的連線" description={`密碼存於 ${CREDENTIAL_STORE[platform]}。`}
              label="忘記" name="忘記已保存連線" danger disabled={busy} run={forget} />
          )}
        </div>
        {settingsMessage && (
          <p role="status" className="group-note">
            {settingsMessage}
          </p>
        )}
      </section>
    </div>
  );

  const look = (
    <section aria-label="主題">
      <div className="group-label">主題</div>
      <div className="themes" role="radiogroup" aria-label="主題">
        {(Object.keys(THEME_LABELS) as ThemePref[]).map((key) => (
          <button key={key} type="button" role="radio" aria-checked={theme === key}
            className={`theme-card theme-${key}`} onClick={() => setTheme(key)}>
            <div className="theme-preview" aria-hidden="true">
              <div className="half" />
              {key === "system" && <div className="half" />}
              <div className="bar" />
              <div className="card a" />
              <div className="card b" />
            </div>
            <span className="theme-label">
              <span className="radio-mark" aria-hidden="true" />
              {THEME_LABELS[key]}
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  const diag = native ? (
    <DiagnosticsPanel raw={raw} reloadKey={updated} />
  ) : (
    <p className="group-note">診斷紀錄只在 App 中提供。</p>
  );

  if (compact)
    return (
      <div className="settings-stack">
        <section aria-label="裝置與連線">
          <div className="group-label">裝置與連線</div>
          {device}
        </section>
        {look}
        <section aria-label="診斷紀錄">
          <div className="group-label">診斷紀錄</div>
          {diag}
        </section>
      </div>
    );

  const tabs: Array<{ key: Tab; label: string; meta: string; danger?: boolean }> = [
    { key: "device", label: "裝置與連線", meta: radioReady ? "就緒" : "未就緒", danger: !radioReady },
    { key: "look", label: "外觀", meta: THEME_LABELS[theme] },
    { key: "diag", label: "診斷紀錄", meta: "" },
  ];
  return (
    <div className="settings-page">
      <nav className="settings-nav" role="tablist" aria-label="設定" aria-orientation="vertical">
        {tabs.map((item) => (
          <button key={item.key} type="button" role="tab" id={`settings-tab-${item.key}`}
            aria-selected={tab === item.key} aria-controls="settings-panel" onClick={() => setTab(item.key)}>
            <span>{item.label}</span>
            {item.meta && <span className={`nav-meta${item.danger ? " danger" : ""}`}>{item.meta}</span>}
          </button>
        ))}
      </nav>
      <div className="settings-body" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === "device" ? device : tab === "look" ? look : diag}
      </div>
    </div>
  );
}
