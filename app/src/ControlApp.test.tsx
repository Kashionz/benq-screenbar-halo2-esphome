import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import App from "./ControlApp";
import {
  bridge,
  flyout,
  type Snapshot,
  type CommandRecord,
} from "./bridge";
import examples from "../../protocol/v1/examples.json";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));
vi.mock("./bridge", async (original) => ({
  ...(await original<typeof import("./bridge")>()),
  flyout: {
    publish: vi.fn().mockResolvedValue(undefined),
    ack: vi.fn().mockResolvedValue(undefined),
    onIntent: vi.fn().mockResolvedValue(() => {}),
    onShown: vi.fn().mockResolvedValue(() => {}),
  },
  bridge: {
    discover: vi.fn(),
    presets: vi.fn().mockResolvedValue([]),
    windowTheme: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn(),
    disconnect: vi.fn(),
    state: vi.fn(),
    power: vi.fn(),
    setState: vi.fn(),
    lookup: vi.fn(),
    saved: vi.fn(),
    remember: vi.fn(),
    forget: vi.fn(),
    connectSaved: vi.fn(),
    diagnostics: vi.fn(),
    exportDiagnostics: vi.fn(),
    clearDiagnostics: vi.fn(),
  },
}));
const snapshot = examples.find((e) => e.schema === "Snapshot")!
  .body as unknown as Snapshot;
