import { useCallback, useEffect, useRef, useState } from "react";
import { bridge, failure, type DiagnosticReport, type Fault } from "./bridge";
import type { Tone } from "./controlState";
import { useMessages, type Messages } from "./i18n";

type DiagnosticEvent = DiagnosticReport["events"][number];
type Notice = { kind: "cleared" } | { kind: "exported"; path: string } | { kind: "error"; fault: Fault } | null;

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
export function describeEvent(m: Messages, event: DiagnosticEvent): { title: string; status: string; tone: Tone } {
  const d = m.diag;
  if (event.kind === "command") {
    switch (event.status) {
      case "transmitted":
        return { title: d.command, status: d.sent, tone: "ok" };
      case "failed":
        return { title: d.command, status: d.sendFailed, tone: "err" };
      case "expired":
        return { title: d.command, status: d.expired, tone: "idle" };
      case "superseded":
        return { title: d.command, status: d.superseded, tone: "idle" };
      case "accepted":
      case "executing":
        return { title: d.command, status: d.busy, tone: "idle" };
      default:
        return { title: d.command, status: d.unknown, tone: "warn" };
    }
  }
  if (event.kind === "state") {
    switch (event.status) {
      case "ready":
        return { title: d.sync, status: d.ready, tone: "ok" };
      case "learning":
        return { title: d.sync, status: d.learning, tone: "idle" };
      case "fault":
      case "unavailable":
        return { title: d.sync, status: d.radio, tone: "err" };
      default:
        return { title: d.sync, status: d.unknownState, tone: "idle" };
    }
  }
  const code = event.error_code ?? "";
  if (code === "UNKNOWN_OUTCOME") return { title: d.command, status: d.unknown, tone: "warn" };
  if (CONNECTION.has(code)) return { title: d.connection, status: d.failed, tone: "err" };
  if (STORAGE.has(code)) return { title: d.storage, status: d.failed, tone: "err" };
  return { title: d.command, status: d.failed, tone: "err" };
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
  const [error, setError] = useState<Fault | null>(null);
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
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(failure(e));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reloadKey, reload]);
  return { report, error, reload };
}

export function DiagnosticsPanel({ raw, reloadKey }: { raw: unknown; reloadKey: string }) {
  const m = useMessages();
  const d = m.diag;
  const { report, error, reload } = useDiagnostics(reloadKey);
  const iphone = /iPhone|iPod/.test(navigator.userAgent);
  const [message, setMessage] = useState<Notice>(null);
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
    setMessage(null);
    try {
      if (kind === "clear") {
        await bridge.clearDiagnostics();
        if (mounted.current) setMessage({ kind: "cleared" });
      }
      if (kind === "export") {
        const path = await bridge.exportDiagnostics();
        if (mounted.current) setMessage({ kind: "exported", path });
      }
      await reload();
    } catch (e) {
      if (mounted.current) setMessage({ kind: "error", fault: failure(e) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const rows = (report?.events ?? [])
    .slice()
    .reverse()
    .map((event) => ({ event, ...describeEvent(m, event) }));
  const count = (tone: Tone) => rows.filter((row) => row.tone === tone).length;
  const counts: Array<[Tone, string]> = [
    ["ok", d.ok],
    ["warn", d.unknown],
    ["err", d.failed],
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
      <section aria-label={d.events}>
        <div className="diag-toolbar">
          <span>{d.recent(rows.length)}</span>
          <button
            type="button"
            role="switch"
            aria-checked={showRaw}
            className="raw-toggle"
            onClick={() => setShowRaw((value) => !value)}
          >
            {d.raw}
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
            <div className="event-empty">{d.empty}</div>
          )}
          {showRaw && <pre className="raw-json">{JSON.stringify(raw, null, 2)}</pre>}
          <div className="diag-foot">
            <span>{d.privacy}</span>
            <button type="button" className="pill-button" disabled={busy} onClick={() => void action("export")}>
              {d.export}
            </button>
            <button type="button" className="pill-button danger" disabled={busy} onClick={() => void action("clear")}>
              {d.clear}
            </button>
          </div>
        </div>
        {(error || report?.warning) && (
          <p role="alert" className="group-note warn">
            {m.fault((error ?? report?.warning)!)}
          </p>
        )}
        {message && (
          <div role="status" className="group-note">
            {message.kind === "cleared"
              ? d.cleared
              : message.kind === "exported"
                ? d.exported(message.path)
                : m.fault(message.fault)}
            {iphone && message.kind === "exported" && <div>{d.iphoneHint}</div>}
          </div>
        )}
      </section>
    </div>
  );
}
