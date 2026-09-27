import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { DiagnosticsPanel, describeEvent } from "./DiagnosticsPanel";
import { DevicePage } from "./DevicePage";
import { bridge, type DiagnosticReport, type Snapshot } from "./bridge";
import examples from "../../protocol/v1/examples.json";
vi.mock("./bridge", async (original) => ({
  ...(await original<typeof import("./bridge")>()),
  bridge: { diagnostics: vi.fn(), exportDiagnostics: vi.fn(), clearDiagnostics: vi.fn() },
}));
const snapshot = examples.find((e) => e.schema === "Snapshot")!.body as unknown as Snapshot;
const tx = (sent: number, planned: number, irq: number | null, fifo: number | null) => ({
  frames_planned: planned,
  frames_attempted: sent,
  frames_transmitted: sent,
  irq,
  fifo,
});
const event = (patch: Partial<DiagnosticReport["events"][number]>): DiagnosticReport["events"][number] => ({
  unix_ms: Date.now(),
  kind: "command",
  device_id: null,
  command_id: null,
  status: "transmitted",
  error_code: null,
  tx: null,
  ...patch,
});
const report: DiagnosticReport = {
  events: [
    event({ kind: "state", status: "ready" }),
    event({ status: "failed", error_code: "RADIO_UNAVAILABLE", tx: tx(0, 12, null, null) }),
    event({ kind: "error", status: "failed", error_code: "UNKNOWN_OUTCOME" }),
    event({ status: "transmitted", tx: tx(12, 12, 0x2e, 0) }),
  ],
  warning: null,
};
const raw = { device_id: snapshot.device_id, boot_id: snapshot.boot_id, radio: "ready" };
const agent = navigator.userAgent;
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "userAgent", { value: agent, configurable: true });
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bridge.diagnostics).mockResolvedValue(report);
});
it("loads local history on open with plain labels and a summary", async () => {
  render(<DiagnosticsPanel raw={raw} reloadKey="1" />);
  await screen.findByText("診斷 · 最近 4 筆：2 成功 · 1 結果不明 · 1 失敗");
  expect(bridge.diagnostics).toHaveBeenCalledTimes(1);
  expect(screen.getByText("· 發送失敗", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("保留最近 200 筆")).toBeInTheDocument();
});
it("shows error codes, TX/IRQ/FIFO and JSON only after expanding raw data", async () => {
  const user = userEvent.setup();
  render(<DiagnosticsPanel raw={raw} reloadKey="1" />);
  await screen.findByText(/最近 4 筆/);
  const hidden = [/RADIO_UNAVAILABLE/, /UNKNOWN_OUTCOME/, /TX 12\/12/, /IRQ/, /FIFO/, new RegExp(snapshot.boot_id)];
  for (const text of hidden) expect(screen.queryByText(text)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "顯示原始資料" }));
  expect(screen.getByText("RADIO_UNAVAILABLE · TX 0/12 · IRQ — · FIFO —")).toBeInTheDocument();
  expect(screen.getByText("TX 12/12 · IRQ 2E · FIFO 0")).toBeInTheDocument();
  expect(screen.getByText("UNKNOWN_OUTCOME")).toBeInTheDocument();
  expect(screen.getByText(new RegExp(snapshot.boot_id))).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "隱藏原始資料" }));
  expect(screen.queryByText(/UNKNOWN_OUTCOME/)).not.toBeInTheDocument();
});
it("exports with the iPhone Files hint and clears history", async () => {
  Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone)", configurable: true });
  vi.mocked(bridge.exportDiagnostics).mockResolvedValue("Halo2Control/halo2-diagnostics.json");
  const user = userEvent.setup();
  render(<DiagnosticsPanel raw={raw} reloadKey="1" />);
  await user.click(screen.getByRole("button", { name: "匯出診斷 JSON" }));
  await screen.findByText("已匯出：Halo2Control/halo2-diagnostics.json");
  expect(screen.getByText("到「檔案」→「我的 iPhone」→「Halo 2 Control」→「Halo2Control」取用。")).toBeInTheDocument();
  vi.mocked(bridge.diagnostics).mockResolvedValue({ events: [], warning: null });
  await user.click(screen.getByRole("button", { name: "清除歷史紀錄" }));
  await waitFor(() => expect(bridge.clearDiagnostics).toHaveBeenCalledTimes(1));
  await screen.findByText("診斷 · 沒有紀錄");
  expect(screen.getByText("歷史紀錄已清除。")).toBeInTheDocument();
});
it("never labels an unknown command status as sent", () => {
  expect(describeEvent(event({ status: "unknown" }))).toMatchObject({ status: "結果不明", tone: "warn" });
  expect(describeEvent(event({ kind: "error", error_code: "NETWORK" }))).toMatchObject({ title: "連線", tone: "err" });
});
it("device page shows bridge rows and hides forget without a saved profile", async () => {
  const refresh = vi.fn();
  const view = render(
    <DevicePage snapshot={snapshot} address="desk.local:8080" updated="21:14:08" busy={false} saved={null}
      settingsMessage="" native={false} raw={raw} refresh={refresh} disconnect={vi.fn()} forget={vi.fn()} />,
  );
  expect(screen.getByText("desk.local:8080")).toBeInTheDocument();
  expect(screen.getByText("21:14:08")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "忘記已保存連線" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "重新整理" }));
  expect(refresh).toHaveBeenCalledOnce();
  view.rerender(
    <DevicePage snapshot={snapshot} address="desk.local:8080" updated="" busy={true}
      saved={{ host: "desk.local", port: 8080, username: "u", device_id: snapshot.device_id }}
      settingsMessage="" native={false} raw={raw} refresh={refresh} disconnect={vi.fn()} forget={vi.fn()} />,
  );
  expect(screen.getByRole("button", { name: "忘記已保存連線" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "重新整理" })).toBeDisabled();
});