const withDesired = (values: Partial<Snapshot["desired"]["values"]>, version = 1): Snapshot => ({
  ...snapshot,
  state_version: snapshot.state_version + version,
  desired: { ...snapshot.desired, values: { ...snapshot.desired.values, ...values } },
});
const transmitted = (id = "command-1") =>
  ({ status: "transmitted", boot_id: snapshot.boot_id, command_id: id }) as CommandRecord;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bridge.saved).mockResolvedValue(null);
  vi.mocked(bridge.connect).mockResolvedValue(snapshot);
  vi.mocked(bridge.state).mockResolvedValue(snapshot);
  vi.mocked(bridge.diagnostics).mockResolvedValue({ events: [], warning: null });
});
async function login() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("帳號"), "test");
  await user.type(screen.getByLabelText("密碼"), "secret");
  await user.click(screen.getByRole("button", { name: "連線" }));
  await screen.findByText(/^已連線 · 同步 /);
  return user;
}
const openDevice = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "設定" }));
const backToLights = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "燈光" }));
describe("control safety", () => {
  it("removes the previous boot's command result without transmitting after a reboot", async () => {
    vi.mocked(bridge.power).mockResolvedValue(transmitted());
    render(<App />);
    const user = await login();
    await user.click(screen.getByRole("button", { name: "關燈" }));
    await screen.findByText("指令已送出");
    vi.mocked(bridge.state).mockResolvedValue({ ...snapshot, boot_id: "new-boot", last_command: null });
    await openDevice(user);
    await user.click(screen.getByRole("button", { name: "重新整理" }));
    await backToLights(user);
    await waitFor(() => expect(screen.queryByText("指令已送出")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("裝置已重新開機");
    expect(bridge.power).toHaveBeenCalledTimes(1);
  });
  it("selects discovered addresses without login or RF and clears the entered password", async () => {
    vi.mocked(bridge.discover).mockResolvedValue([{ name: "Desk", host: "desk.local", port: 8080 }]);
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("密碼"), "previous-secret");
    expect(bridge.discover).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "搜尋區域網路" }));
    await user.click(await screen.findByRole("button", { name: /Desk desk.local:8080/ }));
    expect(screen.getByLabelText("主機")).toHaveValue("desk.local");
    expect(screen.getByLabelText("密碼")).toHaveValue("");
    expect(bridge.connect).not.toHaveBeenCalled();
    expect(bridge.connectSaved).not.toHaveBeenCalled();
    expect(bridge.power).not.toHaveBeenCalled();
  });
  it("waits for an in-flight state read before sending one explicit command", async () => {
    let finishRead!: (value: Snapshot) => void;
    vi.mocked(bridge.state).mockImplementationOnce(
      () => new Promise((resolve) => { finishRead = resolve; }),
    );
    vi.mocked(bridge.power).mockResolvedValue(transmitted());
    render(<App />);
    const user = await login();
    await openDevice(user);
    await user.click(screen.getByRole("button", { name: "重新整理" }));
    await backToLights(user);
    await user.click(screen.getByRole("button", { name: "關燈" }));
    expect(bridge.power).not.toHaveBeenCalled();
    finishRead(snapshot);
    await waitFor(() => expect(bridge.power).toHaveBeenCalledTimes(1));
    expect(bridge.power).toHaveBeenCalledWith(snapshot.device_id, false);
  });
  it("does not transmit when the state read ahead of a command fails", async () => {
    let failRead!: (error: unknown) => void;
    vi.mocked(bridge.state).mockImplementationOnce(
      () => new Promise((_, reject) => { failRead = reject; }),
    );
    render(<App />);
    const user = await login();
    await openDevice(user);
    await user.click(screen.getByRole("button", { name: "重新整理" }));
    await backToLights(user);
    await user.click(screen.getByRole("button", { name: "關燈" }));
    failRead({ code: "NETWORK", message: "連線失敗" });
    await openDevice(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "中斷連線" })).toBeEnabled());
    expect(bridge.power).not.toHaveBeenCalled();
  });
  it("loads only saved metadata until the user explicitly connects", async () => {
    vi.mocked(bridge.saved).mockResolvedValue({
      host: "192.168.0.99",
      port: 8080,
      username: "saved",
      device_id: snapshot.device_id,
    });
    vi.mocked(bridge.connectSaved).mockResolvedValue(snapshot);
    render(<App />);
    const button = await screen.findByRole("button", {
      name: "使用已保存帳密連線",
    });
    expect(bridge.connectSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText("密碼")).toHaveValue("");
    await userEvent.click(button);
    await screen.findByText(/^已連線 · 同步 /);
    expect(bridge.connectSaved).toHaveBeenCalledTimes(1);
    expect(bridge.power).not.toHaveBeenCalled();
  });
  it("keeps a successful session usable when secure saving fails", async () => {
    vi.mocked(bridge.remember).mockRejectedValue({
      code: "CREDENTIAL_STORE",
      message: "憑證庫不可用",
    });
    render(<App />);
    await userEvent.click(screen.getByRole("switch", { name: "記住此連線與帳密" }));
    const user = await login();
    await openDevice(user);
    await screen.findByText(/本次已連線，但保存失敗/);
    await backToLights(user);
    expect(screen.getByRole("button", { name: "關燈" })).toBeEnabled();
  });
  it("offers no power control before connection", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: /開燈|關燈/ })).not.toBeInTheDocument();
    expect(screen.getByText("未連線")).toBeInTheDocument();
  });
  it("does not send a command when remote state is loaded", async () => {
    render(<App />);
    await login();
    expect(bridge.power).not.toHaveBeenCalled();
    expect(bridge.setState).not.toHaveBeenCalled();
    // The target list and its source are gone; the header names the lamp.
    expect(screen.queryByRole("region", { name: "目標" })).not.toBeInTheDocument();
    expect(screen.queryByText("原廠控制器")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "最近命令" })).not.toBeInTheDocument();
    expect(screen.getByText("ScreenBar Halo 2")).toBeInTheDocument();
    expect(screen.getByText("開發版 0.1.0")).toBeInTheDocument();
    expect(screen.queryByText(/NO CLOUD|非 BenQ 官方軟體/)).not.toBeInTheDocument();
  });
  it("unknown outcome disables new commands and offers lookup", async () => {
    vi.mocked(bridge.power).mockRejectedValue({
      code: "UNKNOWN_OUTCOME",
      message: "結果不明",
    });
    render(<App />);
    const user = await login();
    await user.click(screen.getByRole("button", { name: "關燈" }));
    await screen.findByRole("button", { name: "查詢命令結果" });
    expect(screen.getByText("結果不明")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("請先查詢「關燈」的結果。");
    expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
    expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
    expect(screen.queryByText("UNKNOWN_OUTCOME")).not.toBeInTheDocument();
    expect(bridge.power).toHaveBeenCalledTimes(1);
    expect(bridge.power).toHaveBeenCalledWith(snapshot.device_id, false);
  });
  it("shows authentication errors without marking connected", async () => {
    vi.mocked(bridge.connect).mockRejectedValue({
      code: "UNAUTHORIZED",
      message: "帳號或密碼不正確。",
    });
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("帳號"), "test");
    await user.type(screen.getByLabelText("密碼"), "bad");
    await user.click(screen.getByRole("button", { name: "連線" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("帳號或密碼不正確"),
    );
    expect(screen.queryByText(/已連線/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /開燈|關燈/ })).not.toBeInTheDocument();
  });
});

