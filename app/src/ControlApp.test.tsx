import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import App from "./ControlApp";
import {
  bridge,
  resultLabel,
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
  bridge: {
    discover: vi.fn(),
    trayAvailable: vi.fn().mockResolvedValue(true),
    onTrayPower: vi.fn().mockResolvedValue(() => {}),
    presets: vi.fn().mockResolvedValue([]),
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
});
async function login() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("帳號"), "test");
  await user.type(screen.getByLabelText("密碼"), "secret");
  await user.click(screen.getByRole("button", { name: "連線橋接器 →" }));
  await screen.findByText("已連線");
  return user;
}
const openDevice = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "裝置與診斷 ›" }));
const backToLights = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "‹ 燈光" }));
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
    expect(screen.getByRole("alert")).toHaveTextContent("橋接器已重新開機");
    expect(bridge.power).toHaveBeenCalledTimes(1);
  });
  it("selects discovered addresses without login or RF and clears the entered password", async () => {
    vi.mocked(bridge.discover).mockResolvedValue([{ name: "Desk", host: "desk.local", port: 8080 }]);
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("密碼"), "previous-secret");
    expect(bridge.discover).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "搜尋區域網路橋接器" }));
    await user.click(await screen.findByRole("button", { name: /Desk desk.local:8080/ }));
    expect(screen.getByLabelText("IP 或主機名稱")).toHaveValue("desk.local");
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
    await waitFor(() => expect(screen.getByRole("button", { name: "中斷連線／更換裝置" })).toBeEnabled());
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
    await screen.findByText("已連線");
    expect(bridge.connectSaved).toHaveBeenCalledTimes(1);
    expect(bridge.power).not.toHaveBeenCalled();
  });
  it("keeps a successful session usable when secure saving fails", async () => {
    vi.mocked(bridge.remember).mockRejectedValue({
      code: "CREDENTIAL_STORE",
      message: "憑證庫不可用",
    });
    render(<App />);
    await userEvent.click(screen.getByLabelText("記住此連線與帳密"));
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
    expect(screen.getByText(/原廠控制器：/)).toBeInTheDocument();
  });
  it("unknown outcome disables new commands and offers lookup", async () => {
    vi.mocked(bridge.power).mockRejectedValue({
      code: "UNKNOWN_OUTCOME",
      message: "結果不明",
    });
    render(<App />);
    const user = await login();
    await user.click(screen.getByRole("button", { name: "關燈" }));
    const lookups = await screen.findAllByRole("button", { name: "查詢命令結果" });
    expect(lookups).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("請先查詢「關燈」的結果。");
    expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "套用燈光設定" })).toBeDisabled();
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
    await user.click(screen.getByRole("button", { name: "連線橋接器 →" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("帳號或密碼不正確"),
    );
    expect(screen.queryByText("已連線")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /開燈|關燈/ })).not.toBeInTheDocument();
  });
  it("never labels unknown status as success", () => {
    expect(resultLabel({ status: "future_success" } as CommandRecord)).toBe(
      "結果不明",
    );
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
    expect(screen.getByText("按一下開燈")).toBeInTheDocument();
    await user.click(on);
    await waitFor(() => expect(bridge.power).toHaveBeenCalledTimes(2));
    expect(bridge.power).toHaveBeenLastCalledWith(snapshot.device_id, true);
    expect(bridge.setState).not.toHaveBeenCalled();
  });
});

