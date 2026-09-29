import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ConnectPage } from "./ConnectPage";
import { bridge, type DiscoveredBridge } from "./bridge";
import { detectPlatform } from "./platform";
vi.mock("./bridge", async (original) => ({
  ...(await original<typeof import("./bridge")>()),
  bridge: { discover: vi.fn() },
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const fields = { host: "screenbar-halo2.local", port: 8080, username: "", password: "" };
const saved = { host: "192.168.1.42", port: 8080, username: "admin", device_id: "d" };
function page(overrides: Partial<Parameters<typeof ConnectPage>[0]> = {}) {
  const props: Parameters<typeof ConnectPage>[0] = {
    native: true,
    platform: "windows",
    busy: false,
    fields,
    edit: vi.fn(),
    remember: false,
    setRemember: vi.fn(),
    saved: null,
    fault: null,
    settingsMessage: "",
    retryForget: false,
    submit: vi.fn((e) => e.preventDefault()),
    useSaved: vi.fn(),
    forget: vi.fn(),
    pick: vi.fn(),
    ...overrides,
  };
  return { props, view: render(<ConnectPage {...props} />) };
}
it("names the platform credential store and shows the saved profile without connecting", () => {
  const { props, view } = page({ saved, platform: "macos" });
  expect(screen.getByRole("heading", { name: "連接掛燈" })).toBeInTheDocument();
  expect(screen.queryByText(/登入後即可控制/)).not.toBeInTheDocument();
  expect(screen.getByText("192.168.1.42:8080")).toBeInTheDocument();
  const remember = screen.getByRole("switch", { name: "記住此連線與帳密" });
  expect(remember).toHaveAccessibleDescription("密碼存於 macOS 鑰匙圈。");
  expect(props.useSaved).not.toHaveBeenCalled();
  view.rerender(<ConnectPage {...props} platform="ios" />);
  expect(remember).toHaveAccessibleDescription("密碼存於 iOS 鑰匙圈。");
  view.rerender(<ConnectPage {...props} platform="windows" />);
  expect(remember).toHaveAccessibleDescription("密碼存於 Windows 認證管理員。");
});
it("disables connecting while a search runs", async () => {
  let finish!: (results: DiscoveredBridge[]) => void;
  vi.mocked(bridge.discover).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  page({ saved });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "搜尋區域網路" }));
  expect(screen.getByRole("button", { name: "連線" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "使用已保存帳密連線" })).toBeDisabled();
  expect(screen.getByLabelText("主機")).toBeEnabled();
  await act(async () => finish([]));
  expect(screen.getByRole("button", { name: "連線" })).toBeEnabled();
});
it("disables the form and search while connecting", () => {
  page({ busy: true, saved });
  expect(screen.getByRole("button", { name: "連線中…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "搜尋區域網路" })).toBeDisabled();
  for (const label of ["主機", "連接埠", "帳號", "密碼"]) expect(screen.getByLabelText(label)).toBeDisabled();
  expect(screen.getByRole("switch", { name: "記住此連線與帳密" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "使用已保存帳密連線" })).toBeDisabled();
});
it("toggles remember as a switch and submits only on the connect button", async () => {
  const { props } = page({ fields: { ...fields, username: "u", password: "p" } });
  const user = userEvent.setup();
  const toggle = screen.getByRole("switch", { name: "記住此連線與帳密" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  await user.click(toggle);
  expect(props.setRemember).toHaveBeenCalledExactlyOnceWith(true);
  expect(props.submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "連線" }));
  expect(props.submit).toHaveBeenCalledOnce();
});
it("detects the platform for credential and discovery copy", () => {
  expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0)).toBe("windows");
  expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", 0)).toBe("macos");
  expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", 5)).toBe("ios");
  expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe("ios");
  expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)", 0)).toBe("other");
});
