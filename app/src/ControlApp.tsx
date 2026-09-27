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
import { DevicePage } from "./DevicePage";
import { useTray } from "./useTray";
import { ConnectPage } from "./ConnectPage";
import { detectPlatform } from "./platform";
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
  const [storeError, setStoreError] = useState(false);
  const generation = useRef(0);
  const refreshing = useRef<Promise<Snapshot | null> | null>(null);
  const commanding = useRef(false);
  const connectionEdited = useRef(false);
  const lastBoot = useRef<string | null>(null);
  const ownCommands = useRef(new Set<string>());
  const native = isTauri();
  const compact = useCompact();
  const platform = detectPlatform();
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
        if (!cancelled) {
          setSettingsMessage(failure(e).message);
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
      setStoreError(false);
      setSettingsMessage("已移除保存的連線與帳密。");
    } catch (e) {
      setSettingsMessage(failure(e).message);
      setStoreError(true);
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
        settingsMessage={settingsMessage}
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
  } else if (panel === "device") {
    body = (
      <DevicePage
        snapshot={snapshot}
        address={`${host}:${port}`}
        updated={updated}
        busy={busy}
        saved={saved}
        settingsMessage={settingsMessage}
        native={native}
        raw={{
          device_id: snapshot?.device_id,
          boot_id: snapshot?.boot_id,
          radio: snapshot?.radio_status,
          radio_error: snapshot?.radio_error_code,
          last_command: result ?? snapshot?.last_command,
          error: fault ?? networkFault,
        }}
        refresh={() => void refresh()}
        disconnect={() => void disconnect()}
        forget={() => void forget()}
      />
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
