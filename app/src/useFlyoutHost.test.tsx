import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useFlyoutHost, type FlyoutHandlers } from "./useFlyoutHost";
import { flyout } from "./bridge";
import type { FlyoutState } from "./flyout";
vi.mock("./bridge", () => ({
  flyout: { publish: vi.fn(), ack: vi.fn(), onIntent: vi.fn(), onShown: vi.fn() },
}));
const state: FlyoutState = {
  connected: true,
  online: true,
  badge: { tone: "ok", text: "已連線" },
  lock: null,
  desired: null,
  features: {},
  feedback: { tone: "idle", title: "就緒", body: "", lookup: false },
  updated: "",
};
let intent!: (payload: unknown) => Promise<void> | void;
let shown!: () => void;
const stopIntent = vi.fn();
const stopShown = vi.fn();
beforeEach(() => {
  vi.mocked(flyout.publish).mockResolvedValue();
  vi.mocked(flyout.ack).mockResolvedValue();
  vi.mocked(flyout.onIntent).mockImplementation(async (handler) => {
    intent = handler as typeof intent;
    return stopIntent;
  });
  vi.mocked(flyout.onShown).mockImplementation(async (handler) => {
    shown = handler;
    return stopShown;
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const handlers = (overrides: Partial<FlyoutHandlers> = {}): FlyoutHandlers => ({
  lock: null,
  power: vi.fn(async () => true),
  apply: vi.fn(async () => true),
  sync: vi.fn(),
  ...overrides,
});
it("publishes state changes and answers sync without commands", async () => {
  const h = handlers();
  const view = renderHook(({ s }) => useFlyoutHost(true, s, h), { initialProps: { s: state } });
  await waitFor(() => expect(flyout.onIntent).toHaveBeenCalled());
  expect(flyout.publish).toHaveBeenCalledTimes(1);
  view.rerender({ s: state });
  expect(flyout.publish).toHaveBeenCalledTimes(1);
  view.rerender({ s: { ...state, updated: "21:00:00" } });
  expect(flyout.publish).toHaveBeenLastCalledWith({ ...state, updated: "21:00:00" });
  await act(async () => intent({ id: "s", kind: "sync" }));
  expect(flyout.publish).toHaveBeenCalledTimes(3);
  expect(h.power).not.toHaveBeenCalled();
  expect(flyout.ack).not.toHaveBeenCalled();
});
it("runs one explicit power command per intent and acknowledges the outcome", async () => {
  const h = handlers({ power: vi.fn(async () => false) });
  renderHook(() => useFlyoutHost(true, state, h));
  await waitFor(() => expect(flyout.onIntent).toHaveBeenCalled());
  await act(async () => intent({ id: "p", kind: "power", value: false }));
  expect(h.power).toHaveBeenCalledExactlyOnceWith(false);
  expect(flyout.ack).toHaveBeenCalledExactlyOnceWith({ id: "p", done: false });
});
it("refuses intents while locked and ignores malformed ones", async () => {
  const h = handlers({ lock: "結果不明，請先查詢" });
  renderHook(() => useFlyoutHost(true, { ...state, lock: "結果不明，請先查詢" }, h));
  await waitFor(() => expect(flyout.onIntent).toHaveBeenCalled());
  await act(async () => intent({ id: "p", kind: "power", value: true }));
  await act(async () => intent({ id: "a", kind: "apply", patch: { front_brightness: 40 } }));
  await act(async () => intent({ id: "t", kind: "toggle" }));
  await act(async () => intent({ id: "x", kind: "apply", patch: { power: true } }));
  expect(h.power).not.toHaveBeenCalled();
  expect(h.apply).not.toHaveBeenCalled();
  expect(flyout.ack).toHaveBeenCalledTimes(2);
  expect(flyout.ack).toHaveBeenCalledWith({ id: "p", done: false });
  expect(flyout.ack).toHaveBeenCalledWith({ id: "a", done: false });
});
it("passes validated patches, resyncs on open and removes listeners", async () => {
  const h = handlers();
  const view = renderHook(() => useFlyoutHost(true, state, h));
  await waitFor(() => expect(flyout.onShown).toHaveBeenCalled());
  await act(async () => intent({ id: "a", kind: "apply", patch: { front_brightness: 40, mode: "both" } }));
  expect(h.apply).toHaveBeenCalledExactlyOnceWith({ front_brightness: 40, mode: "both" });
  expect(flyout.ack).toHaveBeenCalledWith({ id: "a", done: true });
  act(() => shown());
  expect(h.sync).toHaveBeenCalledOnce();
  view.unmount();
  expect(stopIntent).toHaveBeenCalledOnce();
  expect(stopShown).toHaveBeenCalledOnce();
});
it("does nothing outside the native App", () => {
  renderHook(() => useFlyoutHost(false, state, handlers()));
  expect(flyout.publish).not.toHaveBeenCalled();
  expect(flyout.onIntent).not.toHaveBeenCalled();
});