describe("single power button", () => {
  it("sends the explicit opposite of desired.power, never a toggle", async () => {
    vi.mocked(bridge.power).mockResolvedValue(transmitted());
    render(<App />);
    const user = await login();
    const off = screen.getByRole("button", { name: "關燈" });
    expect(off).toHaveAttribute("title", "關燈");
    expect(screen.getByText("按一下關燈")).toBeInTheDocument();
    vi.mocked(bridge.state).mockResolvedValue(withDesired({ power: false }));
    await user.click(off);
    expect(bridge.power).toHaveBeenLastCalledWith(snapshot.device_id, false);
    const on = await screen.findByRole("button", { name: "開燈" });
    expect(on).toHaveAttribute("title", "開燈");
    // The confirmation replaces the hint for a moment after a transmitted command.
    expect(screen.getByText("指令已送出")).toBeInTheDocument();
    await user.click(on);
    await waitFor(() => expect(bridge.power).toHaveBeenCalledTimes(2));
    expect(bridge.power).toHaveBeenLastCalledWith(snapshot.device_id, true);
    expect(bridge.setState).not.toHaveBeenCalled();
  });
});

describe("presence switch", () => {
  it("sends one explicit ultrasonic value, locks meanwhile and shows the bridge target afterwards", async () => {
    let finish!: (record: CommandRecord) => void;
    vi.mocked(bridge.setState).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    const user = await login();
    const toggle = screen.getByRole("switch", { name: /入席偵測/ });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(bridge.setState).toHaveBeenCalledExactlyOnceWith(snapshot.device_id, { ultrasonic_enabled: true });
    // Every control locks while the explicit command is in flight.
    expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
    expect(toggle).toBeDisabled();
    // The row itself says it is sending; the card label stays quiet.
    expect(screen.queryByText("已停用：處理中")).not.toBeInTheDocument();
    // Nothing flips before the bridge reports the new target.
    expect(toggle).toHaveAttribute("aria-checked", "false");
    vi.mocked(bridge.state).mockResolvedValue(withDesired({ ultrasonic_enabled: true }));
    finish(transmitted("sensing"));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(toggle).toBeEnabled();
    // Only power flashes its confirmation beside the power button.
    expect(screen.queryByText("指令已送出")).not.toBeInTheDocument();
    expect(bridge.power).not.toHaveBeenCalled();
  });
  it("sends one explicit auto-dimming value through the same guarded path", async () => {
    let finish!: (record: CommandRecord) => void;
    vi.mocked(bridge.setState).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    const user = await login();
    const toggle = screen.getByRole("switch", { name: /自動調光/ });
    await user.click(toggle);
    expect(bridge.setState).toHaveBeenCalledExactlyOnceWith(snapshot.device_id, { auto_dimming: true });
    expect(toggle).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("switch", { name: /入席偵測/ })).toHaveAttribute("aria-busy", "false");
    expect(screen.getByLabelText("後燈亮度")).toBeDisabled();
    vi.mocked(bridge.state).mockResolvedValue(withDesired({ auto_dimming: true }));
    finish(transmitted("dimming"));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(toggle).toHaveAttribute("aria-busy", "false");
    expect(bridge.power).not.toHaveBeenCalled();
  });
  it("never retries a failed presence command", async () => {
    vi.mocked(bridge.setState).mockResolvedValue({ ...transmitted("f"), status: "failed", error: { code: "TX_MAX_RETRIES" } });
    render(<App />);
    const user = await login();
    await user.click(screen.getByRole("switch", { name: /入席偵測/ }));
    await screen.findByText("發送失敗");
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(bridge.setState).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("switch", { name: /入席偵測/ })).toHaveAttribute("aria-checked", "false");
  });
});

