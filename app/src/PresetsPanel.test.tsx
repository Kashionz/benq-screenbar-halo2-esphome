import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { PresetsPanel } from "./PresetsPanel";
import { bridge, type Preset } from "./bridge";
vi.mock("./bridge", async (original) => ({
  ...(await original<typeof import("./bridge")>()),
  bridge: { presets: vi.fn(), savePreset: vi.fn(), deletePreset: vi.fn(), restorePreset: vi.fn() },
}));
const values = { mode: "front", front_brightness: 35, back_brightness: 50, temperature_k: 5500 };
const preset: Preset = { id: "preset-id", name: "閱讀", values };
const night: Preset = {
  id: "night-id",
  name: "夜晚",
  values: { mode: "back", front_brightness: 30, back_brightness: 20, temperature_k: 3925 },
};
const named = (name: string, id = name): Preset => ({ id, name, values });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bridge.presets).mockResolvedValue([preset, night]);
});
it("loads without selecting and sends a preset's lighting values once, never power", async () => {
  const select = vi.fn();
  render(<PresetsPanel values={values} disabled={false} select={select} />);
  const tile = await screen.findByRole("button", { name: "帶入情境 夜晚" });
  expect(select).not.toHaveBeenCalled();
  expect(screen.getByText("· 2/4", { exact: false })).toBeInTheDocument();
  // The tile matching the shown values is marked; the summary sits in the title.
  expect(screen.getByRole("button", { name: "帶入情境 閱讀" })).toHaveAttribute("aria-pressed", "true");
  expect(tile).toHaveAttribute("title", "後燈 · 前 30% · 後 20% · 3925 K");
  expect(screen.getByText("3925 K · 30/20%")).toBeInTheDocument();
  await userEvent.click(tile);
  expect(select).toHaveBeenCalledExactlyOnceWith(night.values);
  expect(select.mock.calls[0][0]).not.toHaveProperty("power");
});
it("saves the shown lighting fields only, from the add panel, without sending anything", async () => {
  const select = vi.fn();
  const user = userEvent.setup();
  vi.mocked(bridge.savePreset).mockResolvedValue([preset, night, named("工作")]);
  render(<PresetsPanel values={{ ...values, power: true } as typeof values} disabled={false} select={select} />);
  await screen.findByRole("button", { name: "帶入情境 閱讀" });
  await user.click(screen.getByRole("button", { name: "＋ 新增" }));
  const panel = screen.getByRole("form", { name: "新增情境" });
  expect(panel).toHaveTextContent("前燈 · 前 35% · 後 50% · 5500 K");
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  await user.type(screen.getByLabelText("情境名稱"), " 工作 ");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(bridge.savePreset).toHaveBeenCalledExactlyOnceWith("工作", values));
  expect(screen.queryByRole("form", { name: "新增情境" })).not.toBeInTheDocument();
  expect(screen.getByText("· 3/4", { exact: false })).toBeInTheDocument();
  expect(select).not.toHaveBeenCalled();
});
it("closes the add panel on Escape and stops adding at four presets", async () => {
  const user = userEvent.setup();
  render(<PresetsPanel values={values} disabled={false} select={vi.fn()} />);
  await screen.findByRole("button", { name: "帶入情境 閱讀" });
  await user.click(screen.getByRole("button", { name: "＋ 新增" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("form", { name: "新增情境" })).not.toBeInTheDocument();
  cleanup();
  vi.mocked(bridge.presets).mockResolvedValue([named("a"), named("b"), named("c"), named("d")]);
  render(<PresetsPanel values={values} disabled={false} select={vi.fn()} />);
  await screen.findByText("· 4/4", { exact: false });
  const add = screen.getByRole("button", { name: "＋ 新增" });
  expect(add).toBeDisabled();
  expect(add).toHaveAttribute("title", "最多 4 組情境");
});
it("asks before deleting and restores the preset in place within six seconds", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  vi.mocked(bridge.deletePreset).mockResolvedValue([night]);
  vi.mocked(bridge.restorePreset).mockResolvedValue([preset, night]);
  render(<PresetsPanel values={values} disabled={false} select={vi.fn()} />);
  await screen.findByRole("button", { name: "帶入情境 閱讀" });
  await user.click(screen.getByRole("button", { name: "編輯" }));
  // Editing: tapping a tile applies nothing.
  expect(screen.getByRole("button", { name: "帶入情境 閱讀" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "刪除情境 閱讀" }));
  const dialog = screen.getByRole("dialog", { name: "刪除這個情境？" });
  expect(dialog).toHaveTextContent("前燈 · 前 35% · 後 50% · 5500 K");
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(bridge.deletePreset).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "刪除情境 閱讀" }));
  await user.click(screen.getByRole("button", { name: "刪除" }));
  await waitFor(() => expect(bridge.deletePreset).toHaveBeenCalledExactlyOnceWith("preset-id"));
  expect(await screen.findByText("已刪除「閱讀」")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "復原" }));
  await waitFor(() => expect(bridge.restorePreset).toHaveBeenCalledExactlyOnceWith(preset, 0));
  expect(await screen.findByRole("button", { name: "帶入情境 閱讀" })).toBeInTheDocument();
  expect(screen.queryByText("已刪除「閱讀」")).not.toBeInTheDocument();
  // A later delete offers undo only for six seconds.
  await user.click(screen.getByRole("button", { name: "刪除情境 閱讀" }));
  await user.click(screen.getByRole("button", { name: "刪除" }));
  await screen.findByText("已刪除「閱讀」");
  await act(async () => vi.advanceTimersByTime(6100));
  expect(screen.queryByRole("button", { name: "復原" })).not.toBeInTheDocument();
  expect(bridge.restorePreset).toHaveBeenCalledTimes(1);
});
it("leaves edit mode after the last preset is deleted and cancels delete on Escape", async () => {
  const user = userEvent.setup();
  vi.mocked(bridge.presets).mockResolvedValue([preset]);
  vi.mocked(bridge.deletePreset).mockResolvedValue([]);
  render(<PresetsPanel values={values} disabled={false} select={vi.fn()} />);
  await screen.findByRole("button", { name: "帶入情境 閱讀" });
  await user.click(screen.getByRole("button", { name: "編輯" }));
  await user.click(screen.getByRole("button", { name: "刪除情境 閱讀" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "刪除情境 閱讀" }));
  await user.click(screen.getByRole("button", { name: "刪除" }));
  await screen.findByText("已刪除「閱讀」");
  expect(screen.getByRole("button", { name: "編輯" })).toBeDisabled();
});
it("prevents writes after a corrupt or unavailable store and respects locked controls", async () => {
  vi.mocked(bridge.presets).mockRejectedValue({ code: "STORAGE_ERROR", message: "儲存資料無法讀取" });
  const view = render(<PresetsPanel values={values} disabled={false} select={vi.fn()} />);
  await screen.findByText("儲存資料無法讀取");
  expect(screen.getByRole("button", { name: "＋ 新增" })).toBeDisabled();
  view.unmount();
  vi.mocked(bridge.presets).mockResolvedValue([preset]);
  render(<PresetsPanel values={values} disabled={true} select={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "帶入情境 閱讀" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "＋ 新增" })).toBeDisabled();
});
