import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { LightControls } from "./LightControls";
import type { Snapshot } from "./bridge";
import type { Draft } from "./controlState";
import examples from "../../protocol/v1/examples.json";
const presetValues = { mode: "back", front_brightness: 30, back_brightness: 20, temperature_k: 3925 };
vi.mock("./bridge", async (original) => ({
  ...(await original<typeof import("./bridge")>()),
  bridge: { presets: vi.fn(async () => [{ id: "1", name: "夜晚", values: presetValues }]) },
}));
afterEach(cleanup);
function Harness({ snapshot, apply }: { snapshot: Snapshot; apply: (patch: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>({});
  return <LightControls snapshot={snapshot} draft={draft} setDraft={setDraft} lock={null} power={vi.fn()} apply={apply} />;
}
it("stages only fields that differ from the target and requires explicit apply", async () => {
  const snapshot = examples.find((e) => e.schema === "Snapshot")!.body as unknown as Snapshot;
  const apply = vi.fn();
  const user = userEvent.setup();
  render(<Harness snapshot={snapshot} apply={apply} />);
  await user.click(await screen.findByRole("button", { name: "帶入情境 夜晚" }));
  expect(apply).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByLabelText("前燈亮度")).toHaveValue("30");
  expect(screen.getByLabelText("色溫")).toHaveValue("3925");
  expect(screen.getByRole("button", { name: "帶入情境 夜晚" })).toHaveClass("active");
  expect(screen.getByText("2 項變更尚未套用")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "套用燈光設定" }));
  // mode and temperature already match the target, so only brightness is sent.
  expect(apply).toHaveBeenCalledExactlyOnceWith({ front_brightness: 30, back_brightness: 20 });
});
