import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { LightControls } from "./LightControls";
import type { Snapshot } from "./bridge";
import examples from "../../protocol/v1/examples.json";
const state = examples.find((e) => e.schema === "Snapshot")!
  .body as unknown as Snapshot;
afterEach(cleanup);
it("requires experimental opt-in and sends only edited fields on apply", async () => {
  const send = vi.fn().mockResolvedValue(true);
  const snapshot = {
    ...state,
    features: { ...state.features, front_brightness: "experimental" },
  };
  const view = render(
    <LightControls snapshot={snapshot} disabled={false} send={send} />,
  );
  expect(screen.getByLabelText("前燈亮度")).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("前燈亮度"), {
    target: { value: "25" },
  });
  fireEvent.change(screen.getByLabelText("前燈亮度"), {
    target: { value: "70" },
  });
  expect(send).not.toHaveBeenCalled();
  view.rerender(
    <LightControls
      snapshot={{
        ...snapshot,
        desired: {
          ...snapshot.desired,
          values: { ...snapshot.desired.values, temperature_k: 6500 },
        },
      }}
      disabled={false}
      send={send}
    />,
  );
  expect(screen.getByLabelText("前燈亮度")).toHaveValue("70");
  expect(screen.getByLabelText("色溫")).toHaveValue("6500");
  await userEvent.click(screen.getByRole("button", { name: "套用燈光設定" }));
  expect(send).toHaveBeenCalledExactlyOnceWith({ front_brightness: 70 }, true);
});
it("disables controls during unavailable or unknown command state", () => {
  render(<LightControls snapshot={state} disabled={true} send={vi.fn()} />);
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByLabelText("照明模式")).toBeDisabled();
  expect(screen.getByRole("button", { name: "套用燈光設定" })).toBeDisabled();
});
