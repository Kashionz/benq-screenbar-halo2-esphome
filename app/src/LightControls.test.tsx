import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { LightControls } from "./LightControls";
import type { Snapshot } from "./bridge";
import type { Draft, LockReason } from "./controlState";
import examples from "../../protocol/v1/examples.json";
vi.mock("./PresetsPanel", () => ({ PresetsPanel: () => null }));
const state = examples.find((e) => e.schema === "Snapshot")!
  .body as unknown as Snapshot;
afterEach(cleanup);
function Harness({ snapshot, lock = null, apply = vi.fn(), power = vi.fn() }: {
  snapshot: Snapshot;
  lock?: LockReason | null;
  apply?: (patch: Draft) => void;
  power?: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft>({});
  return <LightControls snapshot={snapshot} draft={draft} setDraft={setDraft} lock={lock} power={power} apply={apply} />;
}
it("allows experimental fields without opt-in, blocks unsupported ones, and sends only edited fields", async () => {
  const apply = vi.fn();
  const snapshot = {
    ...state,
    features: { ...state.features, front_brightness: "experimental", back_brightness: "unsupported" },
  };
  const view = render(<Harness snapshot={snapshot} apply={apply} />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByLabelText("前燈亮度")).toBeEnabled();
  expect(screen.getByLabelText("後燈亮度")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("前燈亮度"), { target: { value: "25" } });
  fireEvent.change(screen.getByLabelText("前燈亮度"), { target: { value: "70" } });
  expect(apply).not.toHaveBeenCalled();
  view.rerender(
    <Harness
      snapshot={{
        ...snapshot,
        desired: {
          ...snapshot.desired,
          values: { ...snapshot.desired.values, temperature_k: 6500 },
        },
      }}
      apply={apply}
    />,
  );
  expect(screen.getByLabelText("前燈亮度")).toHaveValue("70");
  expect(screen.getByLabelText("色溫")).toHaveValue("6500");
  expect(screen.getByText("1 項變更尚未套用")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "套用燈光設定" }));
  expect(apply).toHaveBeenCalledExactlyOnceWith({ front_brightness: 70 });
});
it("drops a staged value that returns to the target", () => {
  render(<Harness snapshot={state} />);
  const front = screen.getByLabelText("前燈亮度");
  fireEvent.change(front, { target: { value: "40" } });
  expect(screen.getByText("1 項變更尚未套用")).toBeInTheDocument();
  fireEvent.change(front, { target: { value: String(state.desired.values.front_brightness) } });
  expect(screen.getByText("按套用才會送出")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "套用燈光設定" })).toBeDisabled();
});
it("disables every control and names the reason during an unknown command state", () => {
  const power = vi.fn();
  render(<Harness snapshot={state} lock="結果不明，請先查詢" power={power} />);
  expect(screen.getByRole("button", { name: "關燈" })).toBeDisabled();
  for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
  expect(screen.getByRole("button", { name: "套用燈光設定" })).toBeDisabled();
  expect(screen.getAllByText("已停用：結果不明，請先查詢")).toHaveLength(2);
  expect(power).not.toHaveBeenCalled();
});
it("power sends the explicit opposite of the target", async () => {
  const power = vi.fn();
  const view = render(<Harness snapshot={state} power={power} />);
  await userEvent.click(screen.getByRole("button", { name: "關燈" }));
  expect(power).toHaveBeenCalledExactlyOnceWith(false);
  view.rerender(
    <Harness
      snapshot={{ ...state, desired: { ...state.desired, values: { ...state.desired.values, power: false } } }}
      power={power}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "開燈" }));
  expect(power).toHaveBeenLastCalledWith(true);
  expect(power).toHaveBeenCalledTimes(2);
});
