import { useEffect, useRef, useState } from "react";
import { bridge, failure, type DiscoveredBridge } from "./bridge";
import { DISCOVERY_HINT, type Platform } from "./platform";

type Message = { kind: "empty" | "picked" | "error"; text: string } | null;

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
      setMessage(found.length ? null : { kind: "empty", text: "找不到裝置，可直接輸入 IP。" });
    } catch (error) {
      if (mounted.current) setMessage({ kind: "error", text: failure(error).message });
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setSearching(false);
        report.current?.(false);
      }
    }
  }
  const hint = DISCOVERY_HINT[platform];
  return (
    <section aria-label="區域網路">
      <div className="group-label">區域網路</div>
      <div className={`glass${dimmed ? " dimmed" : ""}`}>
        <div className="action-row">
          <div className="action-text">
            <div className="action-title">搜尋區域網路</div>
            <div className="action-desc">{searching ? "搜尋中…約 5 秒" : "約 5 秒，選取後只會填入位址。"}</div>
          </div>
          {searching && <span className="spinner" aria-hidden="true" />}
          <button type="button" className="pill-button" disabled={disabled || searching}
            aria-label={searching ? "搜尋中…約 5 秒" : "搜尋區域網路"} aria-busy={searching}
            onClick={() => void search()}>
            搜尋
          </button>
        </div>
        {results.map((candidate) => {
          const address = `${candidate.host}:${candidate.port}`;
          const picked = current === address;
          return (
            <button key={address} type="button" className="result-row" aria-pressed={picked}
              aria-label={`選取 ${candidate.name} ${address}`} disabled={disabled || searching}
              onClick={() => {
                select(candidate);
                setMessage({ kind: "picked", text: "已填入，請輸入密碼。" });
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
          {message.text}
          {message.kind === "empty" && hint && ` ${hint}`}
        </p>
      )}
    </section>
  );
}
