import { useEffect, useRef, useState } from "react";
import { bridge, failure, type DiscoveredBridge } from "./bridge";

export function DiscoveryPanel({ disabled, select }: {
  disabled: boolean;
  select: (candidate: DiscoveredBridge) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DiscoveredBridge[]>([]);
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function search() {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setSearching(true);
    setResults([]);
    setMessage("");
    try {
      const found = await bridge.discover();
      if (!mounted.current) return;
      setResults(found);
      setMessage(found.length ? "選取橋接器後，請輸入帳密並按連線。" :
        "未找到橋接器。請確認同一個區域網路與存取權限，也可以直接輸入 IP。");
    } catch (error) {
      if (mounted.current) setMessage(failure(error).message);
    } finally {
      inFlight.current = false;
      if (mounted.current) setSearching(false);
    }
  }
  return <div className="discovery-panel">
    <button type="button" className="secondary" disabled={disabled || searching} onClick={() => void search()}>
      {searching ? "正在搜尋…（約 5 秒）" : "搜尋區域網路橋接器"}
    </button>
    <p className="hint" role="status">{message}</p>
    {results.length > 0 && <ul className="discovery-results">
      {results.map(candidate => <li key={`${candidate.host}:${candidate.port}`}>
        <button type="button" className="secondary" aria-label={`選取 ${candidate.name} ${candidate.host}:${candidate.port}`} disabled={disabled || searching} onClick={() => {
          select(candidate);
          setMessage("位址已填入，請輸入密碼後連線。");
        }}>
          <strong>{candidate.name}</strong><br />{candidate.host}:{candidate.port}
        </button>
      </li>)}
    </ul>}
  </div>;
}
