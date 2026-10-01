import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  bridge,
  failure,
  type Snapshot,
  type CommandRecord,
  type Fault,
  type SavedConnection,
} from "./bridge";
import "./halo.css";
import { LightControls, type SettingKey } from "./LightControls";
import { LampPreview } from "./LampPreview";
import { PresetsPanel } from "./PresetsPanel";
import { Banner, ConnectionStatus, type BannerSpec } from "./StatusCards";
import {
  LIGHT_KEYS,
  commandFeedback,
  litOnly,
  type Feedback,
  lockReason,
  pendingDraft,
  stageDraft,
  type Draft,
  type LightKey,
} from "./controlState";
import { SettingsPage } from "./SettingsPage";
import { useFlyoutHost } from "./useFlyoutHost";
import { ConnectPage } from "./ConnectPage";
import { detectPlatform } from "./platform";
import { PHONE_QUERY, SINGLE_COLUMN_QUERY, useMedia } from "./useCompact";
import { loadTheme, saveTheme, useDocumentTheme, useResolvedTheme, type ThemePref } from "./theme";
import {
  I18nContext,
  MESSAGES,
  loadLocale,
  resolveLocale,
  saveLocale,
  useDocumentLocale,
  type LocalePref,
  type Messages,
  type Text,
} from "./i18n";

