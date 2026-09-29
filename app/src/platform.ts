export type Platform = "windows" | "macos" | "ios" | "other";

export function detectPlatform(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
  touchPoints = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
): Platform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  // iPadOS reports a Mac user agent; touch support tells them apart.
  if (/Macintosh|Mac OS X/.test(userAgent)) return touchPoints > 1 ? "ios" : "macos";
  if (/Windows/.test(userAgent)) return "windows";
  return "other";
}

export const CREDENTIAL_STORE: Record<Platform, string> = {
  windows: "Windows 認證管理員",
  macos: "macOS 鑰匙圈",
  ios: "iOS 鑰匙圈",
  other: "系統憑證庫",
};

export const DISCOVERY_HINT: Record<Platform, string> = {
  windows: "若曾拒絕防火牆提示，請到「Windows 安全性」允許。",
  macos: "請確認未開 VPN。",
  ios: "請在「設定」→「隱私權」→「區域網路」允許。",
  other: "",
};
