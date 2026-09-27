import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { PresetsPanel } from "./PresetsPanel";
import { bridge } from "./bridge";
vi.mock("./bridge", async (original) => ({
  ...(await original<typeof import("./bridge")>()),
  bridge: { presets: vi.fn(), savePreset: vi.fn(), deletePreset: vi.fn() },
}));
const values = { mode: "front", front_brightness: 35, back_brightness: 50, temperature_k: 5500 };
const preset = { id: "preset-id", name: "閱讀", values };
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(bridge.presets).mockResolvedValue([preset]); });
it("loads without selecting, saves lighting fields only, and explicitly stages a preset", async () => {
  const select = vi.fn();
  const user = userEvent.setup();
  vi.mocked(bridge.savePreset).mockResolvedValue([preset]);
  render(<PresetsPanel values={{ ...values, power: true } as typeof values} disabled={false} select={select} />);
  await user.click(screen.getByText("情境預設"));
  await screen.findByText("閱讀");
  expect(select).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("情境名稱"), " 工作 ");
  await user.click(screen.getByRole("button", { name: "保存為新情境" }));
  await waitFor(() => expect(bridge.savePreset).toHaveBeenCalledExactlyOnceWith("工作", values));
  expect(select).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "帶入情境 閱讀" }));
  expect(select).toHaveBeenCalledExactlyOnceWith(values);
});
it("prevents writes after a corrupt or unavailable store and respects offline state", async () => {
  vi.mocked(bridge.presets).mockRejectedValue({ code: "STORAGE_ERROR", message: "儲存資料無法讀取" });
  const view = render(<PresetsPanel values={values} disabled={false} select={vi.fn()} />);
  await userEvent.click(screen.getByText("情境預設"));
  await screen.findByText("儲存資料無法讀取");
  expect(screen.getByRole("button", { name: "保存為新情境" })).toBeDisabled();
  view.unmount();
  vi.mocked(bridge.presets).mockResolvedValue([preset]);
  render(<PresetsPanel values={values} disabled={true} select={vi.fn()} />);
  await userEvent.click(screen.getByText("情境預設"));
  expect(await screen.findByRole("button", { name: "帶入情境 閱讀" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "刪除情境 閱讀" })).toBeDisabled();
});
