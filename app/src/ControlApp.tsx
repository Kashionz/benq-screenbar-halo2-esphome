import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  bridge,
  failure,
  resultLabel,
  type Snapshot,
  type CommandRecord,
  type Fault,
} from "./bridge";
import "./halo.css";

export default function App() {
  const [host, setHost] = useState("screenbar-halo2.local");
  const [port, setPort] = useState(8080);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<Fault | null>(null);
  const [networkFault, setNetworkFault] = useState<Fault | null>(null);
  const [result, setResult] = useState<CommandRecord | null>(null);
  const [updated, setUpdated] = useState("");
  const generation = useRef(0);
  const refreshing = useRef(false);
  const native = isTauri();
  const accept = useCallback((next: Snapshot) => {
    setSnapshot((current) =>
      current &&
      current.boot_id === next.boot_id &&
      current.state_version > next.state_version
        ? current
        : next,
    );
    setOnline(true);
    setNetworkFault(null);
    setUpdated(new Date().toLocaleTimeString("zh-TW"));
  }, []);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    const token = generation.current;
    refreshing.current = true;
    try {
      const next = await bridge.state();
      if (token === generation.current) accept(next);
    } catch (e) {
      if (token === generation.current && failure(e).code !== "BUSY") {
        setOnline(false);
        setNetworkFault(failure(e));
      }
    } finally {
      refreshing.current = false;
    }
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
    const token = ++generation.current;
    setBusy(true);
    setFault(null);
    setNetworkFault(null);
    setResult(null);
    try {
      const next = await bridge.connect(host.trim(), port, username, password);
      if (token !== generation.current) return;
      accept(next);
      setConnected(true);
      setPassword("");
    } catch (e) {
      if (token === generation.current) setFault(failure(e));
    } finally {
      if (token === generation.current) setBusy(false);
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
    setBusy(true);
    try {
      await bridge.disconnect();
    } finally {
      setBusy(false);
    }
  }
  async function power(value: boolean) {
    if (!snapshot) return;
    const token = generation.current;
    setBusy(true);
    setFault(null);
    setResult(null);
    try {
      const next = await bridge.power(snapshot.device_id, value);
      if (token === generation.current) setResult(next);
    } catch (e) {
      if (token === generation.current) setFault(failure(e));
    } finally {
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
        setResult(next);
        setFault(null);
      }
    } catch (e) {
      if (token === generation.current) setFault(failure(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  const ready =
    online &&
    snapshot?.radio_status === "ready" &&
    snapshot?.pairing_status === "ready" &&
    snapshot?.features.power === "verified" &&
    !snapshot?.active_command &&
    fault?.code !== "UNKNOWN_OUTCOME";
  const desired = snapshot?.desired.values;
  const mode =
    ({ front: "前燈", back: "後燈", both: "前後燈" } as Record<string, string>)[
      desired?.mode ?? ""
    ] ?? "—";
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-mark">H</span> HALO{" "}
          <span className="brand-light">CONTROL</span>
        </a>
        <span className={`connection ${online ? "live" : ""}`}>
          <i />
          {online ? "橋接器已連線" : connected ? "連線中斷" : "尚未連線"}
        </span>
      </header>
      <section className="intro">
        <p className="eyebrow">YOUR DESK, YOUR LIGHT</p>
        <h1>讓光，剛剛好。</h1>
        <p>在同一個區域網路，控制你的 ScreenBar Halo 2。</p>
      </section>
      <div className="layout">
        <aside className="panel connect-panel">
          <div className="section-heading">
            <span className="step">01</span>
            <h2>橋接器</h2>
          </div>
          {!native && (
            <p role="alert" className="notice">
              請在 Tauri 桌面或手機 App 中開啟；瀏覽器預覽不會連接燈具。
            </p>
          )}
          {!connected ? (
            <form onSubmit={connect}>
              <label>
                IP 或主機名稱
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
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
                  onChange={(e) => setPort(Number(e.target.value))}
                  required
                />
              </label>
              <label>
                帳號
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                密碼
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
              <p className="hint">
                使用橋接器網頁的帳號密碼。密碼只保留於本次 App 執行期間。
              </p>
            </form>
          ) : (
            <div className="device-details">
              <span className="device-icon">↗</span>
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
            </div>
          )}
        </aside>
        <section className="panel control-panel">
          <div className="section-heading">
            <span className="step">02</span>
            <h2>燈光控制</h2>
            <span className="tag">HALO 2</span>
          </div>
          <div
            className={`lamp-scene ${desired?.power ? "lit" : ""}`}
            aria-hidden="true"
          >
            <div className="lamp-glow" />
            <div className="lamp-bar" />
            <div className="monitor" />
            <div className="monitor-foot" />
            <div className="desk-line" />
          </div>
          <div className="target">
            <p className="eyebrow">目前控制目標</p>
            <h3>
              {!snapshot ? "等待連線" : desired?.power ? "開啟" : "關閉"}
              <span>{snapshot ? mode : "準備好你的橋接器"}</span>
            </h3>
          </div>
          <div className="power-actions">
            <button
              className="primary"
              disabled={!ready || busy}
              onClick={() => void power(true)}
            >
              <span>⏻</span> 開燈
            </button>
            <button
              className="secondary"
              disabled={!ready || busy}
              onClick={() => void power(false)}
            >
              關燈
            </button>
          </div>
          <p className="hint center">
            目標狀態與示意圖不代表燈具已確認。請以實際燈光為準。
          </p>
          <div className="feedback" aria-live="polite">
            {busy && connected ? (
              <p>正在處理命令…</p>
            ) : result ? (
              <>
                <strong>{resultLabel(result)}</strong>
                <p>
                  {result.status === "transmitted"
                    ? "橋接器已完成發送；燈具未提供獨立狀態確認。"
                    : (result.error?.code ?? "請重新整理狀態。")}
                </p>
              </>
            ) : (
              <p>
                {connected
                  ? "選擇開燈或關燈，設定明確的電源狀態。"
                  : "連線後即可控制電源。"}
              </p>
            )}
          </div>
          {snapshot?.observed_remote && (
            <div className="remote">
              <span>原廠控制器最近操作</span>
              <strong>
                {snapshot.observed_remote.values.power ? "開燈" : "關燈"}
              </strong>
              <small>
                約{" "}
                {Math.max(
                  0,
                  Math.round(
                    (snapshot.uptime_ms -
                      snapshot.observed_remote.received_at_uptime_ms) /
                      1000,
                  ),
                )}{" "}
                秒前
              </small>
            </div>
          )}
        </section>
      </div>
      {(fault || networkFault) && (
        <section role="alert" className="error-panel">
          <strong>{(fault || networkFault)?.message}</strong>
          <code>{(fault || networkFault)?.code}</code>
          {fault?.code === "UNKNOWN_OUTCOME" && (
            <>
              <p>請先查詢原命令結果。重新連線也不會重播這筆命令。</p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void lookup()}
              >
                查詢命令結果
              </button>
            </>
          )}
        </section>
      )}
      {connected && (
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
                error: fault,
              },
              null,
              2,
            )}
          </pre>
        </details>
      )}
      <footer>
        <span>LOCAL CONNECTION · NO CLOUD</span>
        <span>非 BenQ 官方軟體 · 開發版 0.1.0</span>
      </footer>
    </main>
  );
}
