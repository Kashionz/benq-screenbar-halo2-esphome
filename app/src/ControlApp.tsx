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
import { LightControls } from "./LightControls";
import { LampPreview } from "./LampPreview";
import { Banner, RecentCommand, TargetList, type BannerSpec } from "./StatusCards";
import {
  commandFeedback,
  lockReason,
  pendingDraft,
  previewValues,
  sourceLabel,
  type Draft,
  type LightPatch,
  type Tone,
} from "./controlState";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { useTray } from "./useTray";
import { DiscoveryPanel } from "./DiscoveryPanel";
import { useCompact } from "./useCompact";

export default function App() {
  const [host, setHost] = useState("screenbar-halo2.local");
  const [port, setPort] = useState(8080);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState<SavedConnection | null>(null);
  const [remember, setRemember] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<Fault | null>(null);
  const [networkFault, setNetworkFault] = useState<Fault | null>(null);
  const [result, setResult] = useState<CommandRecord | null>(null);
  const [updated, setUpdated] = useState("");
  const [draft, setDraft] = useState<Draft>({});
  const [panel, setPanel] = useState<"main" | "device">("main");
  const [sending, setSending] = useState(false);
  const [action, setAction] = useState("");
  const [rebooted, setRebooted] = useState(false);
  const generation = useRef(0);
  const refreshing = useRef<Promise<Snapshot | null> | null>(null);
  const commanding = useRef(false);
  const connectionEdited = useRef(false);
  const lastBoot = useRef<string | null>(null);
  const ownCommands = useRef(new Set<string>());
  const native = isTauri();
  const compact = useCompact();
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    bridge
      .saved()
      .then((profile) => {
        if (cancelled) return;
        setSaved(profile);
        if (profile && !connectionEdited.current) {
          setHost(profile.host);
          setPort(profile.port);
          setUsername(profile.username);
        }
      })
      .catch((e) => {
        if (!cancelled) setSettingsMessage(failure(e).message);
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
  }, []);
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
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [connected, refresh]);
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
      setRebooted(false);
      setDraft({});
      accept(next);
      setConnected(true);
      setPanel("main");
      setPassword("");
      if (save) {
        try {
          setSaved(await bridge.remember());
          setSettingsMessage("連線已保存，密碼存放於系統憑證庫。");
        } catch (e) {
          setSettingsMessage(`本次已連線，但保存失敗：${failure(e).message}`);
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
      setSettingsMessage("已移除保存的連線與帳密。");
    } catch (e) {
      setSettingsMessage(failure(e).message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    ++generation.current;
    setConnected(false);
    setOnline(false);
    setSnapshot(null);
    setResult(null);
    setFault(null);
    setNetworkFault(null);
    setDraft({});
    setPanel("main");
    setRebooted(false);
    setAction("");
    lastBoot.current = null;
    setBusy(true);
    try {
      await bridge.disconnect();
    } finally {
      setBusy(false);
    }
  }
  async function power(value: boolean) {
    await command(value ? "開燈" : "關燈", () =>
      bridge.power(snapshot!.device_id, value),
    );
  }
  async function light(patch: LightPatch) {
    if (
      await command("套用燈光設定", () =>
        bridge.setState(snapshot!.device_id, patch),
      )
    )
      setDraft({});
  }
  async function command(label: string, send: () => Promise<CommandRecord>) {
    if (!snapshot || commanding.current) return false;
    const token = generation.current;
    commanding.current = true;
    setBusy(true);
    setSending(true);
    setAction(label);
    setFault(null);
    setResult(null);
    try {
      // Finish an already-started read before acquiring the native session for
      // this explicit command. Never retry a POST or poll during transmission.
      if (refreshing.current && !(await refreshing.current)) return false;
      if (token !== generation.current) return false;
      const next = await send();
      if (token === generation.current) {
        ownCommands.current.add(next.command_id);
        setResult(next);
      }
      return token === generation.current && next.status === "transmitted";
    } catch (e) {
      if (token === generation.current) setFault(failure(e));
      return false;
    } finally {
      commanding.current = false;
      setSending(false);
      if (token === generation.current) {
        setBusy(false);
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
        ownCommands.current.add(next.command_id);
        setResult(next);
        setFault(null);
      }
    } catch (e) {
      if (token === generation.current) setFault(failure(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  const lock = lockReason({ online, snapshot, busy, fault });
  useTray(native, lock === null, power);
  const badge: { tone: Tone; text: string } = !connected
    ? busy
      ? { tone: "pending", text: "連線中" }
      : { tone: "idle", text: "未連線" }
    : online
      ? { tone: "ok", text: "已連線" }
      : { tone: "warn", text: "已斷線 · 重試中" };
  let banner: BannerSpec | null = null;
  if (connected) {
    if (lock === "已斷線")
      banner = {
        tone: "warn",
        title: "已斷線，重試中",
        body: `最後同步 ${updated}。不會重送先前的操作。`,
        action: { label: "立即重試", run: () => void refresh() },
      };
    else if (lock === "結果不明，請先查詢")
      banner = {
        tone: "warn",
        title: "上一筆結果不明",
        body: `請先查詢「${action || "上一筆命令"}」的結果。`,
        action: { label: "查詢命令結果", run: () => void lookup(), disabled: busy },
      };
    else if (lock === "處理中") banner = { tone: "info", title: "處理中", body: "" };
    else if (rebooted)
      banner = {
        tone: "info",
        title: "橋接器已重新開機",
        body: "已重新同步，先前的命令結果無法查詢。",
        action: { label: "知道了", run: () => setRebooted(false) },
      };
  }
  const header = (
    <header className="app-header">
      {connected && panel === "device" && (
        <button type="button" className="back" onClick={() => setPanel("main")}>
          ‹ 燈光
        </button>
      )}
      <div className="app-title">{connected && panel === "device" ? "裝置與診斷" : "Halo 2 Control"}</div>
      <span className={`badge tone-${badge.tone}`}>
        <span className="dot" />
        {badge.text}
      </span>
      <div className="spacer" />
      {connected && panel === "main" && (
        <button type="button" className="header-pill" onClick={() => setPanel("device")}>
          裝置與診斷 ›
        </button>
      )}
    </header>
  );
  let body: React.ReactNode;
  if (!connected) {
    body = (
      <div className="setup">
        {!native && (
          <p role="alert" className="notice">
            請在 Tauri 桌面或手機 App 中開啟；瀏覽器預覽不會連接燈具。
          </p>
        )}
        <form onSubmit={connect} className="legacy-form">
          <DiscoveryPanel disabled={busy || !native} select={(candidate) => {
            connectionEdited.current = true;
            setHost(candidate.host);
            setPort(candidate.port);
            setPassword("");
          }} />
          {saved && (
            <div className="saved-connection">
              <p>
                已保存：{saved.host}:{saved.port}
              </p>
              <button
                type="button"
                className="secondary"
                disabled={busy || !native}
                onClick={() => void useSaved()}
              >
                使用已保存帳密連線
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void forget()}
              >
                忘記已保存連線
              </button>
            </div>
          )}
          {!saved && settingsMessage && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void forget()}
            >
              重試移除保存資料
            </button>
          )}
          <label>
            IP 或主機名稱
            <input
              value={host}
              disabled={busy}
              onChange={(e) => {
                connectionEdited.current = true;
                setHost(e.target.value);
              }}
              placeholder="192.168.1.10"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label>
            連接埠
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              disabled={busy}
              onChange={(e) => {
                connectionEdited.current = true;
                setPort(Number(e.target.value));
              }}
              required
            />
          </label>
          <label>
            帳號
            <input
              value={username}
              disabled={busy}
              onChange={(e) => {
                connectionEdited.current = true;
                setUsername(e.target.value);
              }}
              autoComplete="username"
              required
            />
          </label>
          <label>
            密碼
            <input
              type="password"
              value={password}
              disabled={busy}
              onChange={(e) => {
                connectionEdited.current = true;
                setPassword(e.target.value);
              }}
              autoComplete="current-password"
              required
            />
          </label>
          <button
            className="primary connect-button"
            disabled={busy || !native}
          >
            {busy ? "正在連線…" : "連線橋接器 →"}
          </button>
          <label className="remember-toggle">
            <input
              type="checkbox"
              checked={remember}
              disabled={busy}
              onChange={(e) => setRemember(e.target.checked)}
            />
            記住此連線與帳密
          </label>
          <p className="hint">
            使用橋接器網頁的帳號密碼。勾選記住時存入系統憑證庫；否則只留於本次連線。
          </p>
        </form>
        {fault && (
          <p role="alert" className="form-error">
            {fault.message}
          </p>
        )}
        {settingsMessage && (
          <p role="status" className="hint">
            {settingsMessage}
          </p>
        )}
      </div>
    );
  } else if (panel === "device") {
    body = (
      <div className="device-page">
        <div className="device-details">
          <h3>ScreenBar Halo 2</h3>
          <p className="host">
            {host}:{port}
          </p>
          <dl>
            <dt>無線模組</dt>
            <dd>
              {snapshot?.radio_status === "ready"
                ? "就緒"
                : snapshot?.radio_status}
            </dd>
            <dt>配對保存</dt>
            <dd>{snapshot?.pairing_persisted ? "已保存" : "未保存"}</dd>
            <dt>最後同步</dt>
            <dd>{updated || "—"}</dd>
          </dl>
          <button
            className="secondary"
            onClick={() => void refresh()}
            disabled={busy}
          >
            重新整理
          </button>
          <button
            className="text-button"
            onClick={() => void disconnect()}
            disabled={busy}
          >
            中斷連線／更換裝置
          </button>
          {saved && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void forget()}
            >
              忘記已保存連線
            </button>
          )}
        </div>
        {settingsMessage && (
          <p role="status" className="hint">
            {settingsMessage}
          </p>
        )}
        <details className="diagnostics">
          <summary>連線與命令診斷</summary>
          <pre>
            {JSON.stringify(
              {
                device_id: snapshot?.device_id,
                boot_id: snapshot?.boot_id,
                radio: snapshot?.radio_status,
                radio_error: snapshot?.radio_error_code,
                last_command: result ?? snapshot?.last_command,
                error: fault ?? networkFault,
              },
              null,
              2,
            )}
          </pre>
        </details>
        {native && <DiagnosticsPanel />}
      </div>
    );
  } else if (snapshot) {
    const desired = snapshot.desired.values;
    const preview = (
      <LampPreview
        key="preview"
        power={desired.power}
        preview={previewValues(desired, draft)}
        drafted={Object.keys(pendingDraft(draft, desired)).length > 0}
        online={online}
      />
    );
    const lights = (
      <LightControls
        key="lights"
        snapshot={snapshot}
        draft={draft}
        setDraft={setDraft}
        lock={lock}
        power={(value) => void power(value)}
        apply={(patch) => void light(patch)}
      />
    );
    const target = (
      <TargetList
        key="target"
        snapshot={snapshot}
        online={online}
        updated={updated}
        source={sourceLabel(snapshot.desired, ownCommands.current)}
      />
    );
    const recent = (
      <RecentCommand
        key="recent"
        feedback={commandFeedback({ online, commanding: sending, action, result, fault })}
        snapshot={snapshot}
        lookup={() => void lookup()}
        lookupDisabled={busy}
      />
    );
    body = compact ? (
      // Phone order: preview → lights → target → recent command.
      <div className="main-grid compact">{[preview, lights, target, recent]}</div>
    ) : (
      <div className="main-grid">
        <div className="column left">{[preview, target, recent]}</div>
        <div className="column right">{lights}</div>
      </div>
    );
  }
  return (
    <div className="app">
      {header}
      <main className="content">
        {banner && <Banner banner={banner} />}
        {body}
        <footer className="app-footer">
          <span>LOCAL CONNECTION · NO CLOUD</span>
          <span>非 BenQ 官方軟體 · 開發版 0.1.0</span>
        </footer>
      </main>
    </div>
  );
}
