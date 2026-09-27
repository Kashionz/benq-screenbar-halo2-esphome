import type { Snapshot } from "./bridge";
import { levelSummary, modeLabel, type Feedback, type Tone } from "./controlState";

export interface BannerSpec {
  tone: Tone;
  title: string;
  body: string;
  action?: { label: string; run: () => void; disabled?: boolean };
}

export function Banner({ banner }: { banner: BannerSpec }) {
  return (
    <div role="alert" className={`banner tone-${banner.tone}`}>
      <span className="dot" />
      <div className="banner-text">
        <b>{banner.title}</b>
        {banner.body && `　${banner.body}`}
      </div>
      {banner.action && (
        <button type="button" disabled={banner.action.disabled} onClick={banner.action.run}>
          {banner.action.label}
        </button>
      )}
    </div>
  );
}

export function TargetList({
  snapshot,
  online,
  updated,
  source,
}: {
  snapshot: Snapshot;
  online: boolean;
  updated: string;
  source: string;
}) {
  const desired = snapshot.desired.values;
  return (
    <section aria-label="目標">
      <div className="group-label">{online ? "目標" : `最後已知目標 · ${updated}`}</div>
      <div className="group list">
        <div className="kv">
          <span>電源</span>
          <strong>{desired.power ? "開啟" : "關閉"}</strong>
        </div>
        <div className="kv">
          <span>模式</span>
          <span>{modeLabel(desired.mode)}</span>
        </div>
        <div className="kv">
          <span>亮度與色溫</span>
          <span className="num">{levelSummary(desired)}</span>
        </div>
        <div className="kv">
          <span>來源</span>
          <span>{source}</span>
        </div>
      </div>
    </section>
  );
}

export function RecentCommand({
  feedback,
  snapshot,
  lookup,
  lookupDisabled,
}: {
  feedback: Feedback;
  snapshot: Snapshot;
  lookup: () => void;
  lookupDisabled: boolean;
}) {
  const remote = snapshot.observed_remote;
  return (
    <section aria-label="最近命令">
      <div className="group-label">最近命令</div>
      <div className="group recent" aria-live="polite">
        <div className={`recent-main tone-${feedback.tone}`}>
          <span className="dot" />
          <div className="recent-text">
            <div className="recent-title">{feedback.title}</div>
            {feedback.body && <div className="recent-body">{feedback.body}</div>}
          </div>
          {feedback.lookup && (
            <button type="button" className="solid-small" disabled={lookupDisabled} onClick={lookup}>
              查詢命令結果
            </button>
          )}
        </div>
        {remote && (
          <div className="recent-remote">
            <span>
              原廠控制器：{remote.values.power ? "開燈" : "關燈"} · {modeLabel(remote.values.mode)} ·{" "}
              {remote.values.front_brightness}% / {remote.values.back_brightness}% ·{" "}
              {remote.values.temperature_k} K
            </span>
            <span className="muted">
              約 {Math.max(0, Math.round((snapshot.uptime_ms - remote.received_at_uptime_ms) / 1000))} 秒前
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
