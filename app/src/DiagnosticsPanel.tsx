import { useState } from "react";
import { bridge, failure, type DiagnosticReport } from "./bridge";

export function DiagnosticsPanel() {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(kind: "read" | "export" | "clear") {
    setBusy(true);
    setMessage("");
    try {
      if (kind === "clear") await bridge.clearDiagnostics();
      if (kind === "export")
        setMessage(`已匯出：${await bridge.exportDiagnostics()}`);
      setReport(await bridge.diagnostics());
    } catch (e) {
      setMessage(failure(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="diagnostics">
      <summary>歷史診斷紀錄</summary>
      <p className="hint">
        保留最近 200 筆事件；不含帳號、密碼與
        IP。裝置識別碼與操作時間會包含在匯出檔案中。
      </p>
      <div className="diagnostic-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void action("read")}
        >
          讀取紀錄
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void action("export")}
        >
          匯出診斷 JSON
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void action("clear")}
        >
          清除歷史紀錄
        </button>
      </div>
      {message && (
        <p role="status" className="export-path">
          {message}
        </p>
      )}
      {report?.warning && <p role="alert">{report.warning.message}</p>}
      {report && <p>已保存 {report.events.length} 筆事件</p>}
      <ol className="diagnostic-events">
        {report?.events
          .slice()
          .reverse()
          .map((event, index) => (
            <li key={`${event.unix_ms}/${index}`}>
              <time>{new Date(event.unix_ms).toLocaleString("zh-TW")}</time>
              {" · "}
              {event.kind}
              {" · "}
              {event.status}
              {event.error_code && (
                <strong>
                  {" · "}
                  {event.error_code}
                </strong>
              )}
              {event.tx && (
                <span>
                  {" · TX "}
                  {event.tx.frames_transmitted}/{event.tx.frames_planned}
                  {" · IRQ "}
                  {event.tx.irq?.toString(16).toUpperCase() ?? "—"}
                  {" · FIFO "}
                  {event.tx.fifo?.toString(16).toUpperCase() ?? "—"}
                </span>
              )}
            </li>
          ))}
      </ol>
    </details>
  );
}
