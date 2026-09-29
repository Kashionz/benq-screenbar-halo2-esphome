import { useCallback, useEffect, useRef, useState } from "react";
import { bridge, failure, type DiagnosticReport } from "./bridge";
import type { Tone } from "./controlState";

type DiagnosticEvent = DiagnosticReport["events"][number];

const CONNECTION = new Set([
  "NETWORK",
  "NOT_CONNECTED",
  "UNAUTHORIZED",
  "PROTOCOL_ERROR",
  "DEVICE_CHANGED",
  "BOOT_CHANGED",
]);
const STORAGE = new Set(["CREDENTIAL_STORE", "STORAGE_ERROR"]);

/** Plain-language row for one stored event; codes stay in the raw line. */
export function describeEvent(event: DiagnosticEvent): { title: string; status: string; tone: Tone } {
  if (event.kind === "command") {
    switch (event.status) {
      case "transmitted":
        return { title: "命令", status: "已送出", tone: "ok" };
      case "failed":
        return { title: "命令", status: "發送失敗", tone: "err" };
      case "expired":
        return { title: "命令", status: "已過期", tone: "idle" };
      case "superseded":
        return { title: "命令", status: "已被取代", tone: "idle" };
      case "accepted":
      case "executing":
        return { title: "命令", status: "處理中", tone: "idle" };
      default:
        return { title: "命令", status: "結果不明", tone: "warn" };
    }
  }
  if (event.kind === "state") {
    switch (event.status) {
      case "ready":
        return { title: "狀態同步", status: "就緒", tone: "ok" };
      case "learning":
        return { title: "狀態同步", status: "學習位址中", tone: "idle" };
      case "fault":
      case "unavailable":
        return { title: "狀態同步", status: "無線模組未就緒", tone: "err" };
      default:
        return { title: "狀態同步", status: "狀態不明", tone: "idle" };
    }
  }
  const code = event.error_code ?? "";
  if (code === "UNKNOWN_OUTCOME") return { title: "命令", status: "結果不明", tone: "warn" };
  if (CONNECTION.has(code)) return { title: "連線", status: "失敗", tone: "err" };
  if (STORAGE.has(code)) return { title: "儲存", status: "失敗", tone: "err" };
  return { title: "命令", status: "失敗", tone: "err" };
}

const hex = (value: number | null) => value?.toString(16).toUpperCase() ?? "—";
export function rawLine(event: DiagnosticEvent) {
  const parts: string[] = [];
  if (event.error_code) parts.push(event.error_code);
  if (event.tx)
    parts.push(
      `TX ${event.tx.frames_transmitted}/${event.tx.frames_planned} · IRQ ${hex(event.tx.irq)} · FIFO ${hex(event.tx.fifo)}`,
    );
  return parts.join(" · ");
}

function time(unixMs: number) {
  const date = new Date(unixMs);
  const clock = date.toLocaleTimeString("zh-TW", { hour12: false });
  return date.toDateString() === new Date().toDateString()
    ? clock
    : `${date.getMonth() + 1}/${date.getDate()} ${clock}`;
}

/**
 * The local diagnostics history, read only while the panel is shown. Reading
 * it never contacts the bridge; it is reloaded whenever reloadKey (the last
 * sync time) changes.
 */
function useDiagnostics(reloadKey: string) {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    try {
      const next = await bridge.diagnostics();
      if (mounted.current && next) {
        setReport(next);
        setError("");
      }
    } catch (e) {
      if (mounted.current) setError(failure(e).message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reloadKey, reload]);
  return { report, error, reload };
}

export function DiagnosticsPanel({ raw, reloadKey }: { raw: unknown; reloadKey: string }) {
  const { report, error, reload } = useDiagnostics(reloadKey);
  const iphone = /iPhone|iPod/.test(navigator.userAgent);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function action(kind: "export" | "clear") {
    setBusy(true);
    setMessage("");
    try {
      if (kind === "clear") {
        await bridge.clearDiagnostics();
        if (mounted.current) setMessage("歷史紀錄已清除。");
      }
      if (kind === "export") {
        const path = await bridge.exportDiagnostics();
        if (mounted.current) setMessage(`已匯出：${path}`);
      }
      await reload();
    } catch (e) {
      if (mounted.current) setMessage(failure(e).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const rows = (report?.events ?? [])
    .slice()
    .reverse()
    .map((event) => ({ event, ...describeEvent(event) }));
  const count = (tone: Tone) => rows.filter((row) => row.tone === tone).length;
  const counts: Array<[Tone, string]> = [
    ["ok", "成功"],
    ["warn", "結果不明"],
    ["err", "失敗"],
  ];
  return (
    <div className="stack">
      <div className="counts">
        {counts.map(([tone, label]) => (
          <div key={tone} className={`glass count-card tone-${tone}`}>
            <div className="count-label">
              <span className="dot" />
              {label}
            </div>
            <div className="count-value">{count(tone)}</div>
          </div>
        ))}
      </div>
      <section aria-label="事件">
        <div className="diag-toolbar">
          <span>最近 {rows.length} 筆 · 保留最近 200 筆</span>
          <button
            type="button"
            role="switch"
            aria-checked={showRaw}
            className="raw-toggle"
            onClick={() => setShowRaw((value) => !value)}
          >
            原始資料
            <span className={`switch small${showRaw ? " on" : ""}`} aria-hidden="true">
              <span />
            </span>
          </button>
        </div>
        <div className="glass">
          {rows.length > 0 ? (
            <ol className="diagnostic-events">
              {rows.map(({ event, title, status, tone }, index) => {
                const line = showRaw ? rawLine(event) : "";
                return (
                  <li key={`${event.unix_ms}/${index}`} className={`event tone-${tone}`}>
                    <span className="dot" />
                    <span className="event-text">
                      {title}
                      <span className="event-status"> · {status}</span>
                      {line && <span className="event-raw">{line}</span>}
                    </span>
                    <time className="event-time">{time(event.unix_ms)}</time>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="event-empty">沒有紀錄</div>
          )}
          {showRaw && <pre className="raw-json">{JSON.stringify(raw, null, 2)}</pre>}
          <div className="diag-foot">
            <span>匯出檔不含帳號、IP 與密碼。</span>
            <button type="button" className="pill-button" disabled={busy} onClick={() => void action("export")}>
              匯出 JSON
            </button>
            <button type="button" className="pill-button danger" disabled={busy} onClick={() => void action("clear")}>
              清除紀錄
            </button>
          </div>
        </div>
        {(error || report?.warning) && (
          <p role="alert" className="group-note warn">
            {error || report?.warning?.message}
          </p>
        )}
        {message && (
          <div role="status" className="group-note">
            {message}
            {iphone && message.startsWith("已匯出：") && (
              <div>到「檔案」→「我的 iPhone」→「HaloDesk」→「HaloDesk」取用。</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
