import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { DiscoveryPanel } from "./DiscoveryPanel";
import { bridge, type DiscoveredBridge } from "./bridge";
vi.mock("./bridge", async (original) => ({
  ...(await original<typeof import("./bridge")>()),
  bridge: { discover: vi.fn() },
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("keeps empty results and permission errors actionable with manual fallback", async () => {
  vi.mocked(bridge.discover).mockResolvedValueOnce([]).mockRejectedValueOnce({ code: "DISCOVERY_PERMISSION", message: "請允許區域網路權限" });
  render(<DiscoveryPanel disabled={false} platform="windows" select={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button"));
  await screen.findByText("找不到橋接器，可直接輸入 IP。 若曾拒絕防火牆提示，請到「Windows 安全性」允許。");
  await user.click(screen.getByRole("button"));
  await screen.findByText("請允許區域網路權限");
});
it("does not duplicate a scan or select late results after leaving", async () => {
  let finish!: (results: DiscoveredBridge[]) => void;
  vi.mocked(bridge.discover).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const select = vi.fn();
  const view = render(<DiscoveryPanel disabled={false} platform="windows" select={select} />);
  await userEvent.dblClick(screen.getByRole("button"));
  expect(bridge.discover).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button")).toBeDisabled();
  view.unmount();
  await act(async () => finish([{ name: "Desk", host: "desk.local", port: 8080 }]));
  expect(select).not.toHaveBeenCalled();
});
it("reports searching, shows a spinner label and marks the chosen address", async () => {
  let finish!: (results: DiscoveredBridge[]) => void;
  vi.mocked(bridge.discover).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const onSearching = vi.fn();
  const select = vi.fn();
  const view = render(<DiscoveryPanel disabled={false} platform="macos" select={select} onSearching={onSearching} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "搜尋區域網路" }));
  expect(screen.getByRole("button", { name: "搜尋中…約 5 秒" })).toBeDisabled();
  expect(onSearching).toHaveBeenLastCalledWith(true);
  await act(async () => finish([{ name: "Desk", host: "desk.local", port: 8080 }]));
  expect(onSearching).toHaveBeenLastCalledWith(false);
  const result = screen.getByRole("button", { name: "選取 Desk desk.local:8080" });
  expect(result).toHaveAttribute("aria-pressed", "false");
  await user.click(result);
  expect(select).toHaveBeenCalledExactlyOnceWith({ name: "Desk", host: "desk.local", port: 8080 });
  expect(screen.getByText("已填入，請輸入密碼。")).toBeInTheDocument();
  view.rerender(<DiscoveryPanel disabled={false} platform="macos" current="desk.local:8080" select={select} />);
  expect(screen.getByRole("button", { name: "選取 Desk desk.local:8080" })).toHaveAttribute("aria-pressed", "true");
});
