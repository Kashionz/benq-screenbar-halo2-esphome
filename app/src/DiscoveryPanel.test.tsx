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
  render(<DiscoveryPanel disabled={false} select={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button"));
  await screen.findByText(/未找到橋接器/);
  await user.click(screen.getByRole("button"));
  await screen.findByText("請允許區域網路權限");
});
it("does not duplicate a scan or select late results after leaving", async () => {
  let finish!: (results: DiscoveredBridge[]) => void;
  vi.mocked(bridge.discover).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const select = vi.fn();
  const view = render(<DiscoveryPanel disabled={false} select={select} />);
  await userEvent.dblClick(screen.getByRole("button"));
  expect(bridge.discover).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button")).toBeDisabled();
  view.unmount();
  await act(async () => finish([{ name: "Desk", host: "desk.local", port: 8080 }]));
  expect(select).not.toHaveBeenCalled();
});