describe("lamp preview", () => {
  it("shows the draft as a preview without sending, while power follows desired", async () => {
    render(<App />);
    const user = await login();
    const preview = screen.getByTestId("lamp-preview");
    expect(within(preview).getByText("目標示意")).toBeInTheDocument();
    expect(within(preview).getByText("前 —")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "前後燈" }));
    fireEvent.change(screen.getByLabelText("前燈亮度"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("色溫"), { target: { value: "5000" } });
    expect(within(preview).getByText("預覽 · 尚未套用")).toBeInTheDocument();
    expect(within(preview).getByText("前 70%")).toBeInTheDocument();
    expect(within(preview).getByText("5000 K")).toBeInTheDocument();
    expect(screen.getByText("3 項變更尚未套用")).toBeInTheDocument();
    expect(bridge.setState).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "取消調整" }));
    expect(within(preview).getByText("目標示意")).toBeInTheDocument();
  });
  it("keeps beams dark while desired power is off even with a draft", async () => {
    vi.mocked(bridge.connect).mockResolvedValue(withDesired({ power: false }));
    vi.mocked(bridge.state).mockResolvedValue(withDesired({ power: false }));
    render(<App />);
    const user = await login();
    await user.click(screen.getByRole("radio", { name: "前後燈" }));
    const preview = screen.getByTestId("lamp-preview");
    expect(within(preview).getByText("預覽 · 尚未套用")).toBeInTheDocument();
    expect(within(preview).getByText("前 —")).toBeInTheDocument();
    expect(within(preview).getByText("後 —")).toBeInTheDocument();
  });
  it("sends only the drafted fields on apply and clears the draft after transmission", async () => {
    vi.mocked(bridge.setState).mockResolvedValue(transmitted("apply-1"));
    render(<App />);
    const user = await login();
    fireEvent.change(screen.getByLabelText("前燈亮度"), { target: { value: "70" } });
    await user.click(screen.getByRole("button", { name: "套用燈光設定" }));
    await waitFor(() => expect(bridge.setState).toHaveBeenCalledTimes(1));
    expect(bridge.setState).toHaveBeenCalledWith(snapshot.device_id, { front_brightness: 70 });
    await screen.findByText("按套用才會送出");
    expect(bridge.power).not.toHaveBeenCalled();
  });
});

describe("responsive order", () => {
  const order = () => {
    const nodes = [
      screen.getByTestId("lamp-preview"),
      screen.getByRole("region", { name: "燈光" }),
      screen.getByRole("region", { name: "目標" }),
      screen.getByRole("region", { name: "最近命令" }),
    ];
    return nodes
      .map((node, index) => ({ node, index }))
      .sort((a, b) => (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map(({ index }) => ["preview", "lights", "target", "recent"][index]);
  };
  const media = (matches: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  it("stacks preview → lights → target → recent command on a phone", async () => {
    media(true);
    render(<App />);
    await login();
    expect(order()).toEqual(["preview", "lights", "target", "recent"]);
  });
  it("keeps lights in the right column on a desktop", async () => {
    media(false);
    render(<App />);
    await login();
    expect(order()).toEqual(["preview", "target", "recent", "lights"]);
  });
});

describe("disabled reasons", () => {
  it("names the reason while a command is in flight", async () => {
    let finish!: (record: CommandRecord) => void;
    vi.mocked(bridge.power).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    const user = await login();
    await user.click(screen.getByRole("button", { name: "關燈" }));
    expect(screen.getAllByText("已停用：處理中")).toHaveLength(2);
    expect(screen.getByText("正在送出「關燈」")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
    finish(transmitted());
    await screen.findByText("指令已送出");
  });
  it("names the radio reason and the offline reason", async () => {
    vi.mocked(bridge.connect).mockResolvedValue({ ...snapshot, radio_status: "error" });
    vi.mocked(bridge.state).mockRejectedValue({ code: "NETWORK", message: "連線失敗" });
    render(<App />);
    const user = await login();
    expect(screen.getAllByText("已停用：無線模組未就緒")).toHaveLength(2);
    await openDevice(user);
    await user.click(screen.getByRole("button", { name: "重新整理" }));
    await backToLights(user);
    expect(await screen.findAllByText("已停用：已斷線")).toHaveLength(2);
    expect(screen.getByText("已斷線 · 重試中")).toBeInTheDocument();
    expect(screen.getByText(/最後已知目標/)).toBeInTheDocument();
    expect(bridge.power).not.toHaveBeenCalled();
  });
});
