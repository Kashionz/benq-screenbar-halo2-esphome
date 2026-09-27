import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { LightControls } from "./LightControls";
import type { Snapshot } from "./bridge";
import examples from "../../protocol/v1/examples.json";
const presetValues = { mode: "back", front_brightness: 30, back_brightness: 20, temperature_k: 3925 };
vi.mock("./bridge", async (original) => ({
  ...(await original<typeof import("./bridge")>()),
  bridge: { presets: vi.fn(async () => [{ id: "1", name: "夜晚", values: presetValues }]) },
}));
afterEach(cleanup);
it("stages without transmitting and requires capability opt-in and explicit apply", async () => {
  const base = examples.find((e) => e.schema === "Snapshot")!.body as unknown as Snapshot;
  const snapshot = { ...base, features: { ...base.features, mode: "experimental", front_brightness: "experimental", back_brightness: "experimental", temperature_k: "experimental" } };
  const send = vi.fn().mockResolvedValue(true);
  const user = userEvent.setup();
  render(<LightControls snapshot={snapshot} disabled={false} send={send} />);
  await user.click(screen.getByText("情境預設"));
  await user.click(await screen.findByRole("button", { name: "帶入情境 夜晚" }));
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "套用燈光設定" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "帶入情境 夜晚" }));
  expect(screen.getByLabelText("色溫")).toHaveValue("3925");
  expect(send).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "套用燈光設定" }));
  expect(send).toHaveBeenCalledExactlyOnceWith(presetValues, true);
});
