import { useEffect, useRef, useState } from "react";
import { bridge, failure, type DiscoveredBridge, type Fault } from "./bridge";
import { useMessages } from "./i18n";
import type { Platform } from "./platform";

type Message = { kind: "empty" | "picked" } | { kind: "error"; fault: Fault } | null;

/**
 * Bounded LAN search. Selecting a result only fills the address; it never
 * logs in or sends anything to the lamp.
 */
export function DiscoveryPanel({ disabled, dimmed = false, current, platform, select, onSearching }: {
  disabled: boolean;
  dimmed?: boolean;
  current?: string;
  platform: Platform;
  select: (candidate: DiscoveredBridge) => void;
  onSearching?: (searching: boolean) => void;
}) {
  const m = useMessages();
  const d = m.discovery;
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DiscoveredBridge[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const report = useRef(onSearching);
  report.current = onSearching;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (inFlight.current) report.current?.(false);
    };
  }, []);
  async function search() {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setSearching(true);
    report.current?.(true);
    setResults([]);
    setMessage(null);
    try {
      const found = await bridge.discover();
      if (!mounted.current) return;
      setResults(found);
      setMessage(found.length ? null : { kind: "empty" });
    } catch (error) {
      if (mounted.current) setMessage({ kind: "error", fault: failure(error) });
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setSearching(false);
        report.current?.(false);
      }
    }
  }
  const hint = m.discoveryHint[platform];
  return (
    <section aria-label={d.section}>
      <div className="group-label">{d.section}</div>
      <div className={`glass${dimmed ? " dimmed" : ""}`}>
        <div className="action-row">
          <div className="action-text">
            <div className="action-title">{d.title}</div>
            <div className="action-desc">{searching ? d.searching : d.desc}</div>
          </div>
          {searching && <span className="spinner" aria-hidden="true" />}
          <button type="button" className="pill-button" disabled={disabled || searching}
            aria-label={searching ? d.searching : d.title} aria-busy={searching}
            onClick={() => void search()}>
            {d.search}
          </button>
        </div>
        {results.map((candidate) => {
          const address = `${candidate.host}:${candidate.port}`;
          const picked = current === address;
          return (
            <button key={address} type="button" className="result-row" aria-pressed={picked}
              aria-label={d.select(candidate.name, address)} disabled={disabled || searching}
              onClick={() => {
                select(candidate);
                setMessage({ kind: "picked" });
              }}>
              <span className="result-icon" aria-hidden="true"><span /></span>
              <span className="result-text">
                <span className="result-name">{candidate.name}</span>
                <span className="result-address">{address}</span>
              </span>
              {picked && <span className="result-check" aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
      {message && (
        <p role="status" className={`group-note${message.kind === "picked" ? "" : " warn"}`}>
          {message.kind === "error" ? m.fault(message.fault) : message.kind === "picked" ? d.picked : d.empty}
          {message.kind === "empty" && hint && ` ${hint}`}
        </p>
      )}
    </section>
  );
}
