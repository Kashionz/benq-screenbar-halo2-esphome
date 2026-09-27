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
      setMessage(found.length ? null : { kind: "empty", text: "找不到橋接器，可直接輸入 IP。" });
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
      <div className={`group${dimmed ? " dimmed" : ""}`}>
        <button type="button" className="list-button search-row" disabled={disabled || searching}
          aria-busy={searching} onClick={() => void search()}>
          <span>{searching ? "搜尋中…約 5 秒" : "搜尋區域網路"}</span>
          {searching && <span className="spinner" aria-hidden="true" />}
        </button>
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
              <span className="result-text">
                <span className="result-name">{candidate.name}</span>
                <span className="result-address">{address}</span>
              </span>
              <span className="result-check" aria-hidden="true">{picked ? "✓" : ""}</span>
            </button>
          );
        })}
      </div>
      {message && (
        <p role="status" className={`group-note${message.kind === "picked" ? " muted-2" : " warn"}`}>
          {message.text}
          {message.kind === "empty" && hint && ` ${hint}`}
        </p>
      )}
    </section>
  );
}
