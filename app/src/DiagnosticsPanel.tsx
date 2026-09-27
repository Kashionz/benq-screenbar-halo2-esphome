import { useEffect, useRef, useState } from "react";
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

export function DiagnosticsPanel({ raw, reloadKey }: { raw: unknown; reloadKey: string }) {
  const iphone = /iPhone|iPod/.test(navigator.userAgent);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
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
  // Reading the local history never contacts the bridge.
  useEffect(() => {
    bridge
      .diagnostics()
      .then((next) => {
        if (mounted.current && next) setReport(next);
      })
      .catch((e) => {
        if (mounted.current) setMessage(failure(e).message);
      });
  }, [reloadKey]);
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
      const next = await bridge.diagnostics();
      if (mounted.current) setReport(next);
    } catch (e) {
      if (mounted.current) setMessage(failure(e).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const events = (report?.events ?? []).slice().reverse();
  const rows = events.map((event) => ({ event, ...describeEvent(event) }));
  const count = (tone: Tone) => rows.filter((row) => row.tone === tone).length;
  const summary = events.length
    ? `最近 ${events.length} 筆：${count("ok")} 成功 · ${count("warn")} 結果不明 · ${count("err")} 失敗`
    : "沒有紀錄";
  return (
    <section aria-label="診斷">
      <div className="group-label">診斷 · {summary}</div>
      <div className="group">
        {rows.length > 0 && (
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
        )}
        {showRaw && <pre className="raw-json">{JSON.stringify(raw, null, 2)}</pre>}
        <button type="button" className="list-button" aria-expanded={showRaw}
          onClick={() => setShowRaw((value) => !value)}>
          {showRaw ? "隱藏原始資料" : "顯示原始資料"}
        </button>
        <button type="button" className="list-button" disabled={busy} onClick={() => void action("export")}>
          匯出診斷 JSON
        </button>
        <button type="button" className="list-button danger" disabled={busy} onClick={() => void action("clear")}>
          清除歷史紀錄
        </button>
      </div>
      <p className="group-note">保留最近 200 筆</p>
      {report?.warning && (
        <p role="alert" className="group-note warn">
          {report.warning.message}
        </p>
      )}
      {message && (
        <div role="status" className="group-note strong">
          {message}
          {iphone && message.startsWith("已匯出：") && (
            <div className="muted-2">到「檔案」→「我的 iPhone」→「Halo 2 Control」→「Halo2Control」取用。</div>
          )}
        </div>
      )}
    </section>
  );
}
