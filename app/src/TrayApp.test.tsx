import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import TrayApp from "./TrayApp";
import { bridge, flyout, type Snapshot } from "./bridge";
import type { FlyoutIntent, FlyoutState } from "./flyout";
import examples from "../../protocol/v1/examples.json";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("./bridge", () => ({
  bridge: { presets: vi.fn() },
  flyout: {
    onState: vi.fn(),
    onAck: vi.fn(),
    onShown: vi.fn(),
    send: vi.fn(),
    openMain: vi.fn(),
    hide: vi.fn(),
    resize: vi.fn(),
    quit: vi.fn(),
  },
}));
const snapshot = examples.find((e) => e.schema === "Snapshot")!.body as unknown as Snapshot;
const ready: FlyoutState = {
  connected: true,
  online: true,
  badge: { tone: "ok", text: "已連線" },
  lock: null,
  desired: snapshot.desired.values,
  features: snapshot.features,
  feedback: { tone: "idle", title: "就緒", body: "", lookup: false },
  updated: "21:14:08",
};
let publish!: (payload: unknown) => void;
let ack!: (payload: unknown) => void;
let shown!: () => void;
beforeEach(() => {
  vi.mocked(flyout.onState).mockImplementation(async (h) => { publish = h; return () => {}; });
  vi.mocked(flyout.onAck).mockImplementation(async (h) => { ack = h; return () => {}; });
  vi.mocked(flyout.onShown).mockImplementation(async (h) => { shown = h; return () => {}; });
  vi.mocked(flyout.send).mockResolvedValue();
  vi.mocked(flyout.openMain).mockResolvedValue();
  vi.mocked(flyout.hide).mockResolvedValue();
  vi.mocked(bridge.presets).mockResolvedValue([
    { id: "1", name: "夜晚", values: { mode: "back", front_brightness: 30, back_brightness: 20, temperature_k: 3925 } },
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const sent = () => vi.mocked(flyout.send).mock.calls.map(([intent]) => intent as FlyoutIntent);
async function open(state: FlyoutState | null = ready) {
  render(<TrayApp />);
  await waitFor(() => expect(flyout.onState).toHaveBeenCalled());
  await waitFor(() => expect(sent().some((i) => i.kind === "sync")).toBe(true));
  if (state) act(() => publish(state));
}
it("stays fully disabled until the main window reports a connection", async () => {
  await open(null);
  expect(screen.getByText("未連線", { selector: "b" })).toBeInTheDocument();
  expect(screen.getByText("NO CLOUD")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "開燈" })).toBeDisabled();
  for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
});
it("sends one explicit power intent from the target, never a toggle, and never calls the bridge", async () => {
  await open();
  expect(screen.getByText("已連線 · 目標開啟 · 後燈")).toBeInTheDocument();
  expect(screen.getByText("同步 21:14:08")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "關燈" }));
  const power = sent().filter((i) => i.kind === "power");
  expect(power).toHaveLength(1);
  expect(power[0]).toMatchObject({ kind: "power", value: false });
  // While waiting for the main window's answer the flyout cannot send again.
  expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
  act(() => ack({ id: power[0].id, done: false }));
  expect(screen.getByRole("button", { name: "關燈" })).toBeEnabled();
});
it("keeps a local draft, applies only changed fields and clears after a done ack", async () => {
  await open();
  await userEvent.click(screen.getByRole("button", { name: "帶入情境 夜晚" }));
  expect(screen.getByText("2 項變更尚未套用")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("色溫"), { target: { value: "5000" } });
  expect(screen.getByText("3 項變更尚未套用")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "套用燈光設定" }));
  const apply = sent().filter((i) => i.kind === "apply");
  expect(apply).toHaveLength(1);
  expect(apply[0]).toMatchObject({ patch: { front_brightness: 30, back_brightness: 20, temperature_k: 5000 } });
  act(() => ack({ id: "someone-else", done: true }));
  expect(screen.getByText("3 項變更尚未套用")).toBeInTheDocument();
  act(() => ack({ id: apply[0].id, done: true }));
  expect(screen.queryByText(/項變更尚未套用/)).not.toBeInTheDocument();
});
it("drops the draft when reopened", async () => {
  await open();
  fireEvent.change(screen.getByLabelText("前燈亮度"), { target: { value: "70" } });
  expect(screen.getByText("1 項變更尚未套用")).toBeInTheDocument();
  act(() => shown());
  expect(screen.queryByText(/項變更尚未套用/)).not.toBeInTheDocument();
  expect(sent().filter((i) => i.kind !== "sync")).toHaveLength(0);
});
it("locks with the main window and sends unknown outcomes to the main window for lookup", async () => {
  await open({
    ...ready,
    lock: "結果不明，請先查詢",
    feedback: { tone: "warn", title: "結果不明", body: "請先查詢，不要重送。", lookup: true },
  });
  expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "帶入情境 夜晚" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("結果不明");
  await userEvent.click(screen.getByRole("button", { name: "查詢" }));
  expect(flyout.openMain).toHaveBeenCalledOnce();
  expect(sent().filter((i) => i.kind !== "sync")).toHaveLength(0);
});
it("hides on Escape", async () => {
  await open();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(flyout.hide).toHaveBeenCalledOnce();
});