describe("lamp preview", () => {
  it("follows live adjustments while power follows desired", async () => {
    let finish!: (record: CommandRecord) => void;
    vi.mocked(bridge.setState).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    await login();
    const preview = screen.getByTestId("lamp-preview");
    expect(within(preview).getByText("目標示意")).toBeInTheDocument();
    expect(within(preview).getByText("前 —")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("後燈亮度"), { target: { value: "70" } });
    expect(within(preview).getByText("後 70%")).toBeInTheDocument();
    expect(within(preview).getByText("目標示意")).toBeInTheDocument();
    await waitFor(() => expect(bridge.setState).toHaveBeenCalledTimes(1));
    finish(transmitted("live-1"));
    await waitFor(() => expect(within(preview).getByText("目標示意")).toBeInTheDocument());
  });
  it("keeps beams dark while desired power is off", async () => {
    vi.mocked(bridge.connect).mockResolvedValue(withDesired({ power: false }));
    vi.mocked(bridge.state).mockResolvedValue(withDesired({ power: false }));
    vi.mocked(bridge.setState).mockImplementation(() => new Promise(() => {}));
    render(<App />);
    const user = await login();
    await user.click(screen.getByRole("radio", { name: "前後燈" }));
    const preview = screen.getByTestId("lamp-preview");
    expect(within(preview).getByText("目標示意")).toBeInTheDocument();
    expect(within(preview).getByText("前 —")).toBeInTheDocument();
    expect(within(preview).getByText("後 —")).toBeInTheDocument();
  });
});

