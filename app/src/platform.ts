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
