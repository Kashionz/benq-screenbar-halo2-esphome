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
  lock: null,
  desired: snapshot.desired.values,
  values: snapshot.desired.values,
  adjusting: [],
  sending: false,
  features: snapshot.features,
  status: null,
  updated: "21:14:08",
  theme: "light",
  locale: "zh-TW",
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
const intents = () => sent().filter((i) => i.kind !== "sync");
async function open(state: FlyoutState | null = ready) {
  render(<TrayApp />);
  await waitFor(() => expect(flyout.onState).toHaveBeenCalled());
  await waitFor(() => expect(sent().some((i) => i.kind === "sync")).toBe(true));
  if (state) act(() => publish(state));
}
it("stays fully disabled until the main window reports a connection", async () => {
  await open(null);
  // Both the power line and the footer say so.
  expect(screen.getAllByText("未連線")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "開燈" })).toBeDisabled();
  for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
});
it("sends one explicit power intent from the target, never a toggle, and never calls the bridge", async () => {
  await open();
  expect(screen.getByText("已連線 · 同步 21:14:08")).toBeInTheDocument();
  expect(screen.getByText("按一下關燈")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "關燈" }));
  const power = intents();
  expect(power).toHaveLength(1);
  expect(power[0]).toMatchObject({ kind: "power", value: false });
  // While waiting for the main window's answer a second press is ignored.
  await userEvent.click(screen.getByRole("button", { name: "關燈" }));
  expect(intents()).toHaveLength(1);
  act(() => ack({ id: power[0].id, done: false }));
  await userEvent.click(screen.getByRole("button", { name: "關燈" }));
  expect(intents()).toHaveLength(2);
});
it("sends slider, mode and preset changes live, with no apply row", async () => {
  await open();
  expect(screen.queryByRole("button", { name: "套用燈光設定" })).not.toBeInTheDocument();
  const slider = screen.getByLabelText("色溫");
  fireEvent.change(slider, { target: { value: "5000" } });
  expect(slider).toHaveValue("5000");
  await userEvent.click(screen.getByRole("radio", { name: "前後燈" }));
  await userEvent.click(screen.getByRole("button", { name: "帶入情境 夜晚" }));
  expect(intents().map((i) => i.kind === "adjust" && i.patch)).toEqual([
    { temperature_k: 5000 },
    { mode: "both" },
    { mode: "back", back_brightness: 20, temperature_k: 3925 },
  ]);
});
it("only lets the lamps the mode lights be adjusted", async () => {
  await open({ ...ready, values: { ...ready.values!, mode: "back" } });
  expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
  expect(screen.getByLabelText("後燈亮度")).toBeEnabled();
  act(() => publish({ ...ready, values: { ...ready.values!, mode: "front" } }));
  expect(screen.getByLabelText("前燈亮度")).toBeEnabled();
  expect(screen.getByLabelText("後燈亮度")).toBeDisabled();
  act(() => publish({ ...ready, values: { ...ready.values!, mode: "both" } }));
  expect(screen.getByLabelText("前燈亮度")).toBeEnabled();
  expect(screen.getByLabelText("後燈亮度")).toBeEnabled();
});
it("follows the main window after a drag ends", async () => {
  await open();
  const slider = screen.getByLabelText("後燈亮度");
  fireEvent.change(slider, { target: { value: "70" } });
  expect(slider).toHaveValue("70");
  fireEvent.pointerUp(slider);
  expect(slider).toHaveValue(String(ready.values!.back_brightness));
  act(() => publish({ ...ready, values: { ...ready.values!, back_brightness: 70 }, adjusting: ["back_brightness"] }));
  expect(slider).toHaveValue("70");
});
it("keeps power and sliders usable while the main window is sending", async () => {
  await open({ ...ready, sending: true });
  expect(screen.getByRole("button", { name: "關燈" })).toBeEnabled();
  expect(screen.getByLabelText("後燈亮度")).toBeEnabled();
});
it("locks with the main window and sends unknown outcomes to the main window for lookup", async () => {
  await open({
    ...ready,
    lock: "unknown",
    status: { tone: "warn", title: "結果不明", body: "請先查詢，不要重送。", lookup: true },
  });
  expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "帶入情境 夜晚" })).toBeDisabled();
  expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
  expect(screen.getByText("結果不明").parentElement).toHaveTextContent("結果不明，請先查詢");
  await userEvent.click(screen.getByRole("button", { name: "查詢" }));
  expect(flyout.openMain).toHaveBeenCalledOnce();
  expect(intents()).toHaveLength(0);
});
it("drops a value under the pointer when reopened and hides on Escape", async () => {
  await open();
  fireEvent.change(screen.getByLabelText("前燈亮度"), { target: { value: "70" } });
  act(() => shown());
  expect(screen.getByLabelText("前燈亮度")).toHaveValue(String(ready.values!.front_brightness));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(flyout.hide).toHaveBeenCalledOnce();
});
it("shows the main window's command status beside power and the offline state in the footer", async () => {
  await open({
    ...ready,
    lock: "busy",
    sending: true,
    status: { tone: "busy", title: "處理中", body: "正在送出「關燈」", lookup: false },
  });
  expect(screen.getByText("處理中").parentElement).toHaveTextContent("處理中 · 正在送出「關燈」");
  // The power button keeps its look while its command is in flight, but a press sends nothing.
  const power = screen.getByRole("button", { name: "關燈" });
  expect(power).toBeEnabled();
  expect(power).toHaveAttribute("aria-disabled", "true");
  await userEvent.click(power);
  expect(intents()).toHaveLength(0);
  act(() => publish({ ...ready, online: false, lock: "offline" }));
  expect(screen.getByText("已斷線")).toBeInTheDocument();
  expect(screen.getByText("已斷線 · 重試中 · 最後同步 21:14:08")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
});
it("follows the theme the main window publishes", async () => {
  await open({ ...ready, theme: "dark" });
  expect(document.documentElement.dataset.theme).toBe("dark");
  act(() => publish({ ...ready, theme: "light" }));
  expect(document.documentElement.dataset.theme).toBe("light");
});
it("follows the language the main window publishes", async () => {
  await open({ ...ready, locale: "en" });
  expect(document.documentElement.lang).toBe("en");
  expect(screen.getByRole("button", { name: "Open HaloDesk" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument();
  expect(screen.getByLabelText("Front brightness")).toBeInTheDocument();
  act(() => publish({ ...ready, locale: "zh-TW" }));
  expect(document.documentElement.lang).toBe("zh-Hant");
  expect(screen.getByRole("button", { name: "開啟 HaloDesk" })).toBeInTheDocument();
});
