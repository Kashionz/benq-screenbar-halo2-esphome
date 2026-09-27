import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    trayAvailable: vi.fn().mockResolvedValue(true),
    onTrayPower: vi.fn().mockResolvedValue(() => {}),
    presets: vi.fn().mockResolvedValue([]),
    connect: vi.fn(),
    disconnect: vi.fn(),
    state: vi.fn(),
    power: vi.fn(),
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
afterEach(cleanup);
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
  await screen.findByText("橋接器已連線");
  return user;
}
describe("control safety", () => {
  it("waits for an in-flight state read before sending one explicit command", async () => {
    let finishRead!: (value: Snapshot) => void;
    vi.mocked(bridge.state).mockImplementationOnce(
      () => new Promise((resolve) => { finishRead = resolve; }),
    );
    vi.mocked(bridge.power).mockResolvedValue({ status: "transmitted" } as CommandRecord);
    render(<App />);
    const user = await login();
    await user.click(screen.getByRole("button", { name: "重新整理" }));
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
    await user.click(screen.getByRole("button", { name: "重新整理" }));
    await user.click(screen.getByRole("button", { name: "關燈" }));
    failRead({ code: "NETWORK", message: "連線失敗" });
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
    await screen.findByText("橋接器已連線");
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
    await login();
    await screen.findByText(/本次已連線，但保存失敗/);
    expect(screen.getByRole("button", { name: "關燈" })).toBeEnabled();
  });
  it("disables power before connection", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /開燈/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
  });
  it("does not send a command when remote state is loaded", async () => {
    render(<App />);
    await login();
    expect(bridge.power).not.toHaveBeenCalled();
    expect(screen.getByText("原廠控制器最近操作")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /開燈/ })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
  });
  it("never labels unknown status as success", () => {
    expect(resultLabel({ status: "future_success" } as CommandRecord)).toBe(
      "結果不明",
    );
  });
});