describe("live adjustment", () => {
  const calls = () => vi.mocked(bridge.setState).mock.calls.map(([, patch]) => patch);
  // Both lamps lit, so either brightness can be adjusted.
  const live = (values: Partial<Snapshot["desired"]["values"]>, version = 0) =>
    withDesired({ mode: "both", ...values }, version);
  beforeEach(() => {
    vi.mocked(bridge.connect).mockResolvedValue(live({}));
    vi.mocked(bridge.state).mockResolvedValue(live({}));
  });
  it("sends slider, mode and preset changes immediately without an apply step", async () => {
    // A bridge whose target follows the commands it receives.
    let values = { ...snapshot.desired.values, mode: "both" };
    let version = 0;
    vi.mocked(bridge.setState).mockImplementation(async (_device, patch) => {
      values = { ...values, ...patch };
      version += 1;
      return transmitted(`live-${version}`);
    });
    vi.mocked(bridge.state).mockImplementation(async () => live(values, version));
    vi.mocked(bridge.presets).mockResolvedValue([
      { id: "1", name: "夜晚", values: { mode: "back", front_brightness: 30, back_brightness: 20, temperature_k: 3925 } },
    ]);
    render(<App />);
    const user = await login();
    expect(screen.queryByRole("button", { name: "套用燈光設定" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("前燈亮度"), { target: { value: "70" } });
    await waitFor(() => expect(calls()).toEqual([{ front_brightness: 70 }]));
    await user.click(screen.getByRole("radio", { name: "前燈" }));
    await waitFor(() => expect(calls()).toHaveLength(2), { timeout: 2000 });
    expect(calls()[1]).toEqual({ mode: "front" });
    // Front mode: the back lamp is unlit and cannot be adjusted.
    expect(await screen.findByLabelText("後燈亮度")).toBeDisabled();
    await user.click(await screen.findByRole("button", { name: "帶入情境 夜晚" }));
    await waitFor(() => expect(calls()).toHaveLength(3), { timeout: 2000 });
    // Temperature already matches the target; the unlit front level and power
    // are never included.
    expect(calls()[2]).toEqual({ mode: "back", back_brightness: 20 });
    expect(bridge.power).not.toHaveBeenCalled();
  });
  it("coalesces a drag into the latest value instead of queueing every step", async () => {
    const finishers: Array<(record: CommandRecord) => void> = [];
    vi.mocked(bridge.setState).mockImplementation(() => new Promise((resolve) => { finishers.push(resolve); }));
    render(<App />);
    await login();
    const slider = screen.getByLabelText("前燈亮度");
    fireEvent.change(slider, { target: { value: "40" } });
    await waitFor(() => expect(calls()).toHaveLength(1));
    for (const value of [45, 50, 60, 72, 80]) fireEvent.change(slider, { target: { value: String(value) } });
    expect(slider).toHaveValue("80");
    expect(calls()).toHaveLength(1);
    finishers[0](transmitted("drag-1"));
    await waitFor(() => expect(calls()).toHaveLength(2), { timeout: 2000 });
    expect(calls()).toEqual([{ front_brightness: 40 }, { front_brightness: 80 }]);
    finishers[1](transmitted("drag-2"));
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(calls()).toHaveLength(2);
  });
  it("never retries a value whose command failed", async () => {
    vi.mocked(bridge.setState).mockResolvedValue({ ...transmitted("f"), status: "failed", error: { code: "TX_MAX_RETRIES" } });
    render(<App />);
    await login();
    fireEvent.change(screen.getByLabelText("前燈亮度"), { target: { value: "70" } });
    await screen.findByText("發送失敗");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(calls()).toEqual([{ front_brightness: 70 }]);
    expect(screen.getByLabelText("前燈亮度")).toHaveValue(String(snapshot.desired.values.front_brightness));
  });
  it("drops newer values and locks after an unknown outcome", async () => {
    let fail!: (error: unknown) => void;
    vi.mocked(bridge.setState).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    render(<App />);
    await login();
    const slider = screen.getByLabelText("前燈亮度");
    fireEvent.change(slider, { target: { value: "40" } });
    await waitFor(() => expect(calls()).toHaveLength(1));
    fireEvent.change(slider, { target: { value: "80" } });
    fail({ code: "UNKNOWN_OUTCOME", message: "結果不明" });
    await screen.findAllByRole("button", { name: "查詢命令結果" });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(calls()).toEqual([{ front_brightness: 40 }]);
    expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
  });
  it("does not send a compensating command when the target later changes elsewhere", async () => {
    vi.mocked(bridge.setState).mockResolvedValue(transmitted("mine"));
    render(<App />);
    await login();
    vi.mocked(bridge.state).mockResolvedValue(live({ front_brightness: 30 }, 5));
    fireEvent.change(screen.getByLabelText("前燈亮度"), { target: { value: "70" } });
    await waitFor(() => expect(calls()).toHaveLength(1));
    await waitFor(() => expect(screen.getByLabelText("前燈亮度")).toHaveValue("30"));
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(calls()).toEqual([{ front_brightness: 70 }]);
  });
  it("sends a power press after the lighting command in flight, then stops live sending", async () => {
    const lights: Array<(record: CommandRecord) => void> = [];
    vi.mocked(bridge.setState).mockImplementation(() => new Promise((resolve) => { lights.push(resolve); }));
    vi.mocked(bridge.power).mockResolvedValue(transmitted("power"));
    render(<App />);
    const user = await login();
    const slider = screen.getByLabelText("前燈亮度");
    fireEvent.change(slider, { target: { value: "40" } });
    await waitFor(() => expect(calls()).toHaveLength(1));
    fireEvent.change(slider, { target: { value: "80" } });
    const button = screen.getByRole("button", { name: "關燈" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(bridge.power).not.toHaveBeenCalled();
    lights[0](transmitted("light-1"));
    await waitFor(() => expect(bridge.power).toHaveBeenCalledTimes(1));
    expect(bridge.power).toHaveBeenCalledWith(snapshot.device_id, false);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(calls()).toEqual([{ front_brightness: 40 }]);
  });
  it("drops a power press waiting behind a lighting command whose outcome is unknown", async () => {
    let fail!: (error: unknown) => void;
    vi.mocked(bridge.setState).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    render(<App />);
    const user = await login();
    fireEvent.change(screen.getByLabelText("前燈亮度"), { target: { value: "40" } });
    await waitFor(() => expect(calls()).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "關燈" }));
    fail({ code: "UNKNOWN_OUTCOME", message: "結果不明" });
    await screen.findByRole("button", { name: "查詢命令結果" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(bridge.power).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
  });
  it("never sends the brightness of a lamp the mode leaves unlit", async () => {
    vi.mocked(bridge.connect).mockResolvedValue(withDesired({ mode: "front" }));
    vi.mocked(bridge.state).mockResolvedValue(withDesired({ mode: "front" }));
    vi.mocked(bridge.setState).mockResolvedValue(transmitted("unlit"));
    let intent!: (payload: unknown) => void;
    vi.mocked(flyout.onIntent).mockImplementation(async (handler) => {
      intent = handler;
      return () => {};
    });
    render(<App />);
    await login();
    expect(screen.getByLabelText("後燈亮度")).toBeDisabled();
    expect(screen.getByLabelText("前燈亮度")).toBeEnabled();
    // Even an intent that names the unlit lamp only sends what it lights.
    intent({ id: "i-1", kind: "adjust", patch: { back_brightness: 60, temperature_k: 3000 } });
    await waitFor(() => expect(calls()).toEqual([{ temperature_k: 3000 }]));
  });
  it("drops unsent values when the connection drops", async () => {
    let finish!: (record: CommandRecord) => void;
    vi.mocked(bridge.setState).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    await login();
    const slider = screen.getByLabelText("前燈亮度");
    fireEvent.change(slider, { target: { value: "40" } });
    await waitFor(() => expect(calls()).toHaveLength(1));
    fireEvent.change(slider, { target: { value: "80" } });
    vi.mocked(bridge.state).mockRejectedValue({ code: "NETWORK", message: "連線失敗" });
    finish(transmitted("before-drop"));
    await screen.findByText("已斷線，重試中");
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(calls()).toEqual([{ front_brightness: 40 }]);
    vi.mocked(bridge.state).mockResolvedValue(snapshot);
    await new Promise((resolve) => setTimeout(resolve, 2300));
    expect(calls()).toHaveLength(1);
  });
});

describe("responsive order", () => {
  const order = () => {
    const nodes = [
      screen.getByTestId("lamp-preview"),
      screen.getByRole("region", { name: "燈光" }),
      screen.getByRole("region", { name: "情境" }),
    ];
    return nodes
      .map((node, index) => ({ node, index }))
      .sort((a, b) => (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map(({ index }) => ["preview", "lights", "presets"][index]);
  };
  const media = (matches: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  it("stacks preview → lights → presets on a phone", async () => {
    media(true);
    render(<App />);
    await login();
    expect(order()).toEqual(["preview", "lights", "presets"]);
  });
  it("keeps lights in the right column on a desktop", async () => {
    media(false);
    render(<App />);
    await login();
    expect(order()).toEqual(["preview", "presets", "lights"]);
  });
});

describe("disabled reasons", () => {
  it("leaves the in-flight notice to the power status instead of the card label", async () => {
    let finish!: (record: CommandRecord) => void;
    vi.mocked(bridge.power).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    const user = await login();
    await user.click(screen.getByRole("button", { name: "關燈" }));
    expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
    expect(screen.queryByText("已停用：處理中")).not.toBeInTheDocument();
    // The progress sits beside the power button, not in a banner.
    const preview = screen.getByTestId("lamp-preview");
    expect(within(preview).getByText("處理中").parentElement).toHaveTextContent("處理中 · 正在送出「關燈」");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The button keeps its look, but a second press does not send again.
    const button = screen.getByRole("button", { name: "關燈" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.click(button);
    expect(bridge.power).toHaveBeenCalledTimes(1);
    finish(transmitted());
    expect(await within(preview).findByText("指令已送出")).toBeInTheDocument();
    expect(within(preview).queryByText(/請以實際燈光為準/)).not.toBeInTheDocument();
  });
  it("names the radio reason and the offline reason", async () => {
    vi.mocked(bridge.connect).mockResolvedValue({ ...snapshot, radio_status: "error" });
    vi.mocked(bridge.state).mockRejectedValue({ code: "NETWORK", message: "連線失敗" });
    render(<App />);
    const user = await login();
    expect(screen.getByText("已停用：無線模組未就緒")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("控制已暫停，模組就緒後即可操作。");
    await openDevice(user);
    await user.click(screen.getByRole("button", { name: "重新整理" }));
    await backToLights(user);
    expect(await screen.findByText("已停用：已斷線")).toBeInTheDocument();
    expect(screen.getByText(/^已斷線 · 重試中 · 最後同步 /)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("不會重送先前的操作。");
    expect(bridge.power).not.toHaveBeenCalled();
  });
});

const lastPublished = () => {
  const calls = vi.mocked(flyout.publish).mock.calls;
  return calls[calls.length - 1]?.[0];
};
describe("tray flyout intents", () => {
  it("use the same guarded command path and are refused while a command is in flight", async () => {
    let intent!: (payload: unknown) => Promise<void> | void;
    vi.mocked(flyout.onIntent).mockImplementation(async (handler) => {
      intent = handler as typeof intent;
      return () => {};
    });
    let finish!: (record: CommandRecord) => void;
    vi.mocked(bridge.power).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    await login();
    await waitFor(() => expect(intent).toBeDefined());
    let first!: Promise<void> | void;
    await waitFor(() => {
      first = intent({ id: "one", kind: "power", value: false });
    });
    await waitFor(() => expect(bridge.power).toHaveBeenCalledTimes(1));
    await intent({ id: "two", kind: "power", value: false });
    expect(flyout.ack).toHaveBeenCalledWith({ id: "two", done: false });
    finish(transmitted());
    await first;
    expect(flyout.ack).toHaveBeenCalledWith({ id: "one", done: true });
    expect(bridge.power).toHaveBeenCalledExactlyOnceWith(snapshot.device_id, false);
    await waitFor(() =>
      expect(lastPublished()).toMatchObject({
        connected: true,
        lock: null,
        status: { title: "指令已送出", body: "" },
      }),
    );
  });
  it("ignore flyout intents before a connection", async () => {
    let intent!: (payload: unknown) => Promise<void> | void;
    vi.mocked(flyout.onIntent).mockImplementation(async (handler) => {
      intent = handler as typeof intent;
      return () => {};
    });
    render(<App />);
    await waitFor(() => expect(intent).toBeDefined());
    await intent({ id: "one", kind: "power", value: true });
    expect(flyout.ack).toHaveBeenCalledWith({ id: "one", done: false });
    expect(bridge.power).not.toHaveBeenCalled();
    expect(lastPublished()).toMatchObject({ connected: false, lock: "offline" });
  });
});

describe("appearance", () => {
  it("applies and remembers the chosen theme, including the native title bar", async () => {
    window.localStorage.clear();
    render(<App />);
    const user = await login();
    expect(document.documentElement.dataset.theme).toBe("light");
    await openDevice(user);
    await user.click(screen.getByRole("tab", { name: /外觀/ }));
    await user.click(screen.getByRole("radio", { name: "深色" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("halodesk.theme")).toBe("dark");
    await waitFor(() => expect(bridge.windowTheme).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(lastPublished()).toMatchObject({ theme: "dark" }));
    expect(bridge.power).not.toHaveBeenCalled();
    expect(bridge.setState).not.toHaveBeenCalled();
    window.localStorage.clear();
  });
});

describe("language", () => {
  afterEach(() => window.localStorage.clear());
  it("switches every surface to English from settings and remembers the choice", async () => {
    render(<App />);
    const user = await login();
    await openDevice(user);
    await user.click(screen.getByRole("tab", { name: /外觀/ }));
    await user.click(screen.getByRole("radio", { name: "English" }));
    expect(window.localStorage.getItem("halodesk.locale")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("tab", { name: /Appearance/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lighting" }));
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument();
    expect(screen.getByLabelText("Front brightness")).toBeInTheDocument();
    expect(screen.getByText(/^Connected · synced /)).toBeInTheDocument();
    // The flyout gets the language with the rest of the published state.
    expect(lastPublished()).toMatchObject({ locale: "en" });
    expect(bridge.power).not.toHaveBeenCalled();
    expect(bridge.setState).not.toHaveBeenCalled();
  });
  it("shows native faults in English by their code", async () => {
    window.localStorage.setItem("halodesk.locale", "en");
    vi.mocked(bridge.connect).mockRejectedValue({ code: "UNAUTHORIZED", message: "帳號或密碼不正確。" });
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Username"), "test");
    await user.type(screen.getByLabelText("Password"), "bad");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Incorrect username or password."));
  });
});
