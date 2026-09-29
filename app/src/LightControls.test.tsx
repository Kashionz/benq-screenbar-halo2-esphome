import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { LightControls, type SettingKey } from "./LightControls";
import { LampPreview } from "./LampPreview";
import type { Snapshot } from "./bridge";
import type { Feedback, LockReason } from "./controlState";
import examples from "../../protocol/v1/examples.json";
const state = examples.find((e) => e.schema === "Snapshot")!
  .body as unknown as Snapshot;
afterEach(cleanup);
function view(options: {
  snapshot?: Snapshot;
  lock?: LockReason | null;
  values?: Partial<Snapshot["desired"]["values"]>;
  settingPending?: SettingKey | null;
  progressShown?: boolean;
} = {}) {
  const snapshot = options.snapshot ?? state;
  const adjust = vi.fn();
  const onSetting = vi.fn();
  render(
    <LightControls
      snapshot={snapshot}
      values={{ ...snapshot.desired.values, ...options.values }}
      lock={options.lock ?? null}
      adjust={adjust}
      settingPending={options.settingPending}
      progressShown={options.progressShown}
      onSetting={onSetting}
    />,
  );
  return { adjust, onSetting };
}
const withSetting = (key: SettingKey, on: boolean, feature = "experimental"): Snapshot => ({
  ...state,
  desired: { ...state.desired, values: { ...state.desired.values, [key]: on } },
  features: { ...state.features, [key]: feature },
});
const withSensing = (on: boolean, feature?: string) => withSetting("ultrasonic_enabled", on, feature);
function preview(options: {
  power?: boolean;
  lock?: LockReason | null;
  powerPending?: boolean;
  status?: Feedback | null;
} = {}) {
  const onPower = vi.fn();
  render(
    <LampPreview
      power={options.power ?? true}
      preview={state.desired.values}
      online={true}
      lock={options.lock ?? null}
      powerPending={options.powerPending ?? false}
      status={options.status ?? null}
      onPower={onPower}
    />,
  );
  return { onPower };
}
it("sends each slider and mode change live, allows experimental and blocks unsupported fields", async () => {
  const { adjust } = view({
    snapshot: { ...state, features: { ...state.features, front_brightness: "experimental", back_brightness: "unsupported" } },
    values: { mode: "both" },
  });
  expect(screen.queryByRole("button", { name: "套用燈光設定" })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByLabelText("後燈亮度")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("前燈亮度"), { target: { value: "70" } });
  expect(adjust).toHaveBeenLastCalledWith({ front_brightness: 70 });
  await userEvent.click(screen.getByRole("radio", { name: "前後燈" }));
  expect(adjust).toHaveBeenLastCalledWith({ mode: "both" });
  expect(adjust).toHaveBeenCalledTimes(2);
});
it("only lets the lamps the shown mode lights be adjusted", () => {
  view({ values: { mode: "front" } });
  expect(screen.getByLabelText("前燈亮度")).toBeEnabled();
  expect(screen.getByLabelText("後燈亮度")).toBeDisabled();
  expect(screen.getByLabelText("色溫")).toBeEnabled();
  cleanup();
  view({ values: { mode: "back" } });
  expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
  expect(screen.getByLabelText("後燈亮度")).toBeEnabled();
  cleanup();
  view({ values: { mode: "both" } });
  expect(screen.getByLabelText("前燈亮度")).toBeEnabled();
  expect(screen.getByLabelText("後燈亮度")).toBeEnabled();
});
it("shows adjusted values without a separate target marker", () => {
  view({ values: { mode: "both", front_brightness: 70 } });
  expect(screen.getByLabelText("前燈亮度")).toHaveValue("70");
  expect(screen.getByText("70%")).toBeInTheDocument();
  expect(screen.queryByTitle("目前目標")).not.toBeInTheDocument();
});
it("disables every control and names the reason during an unknown command state", () => {
  const { adjust } = view({ lock: "結果不明，請先查詢" });
  for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
  expect(screen.getByRole("switch", { name: /入席感應/ })).toBeDisabled();
  expect(screen.getByText("已停用：結果不明，請先查詢")).toBeInTheDocument();
  expect(adjust).not.toHaveBeenCalled();
});
it("presence switch sends the explicit opposite of the target and marks it experimental", async () => {
  const off = view({ snapshot: withSensing(false) });
  const button = screen.getByRole("switch", { name: /入席感應/ });
  expect(button).toHaveAttribute("aria-checked", "false");
  expect(within(button).getByText("實驗性")).toBeInTheDocument();
  await userEvent.click(button);
  expect(off.onSetting).toHaveBeenCalledExactlyOnceWith("ultrasonic_enabled", true);
  expect(off.adjust).not.toHaveBeenCalled();
  cleanup();
  const on = view({ snapshot: withSensing(true, "verified") });
  expect(within(screen.getByRole("switch", { name: /入席感應/ })).queryByText("實驗性")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("switch", { name: /入席感應/ }));
  expect(on.onSetting).toHaveBeenCalledExactlyOnceWith("ultrasonic_enabled", false);
});
it("auto-dimming switch sends explicit values and says brightness changes end it", async () => {
  const off = view({ snapshot: withSetting("auto_dimming", false) });
  const button = screen.getByRole("switch", { name: /自動調光/ });
  expect(button).toHaveAttribute("aria-checked", "false");
  expect(button).toHaveAccessibleDescription("掛燈依環境光自動調整亮度");
  await userEvent.click(button);
  expect(off.onSetting).toHaveBeenCalledExactlyOnceWith("auto_dimming", true);
  cleanup();
  const on = view({ snapshot: withSetting("auto_dimming", true) });
  expect(screen.getByRole("switch", { name: /自動調光/ })).toHaveAccessibleDescription(
    "亮度由掛燈依環境光決定，手動調整亮度會關閉",
  );
  await userEvent.click(screen.getByRole("switch", { name: /自動調光/ }));
  expect(on.onSetting).toHaveBeenCalledExactlyOnceWith("auto_dimming", false);
});
it("hides auto-dimming on firmware that does not report it", () => {
  const { auto_dimming: _flag, ...features } = state.features;
  const { auto_dimming: _value, ...values } = state.desired.values;
  view({ snapshot: { ...state, features, desired: { ...state.desired, values } } });
  expect(screen.queryByRole("switch", { name: /自動調光/ })).not.toBeInTheDocument();
  expect(screen.getByRole("switch", { name: /入席感應/ })).toBeInTheDocument();
});
it("presence switch is disabled when unsupported and shows its pending command", () => {
  view({ snapshot: withSensing(false, "unsupported") });
  expect(screen.getByRole("switch", { name: /入席感應/ })).toBeDisabled();
  cleanup();
  view({ snapshot: withSensing(false), lock: "處理中", settingPending: "ultrasonic_enabled", progressShown: true });
  expect(screen.getByRole("switch", { name: /入席感應/ })).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("正在送出…")).toBeInTheDocument();
  expect(screen.queryByText(/^已停用/)).not.toBeInTheDocument();
});
it("power sends the explicit opposite of the target", async () => {
  const { onPower } = preview();
  const off = screen.getByRole("button", { name: "關燈" });
  expect(off).toHaveAttribute("title", "關燈");
  expect(screen.getByText("按一下關燈")).toBeInTheDocument();
  await userEvent.click(off);
  expect(onPower).toHaveBeenCalledExactlyOnceWith(false);
  cleanup();
  const on = preview({ power: false });
  expect(screen.getByText("燈已關閉")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "開燈" }));
  expect(on.onPower).toHaveBeenCalledExactlyOnceWith(true);
});
it("keeps the power button's look while its own command is in flight but ignores presses", async () => {
  const { onPower } = preview({
    lock: "處理中",
    powerPending: true,
    status: { tone: "busy", title: "處理中", body: "正在送出「關燈」", lookup: false },
  });
  const button = screen.getByRole("button", { name: "關燈" });
  expect(button).toBeEnabled();
  expect(button).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByText("處理中")).toBeInTheDocument();
  expect(screen.getByText("· 正在送出「關燈」", { exact: false })).toBeInTheDocument();
  await userEvent.click(button);
  expect(onPower).not.toHaveBeenCalled();
});
it("disables power while locked for another reason", () => {
  preview({ lock: "結果不明，請先查詢", status: { tone: "warn", title: "結果不明", body: "請先查詢，不要重送。", lookup: true } });
  expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
  expect(screen.getByText("結果不明")).toBeInTheDocument();
});
it("draws the target sketch with lit paths only", () => {
  preview();
  const values = state.desired.values;
  const front = values.mode !== "back" ? `前 ${values.front_brightness}%` : "前 —";
  const back = values.mode !== "front" ? `後 ${values.back_brightness}%` : "後 —";
  expect(screen.getByText(front)).toBeInTheDocument();
  expect(screen.getByText(back)).toBeInTheDocument();
  expect(screen.getByText("目標示意")).toBeInTheDocument();
});
