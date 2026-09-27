import type { SavedConnection, Snapshot } from "./bridge";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

function pairingText(snapshot: Snapshot | null) {
  if (!snapshot) return "—";
  if (snapshot.pairing_status !== "ready") return "未就緒";
  return snapshot.pairing_persisted ? "已保存" : "未保存";
}

/** Device details, connection actions and local diagnostics, pushed over the main screen. */
export function DevicePage({
  snapshot,
  address,
  updated,
  busy,
  saved,
  settingsMessage,
  native,
  raw,
  refresh,
  disconnect,
  forget,
}: {
  snapshot: Snapshot | null;
  address: string;
  updated: string;
  busy: boolean;
  saved: SavedConnection | null;
  settingsMessage: string;
  native: boolean;
  raw: unknown;
  refresh: () => void;
  disconnect: () => void;
  forget: () => void;
}) {
  return (
    <div className="device-page">
      <section aria-label="橋接器">
        <div className="group-label">橋接器</div>
        <div className="group list">
          <div className="device-head">
            <div className="device-name">ScreenBar Halo 2</div>
            <div className="device-address">{address}</div>
          </div>
          <div className="kv">
            <span>無線模組</span>
            <span>{snapshot?.radio_status === "ready" ? "就緒" : "未就緒"}</span>
          </div>
          <div className="kv">
            <span>配對</span>
            <span>{pairingText(snapshot)}</span>
          </div>
          <div className="kv">
            <span>最後同步</span>
            <span className="num">{updated || "—"}</span>
          </div>
        </div>
      </section>
      <div className="group">
        <button type="button" className="list-button" disabled={busy} onClick={refresh}>
          重新整理
        </button>
        <button type="button" className="list-button" disabled={busy} onClick={disconnect}>
          中斷連線／更換裝置
        </button>
        {saved && (
          <button type="button" className="list-button danger" disabled={busy} onClick={forget}>
            忘記已保存連線
          </button>
        )}
      </div>
      {settingsMessage && (
        <p role="status" className="group-note tight">
          {settingsMessage}
        </p>
      )}
      {native && <DiagnosticsPanel raw={raw} reloadKey={updated} />}
    </div>
  );
}
