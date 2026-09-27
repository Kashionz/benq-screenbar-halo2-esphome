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
    connect: vi.fn(),
    disconnect: vi.fn(),
    state: vi.fn(),
    power: vi.fn(),
    lookup: vi.fn(),
  },
}));
const snapshot = examples.find((e) => e.schema === "Snapshot")!
  .body as unknown as Snapshot;
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
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
