import type { Feedback, Tone } from "./controlState";

export interface BannerSpec {
  tone: Tone;
  title: string;
  body: string;
  action?: { label: string; run: () => void; disabled?: boolean };
}

export function Banner({ banner }: { banner: BannerSpec }) {
  return (
    <div role="alert" className={`banner tone-${banner.tone}`}>
      <span className={`dot${banner.tone === "warn" ? " pulse" : ""}`} />
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

/** One status line: a bold title followed by plain text, or a plain hint. */
export interface Line {
  tone: Tone;
  title?: string;
  body: string;
}

/** Status beside the power button; the hint names the next explicit action. */
export function powerLine(status: Feedback | null, next: string): Line {
  if (!status) return { tone: "idle", body: `按一下${next}` };
  return { tone: status.tone, title: status.title, body: status.body ? ` · ${status.body}` : "" };
}

export function StatusLine({ line, className = "" }: { line: Line; className?: string }) {
  return (
    <div className={`status-line tone-${line.tone} ${className}`.trim()} aria-live="polite">
      {line.tone === "busy" && <span className="spinner small" aria-hidden="true" />}
      <span>
        {line.title && <b>{line.title}</b>}
        {line.body}
      </span>
    </div>
  );
}

/** Footer connection status, shared by the main window and the tray flyout. */
export function ConnectionStatus({
  connected,
  online,
  updated,
}: {
  connected: boolean;
  online: boolean;
  updated: string;
}) {
  const tone: Tone = !connected ? "idle" : online ? "ok" : "warn";
  const text = !connected
    ? "未連線"
    : online
      ? `已連線 · 同步 ${updated}`
      : `已斷線 · 重試中 · 最後同步 ${updated}`;
  return (
    <span className={`connection-status tone-${tone}`}>
      <span className={`dot${tone === "warn" ? " pulse" : ""}`} />
      <span>{text}</span>
    </span>
  );
}
