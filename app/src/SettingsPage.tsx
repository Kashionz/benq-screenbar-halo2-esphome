import { useEffect, useState } from "react";
import { bridge, failure, type Fault, type SavedConnection, type Snapshot } from "./bridge";
import { tempColor } from "./controlState";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useMessages, type LocalePref, type Messages } from "./i18n";
import type { Platform } from "./platform";
import type { ThemePref } from "./theme";

type Tab = "device" | "look" | "startup" | "diag";

const THEMES: ThemePref[] = ["light", "dark", "system"];
const LOCALES: LocalePref[] = ["zh-TW", "en", "system"];

function pairingText(m: Messages, snapshot: Snapshot | null) {
  if (!snapshot) return "—";
  if (snapshot.pairing_status !== "ready") return m.settings.notReady;
  return snapshot.pairing_persisted ? m.settings.pairingSaved : m.settings.pairingUnsaved;
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
  locale,
  setLocale,
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
  locale: LocalePref;
  setLocale: (locale: LocalePref) => void;
  refresh: () => void;
  disconnect: () => void;
  forget: () => void;
}) {
  const m = useMessages();
  const t = m.settings;
  const [tab, setTab] = useState<Tab>("device");
  const radioReady = snapshot?.radio_status === "ready";
  const temperature = snapshot?.desired.values.temperature_k ?? 4000;
  // Launch at login exists only in the desktop App, which starts in the tray.
  const desktop = native && (platform === "windows" || platform === "macos");
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartFault, setAutostartFault] = useState<Fault | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    bridge
      .autostart()
      .then((enabled) => !cancelled && setAutostart(enabled))
      .catch((e) => !cancelled && setAutostartFault(failure(e)));
    return () => {
      cancelled = true;
    };
  }, [desktop]);
  async function toggleAutostart() {
    if (autostart === null) return;
    setAutostartBusy(true);
    setAutostartFault(null);
    try {
      setAutostart(await bridge.setAutostart(!autostart));
    } catch (e) {
      setAutostartFault(failure(e));
      // Show what the system actually holds after a failed change.
      setAutostart(await bridge.autostart().catch(() => autostart));
    } finally {
      setAutostartBusy(false);
    }
  }

  const device = (
    <div className="stack">
      <div className="glass" role="group" aria-label={t.device}>
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
            {online ? t.online : t.offline}
          </span>
        </div>
        <div className="device-facts">
          <div>
            <div className="fact-label">{t.radio}</div>
            <div className={`fact-value${radioReady ? "" : " danger"}`}>{radioReady ? t.ready : t.notReady}</div>
          </div>
          <div>
            <div className="fact-label">{t.pairing}</div>
            <div className="fact-value">{pairingText(m, snapshot)}</div>
          </div>
          <div>
            <div className="fact-label">{t.lastSync}</div>
            <div className="fact-value">{updated || "—"}</div>
          </div>
        </div>
      </div>
      <section aria-label={t.connection}>
        <div className="group-label">{t.connection}</div>
        <div className="glass">
          <ActionRow title={t.refresh} description={t.refreshDesc} label={t.refresh}
            disabled={busy} run={refresh} />
          <ActionRow title={t.change} description={t.changeDesc} label={t.disconnect}
            disabled={busy} run={disconnect} />
          {saved && (
            <ActionRow title={t.savedConnection} description={m.connect.storedIn(m.store[platform])}
              label={t.forget} name={t.forgetName} danger disabled={busy} run={forget} />
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
    <div className="stack">
      <section aria-label={t.theme}>
        <div className="group-label">{t.theme}</div>
        <div className="themes" role="radiogroup" aria-label={t.theme}>
          {THEMES.map((key) => (
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
                {t.themes[key]}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section aria-label={t.language}>
        <div className="group-label">{t.language}</div>
        <div className="glass language-card">
          <div className="segmented language-picker" role="radiogroup" aria-label={t.language}>
            {LOCALES.map((key) => (
              <button key={key} type="button" role="radio" aria-checked={locale === key}
                lang={key === "system" ? undefined : key} className={locale === key ? "active" : ""}
                onClick={() => setLocale(key)}>
                {t.languages[key]}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );

  const startup = (
    <section aria-label={t.startupTab}>
      <div className="group-label">{t.startupTab}</div>
      <div className="glass">
        <button type="button" role="switch" aria-checked={autostart === true} className="switch-row"
          aria-labelledby="autostart-title" aria-describedby="autostart-desc"
          disabled={autostart === null || autostartBusy} onClick={() => void toggleAutostart()}>
          <span className="action-text">
            <span id="autostart-title" className="action-title">{t.autostart}</span>
            <span id="autostart-desc" className="action-desc" style={{ display: "block" }}>
              {t.autostartDesc(platform)}
            </span>
          </span>
          <span className={`switch${autostart ? " on" : ""}`} aria-hidden="true">
            <span />
          </span>
        </button>
      </div>
      {autostartFault && (
        <p role="status" className="group-note">
          {m.fault(autostartFault)}
        </p>
      )}
    </section>
  );

  const diag = native ? (
    <DiagnosticsPanel raw={raw} reloadKey={updated} />
  ) : (
    <p className="group-note">{t.diagAppOnly}</p>
  );

  if (compact)
    return (
      <div className="settings-stack">
        <section aria-label={t.deviceTab}>
          <div className="group-label">{t.deviceTab}</div>
          {device}
        </section>
        {look}
        {desktop && startup}
        <section aria-label={t.diagTab}>
          <div className="group-label">{t.diagTab}</div>
          {diag}
        </section>
      </div>
    );

  const tabs: Array<{ key: Tab; label: string; meta: string; danger?: boolean }> = [
    { key: "device", label: t.deviceTab, meta: radioReady ? t.ready : t.notReady, danger: !radioReady },
    { key: "look", label: t.lookTab, meta: t.themes[theme] },
    ...(desktop
      ? [{ key: "startup" as const, label: t.startupTab, meta: autostart === null ? "" : autostart ? t.on : t.off }]
      : []),
    { key: "diag", label: t.diagTab, meta: "" },
  ];
  return (
    <div className="settings-page">
      <nav className="settings-nav" role="tablist" aria-label={t.title} aria-orientation="vertical">
        {tabs.map((item) => (
          <button key={item.key} type="button" role="tab" id={`settings-tab-${item.key}`}
            aria-selected={tab === item.key} aria-controls="settings-panel" onClick={() => setTab(item.key)}>
            <span>{item.label}</span>
            {item.meta && <span className={`nav-meta${item.danger ? " danger" : ""}`}>{item.meta}</span>}
          </button>
        ))}
      </nav>
      <div className="settings-body" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === "device" ? device : tab === "look" ? look : tab === "startup" ? startup : diag}
      </div>
    </div>
  );
}