// The bridge accepts one command per 500 ms; keep a small margin.
const LIVE_INTERVAL_MS = 550;
type Outcome = "transmitted" | "not_transmitted" | "unknown" | "skipped";
// power and setting are explicit presses that lock every control; light is live.
type Kind = "power" | "light" | "setting";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function App() {
  const [host, setHost] = useState("screenbar-halo2.local");
  const [port, setPort] = useState(8080);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState<SavedConnection | null>(null);
  const [remember, setRemember] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<Text | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<Fault | null>(null);
  const [networkFault, setNetworkFault] = useState<Fault | null>(null);
  const [result, setResult] = useState<CommandRecord | null>(null);
  const [updated, setUpdated] = useState("");
  // draft: values the user changed that have not been sent yet.
  // sent: values transmitted but not yet confirmed by the next state read.
  const [draft, setDraftState] = useState<Draft>({});
  const [sent, setSentState] = useState<Draft>({});
  const [panel, setPanel] = useState<"main" | "settings">("main");
  const [sending, setSending] = useState<null | Kind>(null);
  // Kind of the most recent command, so only power flashes its confirmation.
  const [sentKind, setSentKind] = useState<Kind | null>(null);
  const [action, setAction] = useState<Text | null>(null);
  const [rebooted, setRebooted] = useState(false);
  const [storeError, setStoreError] = useState(false);
  // A transmitted power command is confirmed next to the button for a moment.
  const [flash, setFlash] = useState<string | null>(null);
  const generation = useRef(0);
  const refreshing = useRef<Promise<Snapshot | null> | null>(null);
  const commanding = useRef(false);
  const connectionEdited = useRef(false);
  // Started at login in the tray with a saved connection; ends on disconnect.
  const autoConnect = useRef(false);
  const lastBoot = useRef<string | null>(null);
  const draftRef = useRef<Draft>({});
  const sentRef = useRef<Draft>({});
  const snapshotRef = useRef<Snapshot | null>(null);
  const lockRef = useRef<string | null>(null);
  const pumping = useRef(false);
  const lastSend = useRef(0);
  const inflight = useRef<Promise<Outcome> | null>(null);
  const lastOutcome = useRef<Outcome | null>(null);
  const explicitRequested = useRef(false);
  // Which setting the explicit "setting" command is for, while it runs.
  const settingKey = useRef<SettingKey | null>(null);
  const setDraft = useCallback((next: Draft) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const setSent = useCallback((next: Draft) => {
    sentRef.current = next;
    setSentState(next);
  }, []);
  const native = isTauri();
  const single = useMedia(SINGLE_COLUMN_QUERY);
  const phone = useMedia(PHONE_QUERY);
  const platform = detectPlatform();
  const [themePref, setThemePref] = useState<ThemePref>(loadTheme);
  const theme = useResolvedTheme(themePref);
  useDocumentTheme(theme);
  const [localePref, setLocalePref] = useState<LocalePref>(loadLocale);
  const locale = resolveLocale(localePref);
  const m = MESSAGES[locale];
  useDocumentLocale(m, m.appName);
  useEffect(() => {
    // The native title bar follows the App theme; the tray gets it published.
    if (native) void bridge.windowTheme(theme === "dark").catch(() => {});
  }, [native, theme]);
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    bridge
      .saved()
      .then(async (profile) => {
        if (cancelled) return;
        setSaved(profile);
        if (profile && !connectionEdited.current) {
          setHost(profile.host);
          setPort(profile.port);
          setUsername(profile.username);
          // Started at login in the tray: connect (read-only) with the saved
          // connection so the tray works without opening the window.
          const hidden = await bridge.launchedHidden().catch(() => false);
          if (cancelled || !hidden || connectionEdited.current) return;
          autoConnect.current = true;
          await establish(bridge.connectSaved, false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setSettingsMessage(() => (m: Messages) => m.fault(failure(e)));
          setStoreError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [native]);
  const accept = useCallback((next: Snapshot) => {
    if (lastBoot.current && lastBoot.current !== next.boot_id) {
      // A reboot invalidates earlier results and any draft built on the old target.
      setRebooted(true);
      setDraft({});
    }
    lastBoot.current = next.boot_id;
    // A fresh read replaces values we were only assuming after transmission.
    setSent({});
    setResult((current) => current?.boot_id === next.boot_id ? current : null);
    setSnapshot((current) =>
      current &&
      current.boot_id === next.boot_id &&
      current.state_version > next.state_version
        ? current
        : next,
    );
    setOnline(true);
    setNetworkFault(null);
    setUpdated(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
  }, [setDraft, setSent]);
  const refresh = useCallback(() => {
    if (commanding.current) return Promise.resolve(null);
    if (refreshing.current) return refreshing.current;
    const token = generation.current;
    const pending = (async () => {
      try {
        const next = await bridge.state();
        if (token === generation.current) accept(next);
        return next;
      } catch (e) {
        if (token === generation.current && failure(e).code !== "BUSY") {
          setOnline(false);
          setNetworkFault(failure(e));
        }
        return null;
      } finally {
        refreshing.current = null;
      }
    })();
    refreshing.current = pending;
    return pending;
  }, [accept]);
  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2000);
    const resume = () => {
      // Unsent adjustments never survive a trip to the background.
      if (document.hidden) setDraft({});
      else void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [connected, refresh, setDraft]);
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    await establish(
      () => bridge.connect(host.trim(), port, username, password),
      remember,
    );
  }
  async function establish(load: () => Promise<Snapshot>, save: boolean) {
    const token = ++generation.current;
    setBusy(true);
    setFault(null);
    setNetworkFault(null);
    setResult(null);
    try {
      const next = await load();
      if (token !== generation.current) return;
      lastBoot.current = null;
      lastOutcome.current = null;
      setRebooted(false);
      setDraft({});
      accept(next);
      setConnected(true);
      setPanel("main");
      setPassword("");
      if (save) {
        try {
          setSaved(await bridge.remember());
          setSettingsMessage(() => (m: Messages) => m.connect.savedNote);
        } catch (e) {
          setSettingsMessage(() => (m: Messages) => m.connect.saveFailed(m.fault(failure(e))));
        }
      }
    } catch (e) {
      if (token === generation.current) setFault(failure(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function useSaved() {
    if (!saved) return;
    setHost(saved.host);
    setPort(saved.port);
    setUsername(saved.username);
    await establish(bridge.connectSaved, false);
  }
  async function forget() {
    setBusy(true);
    try {
      await bridge.forget();
      setSaved(null);
      setRemember(false);
      setStoreError(false);
      setSettingsMessage(() => (m: Messages) => m.connect.forgotten);
    } catch (e) {
      setSettingsMessage(() => (m: Messages) => m.fault(failure(e)));
      setStoreError(true);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    ++generation.current;
    autoConnect.current = false;
    setConnected(false);
    setOnline(false);
    setSnapshot(null);
    setResult(null);
    setFault(null);
    setNetworkFault(null);
    setDraft({});
    setPanel("main");
    setRebooted(false);
    setAction(null);
    lastBoot.current = null;
    setBusy(true);
    try {
      await bridge.disconnect();
    } finally {
      setBusy(false);
    }
  }
  /**
   * One explicit command (power or a setting). If a live lighting command is
   * still in flight the press waits for it (live sending pauses meanwhile) and
   * is dropped if that command's outcome is unknown. A press while another
   * explicit command is in flight is ignored.
   */
  async function explicit(
    kind: "power" | "setting",
    label: Text,
    send: (device: string) => Promise<CommandRecord>,
  ) {
    const device = snapshotRef.current?.device_id;
    if (!device || explicitRequested.current) return false;
    explicitRequested.current = true;
    try {
      while (commanding.current && inflight.current) await inflight.current;
      if (lastOutcome.current === "unknown" || lockRef.current || snapshotRef.current?.device_id !== device)
        return false;
      const outcome = await command(kind, label, () => send(device));
      return outcome === "transmitted";
    } finally {
      explicitRequested.current = false;
    }
  }
  const power = (value: boolean) =>
    explicit("power", (m) => m.action.power(value), (device) => bridge.power(device, value));
  /** One explicit setting value, never a toggle of the shown one. */
  async function setting(key: SettingKey, value: boolean) {
    settingKey.current = key;
    try {
      return await explicit("setting", (m) => m.action.setting(value, m.lights.settings[key].title), (device) =>
        bridge.setState(device, { [key]: value }),
      );
    } finally {
      settingKey.current = null;
    }
  }
  /**
   * Stage user-changed lighting values and send them live. Returns false when
   * controls are locked. Only direct user input reaches this function.
   */
  function adjust(patch: Draft) {
    const current = snapshotRef.current;
    if (!current || lockRef.current) return false;
    const base = { ...current.desired.values, ...sentRef.current };
    // Brightness of a lamp the resulting mode leaves unlit is never sent.
    const shownMode = draftRef.current.mode ?? base.mode;
    const lit = litOnly(patch, shownMode);
    let next = litOnly(draftRef.current, lit.mode ?? shownMode);
    for (const key of LIGHT_KEYS)
      if (lit[key] !== undefined) next = stageDraft(next, base, key, lit[key] as never);
    setDraft(next);
    void pump();
    return true;
  }
  /**
   * Send the latest unsent values, one command at a time and at most every
   * LIVE_INTERVAL_MS. Intermediate values are dropped, never queued. Values
   * that were attempted are removed whatever the outcome, so nothing is
   * retried, replayed or sent to "correct" a later change from elsewhere.
   */
  async function pump() {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const current = snapshotRef.current;
        if (!current || lockRef.current) {
          setDraft({});
          return;
        }
        if (commanding.current || explicitRequested.current) return;
        const base = { ...current.desired.values, ...sentRef.current };
        const pending = pendingDraft(draftRef.current, base);
        const keys = Object.keys(pending) as LightKey[];
        if (!keys.length) {
          if (Object.keys(draftRef.current).length) setDraft({});
          return;
        }
        const wait = lastSend.current + LIVE_INTERVAL_MS - Date.now();
        if (wait > 0) {
          await sleep(wait);
          continue;
        }
        lastSend.current = Date.now();
        const outcome = await command("light", (m) => m.action.adjust, async () => {
          const record = await bridge.setState(current.device_id, pending);
          // Mark before command() starts its follow-up read, so that read
          // replaces the assumption instead of racing it.
          if (record.status === "transmitted") setSent({ ...sentRef.current, ...pending });
          return record;
        });
        const remaining = { ...draftRef.current };
        for (const key of keys) if (remaining[key] === pending[key]) delete remaining[key];
        setDraft(remaining);
        if (outcome === "unknown" || outcome === "skipped") {
          setDraft({});
          return;
        }
      }
    } finally {
      pumping.current = false;
    }
  }
  function command(
    kind: Kind,
    label: Text,
    send: () => Promise<CommandRecord>,
  ): Promise<Outcome> {
    if (!snapshotRef.current || commanding.current) return Promise.resolve("skipped");
    const run = transmit(kind, label, send).then((outcome) => {
      lastOutcome.current = outcome;
      return outcome;
    });
    inflight.current = run;
    return run;
  }
  async function transmit(
    kind: Kind,
    label: Text,
    send: () => Promise<CommandRecord>,
  ): Promise<Outcome> {
    const token = generation.current;
    commanding.current = true;
    // Explicit commands lock every control; live lighting keeps the sliders
    // usable and coalesces further input until this command finishes.
    if (kind !== "light") setBusy(true);
    setSending(kind);
    setSentKind(kind);
    setAction(() => label);
    setFault(null);
    setResult(null);
    try {
      // Finish an already-started read before acquiring the native session for
      // this explicit command. Never retry a POST or poll during transmission.
      if (refreshing.current && !(await refreshing.current)) return "skipped";
      if (token !== generation.current) return "skipped";
      const next = await send();
      if (token !== generation.current) return "skipped";
      setResult(next);
      return next.status === "transmitted" ? "transmitted" : "not_transmitted";
    } catch (e) {
      if (token !== generation.current) return "skipped";
      setFault(failure(e));
      return failure(e).code === "UNKNOWN_OUTCOME" ? "unknown" : "not_transmitted";
    } finally {
      commanding.current = false;
      setSending(null);
      if (token === generation.current) {
        if (kind !== "light") setBusy(false);
        void refresh();
      }
    }
  }
  async function lookup() {
    const token = generation.current;
    setBusy(true);
    try {
      const next = await bridge.lookup();
      if (token === generation.current && next) {
        setResult(next);
        setFault(null);
        lastOutcome.current = null;
      }
    } catch (e) {
      if (token === generation.current) setFault(failure(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  const lock = lockReason({ online, snapshot, busy, fault });
  snapshotRef.current = snapshot;
  lockRef.current = lock;
  useEffect(() => {
    // Any lock drops unsent values so they are never sent later.
    if (lock) {
      setDraft({});
      setSent({});
    }
  }, [lock, setDraft, setSent]);
  const desiredValues = snapshot?.desired.values ?? null;
  const shown = desiredValues ? { ...desiredValues, ...sent, ...draft } : null;
  const adjusting = desiredValues
    ? LIGHT_KEYS.filter((key) => shown![key] !== desiredValues[key])
    : [];
  const actionText = action ? action(m) : "";
  const feedback = commandFeedback(m, { online, commanding: sending !== null, action: actionText, result, fault });
  useEffect(() => {
    if (result?.status !== "transmitted" || sentKind !== "power") return;
    setFlash(result.command_id);
    const timer = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(timer);
  }, [result, sentKind]);
  // Status shown beside the power button instead of a separate card or banner.
  // Live lighting only reports problems; the sliders already show the values.
  let powerStatus: Feedback | null = null;
  if (sending === "power") powerStatus = feedback;
  else if (!sending && (feedback.tone === "err" || feedback.tone === "warn")) powerStatus = feedback;
  else if (!sending && feedback.tone === "ok" && result && flash === result.command_id)
    powerStatus = feedback;
  useFlyoutHost(
    native,
    {
      connected,
      online,
      lock,
      desired: desiredValues,
      values: shown,
      adjusting,
      sending: sending !== null,
      features: snapshot?.features ?? {},
      status: connected ? powerStatus : null,
      updated,
      theme,
      locale,
    },
    {
      lock,
      power,
      adjust,
      sync: () => {
        if (connected) void refresh();
        // A login-time connection can fail before the network is up; opening
        // the tray tries the saved connection again.
        else if (autoConnect.current && saved && !busy) void useSaved();
      },
    },
  );
  let banner: BannerSpec | null = null;
  if (connected) {
    const b = m.banner;
    if (lock === "offline")
      banner = {
        tone: "warn",
        title: b.offlineTitle,
        body: b.offlineBody(updated),
        action: { label: b.retry, run: () => void refresh() },
      };
    else if (lock === "radio")
      banner = {
        tone: "warn",
        title: b.radioTitle,
        body: b.radioBody,
      };
    else if (lock === "unknown")
      banner = {
        tone: "warn",
        title: b.unknownTitle,
        body: b.unknownBody(actionText || b.lastCommand),
        action: { label: b.lookup, run: () => void lookup(), disabled: busy },
      };
    else if (rebooted)
      banner = {
        tone: "info",
        title: b.rebootTitle,
        body: b.rebootBody,
        action: { label: b.dismiss, run: () => setRebooted(false) },
      };
  }
  const header = (
    <header className="app-header">
      {connected && panel === "settings" ? (
        <button type="button" className="header-pill back" onClick={() => setPanel("main")}>
          <span className="chevron" aria-hidden="true">‹</span>
          {m.header.back}
        </button>
      ) : (
        <span />
      )}
      <div className="app-title">
        {!connected ? m.appName : panel === "settings" ? m.header.settings : "ScreenBar Halo 2"}
      </div>
      {connected && panel === "main" ? (
        <button type="button" className="header-pill" onClick={() => setPanel("settings")}>
          {m.header.settings}
        </button>
      ) : (
        <span />
      )}
    </header>
  );
  let body: React.ReactNode;
  if (!connected) {
    body = (
      <ConnectPage
        native={native}
        platform={platform}
        busy={busy}
        fields={{ host, port, username, password }}
        edit={(patch) => {
          connectionEdited.current = true;
          if (patch.host !== undefined) setHost(patch.host);
          if (patch.port !== undefined) setPort(patch.port);
          if (patch.username !== undefined) setUsername(patch.username);
          if (patch.password !== undefined) setPassword(patch.password);
        }}
        remember={remember}
        setRemember={setRemember}
        saved={saved}
        fault={fault}
        settingsMessage={settingsMessage ? settingsMessage(m) : ""}
        retryForget={!saved && storeError}
        submit={(event) => void connect(event)}
        useSaved={() => void useSaved()}
        forget={() => void forget()}
        pick={(candidate) => {
          connectionEdited.current = true;
          setHost(candidate.host);
          setPort(candidate.port);
          setPassword("");
        }}
      />
    );
  } else if (panel === "settings") {
    body = (
      <SettingsPage
        compact={phone}
        native={native}
        platform={platform}
        snapshot={snapshot}
        address={`${host}:${port}`}
        online={online}
        updated={updated}
        busy={busy}
        saved={saved}
        settingsMessage={settingsMessage ? settingsMessage(m) : ""}
        raw={{
          device_id: snapshot?.device_id,
          boot_id: snapshot?.boot_id,
          radio: snapshot?.radio_status,
          radio_error: snapshot?.radio_error_code,
          last_command: result ?? snapshot?.last_command,
          error: fault ?? networkFault,
        }}
        theme={themePref}
        setTheme={(next) => {
          setThemePref(next);
          saveTheme(next);
        }}
        locale={localePref}
        setLocale={(next) => {
          setLocalePref(next);
          saveLocale(next);
        }}
        refresh={() => void refresh()}
        disconnect={() => void disconnect()}
        forget={() => void forget()}
      />
    );
  } else if (snapshot) {
    const preview = (
      <LampPreview
        key="preview"
        power={snapshot.desired.values.power}
        preview={shown!}
        online={online}
        lock={lock}
        powerPending={sending === "power"}
        status={powerStatus}
        onPower={(value) => void power(value)}
      />
    );
    const lights = (
      <LightControls
        key="lights"
        snapshot={snapshot}
        values={shown!}
        lock={lock}
        adjust={adjust}
        settingPending={sending === "setting" ? settingKey.current : null}
        progressShown={sending === "power" || sending === "setting"}
        onSetting={(key, value) => void setting(key, value)}
      />
    );
    const presets = (
      <PresetsPanel key="presets" values={shown!} disabled={lock !== null} select={(values) => adjust({ ...values })} />
    );
    body = single ? (
      // Phone order: preview → lights → presets.
      <div className="main-grid single">{[preview, lights, presets]}</div>
    ) : (
      <div className="main-grid">
        <div className="column left">{[preview, presets]}</div>
        <div className="column right">{lights}</div>
      </div>
    );
  }
  return (
    <I18nContext.Provider value={m}>
      <div className={`app${phone ? " compact" : ""}`}>
        {header}
        <main className="content">
          {banner && <Banner banner={banner} />}
          {body}
          <footer className="app-footer">
            <ConnectionStatus connected={connected} online={online} updated={updated} />
            <span>{m.version("0.1.0")}</span>
          </footer>
        </main>
      </div>
    </I18nContext.Provider>
  );
}
