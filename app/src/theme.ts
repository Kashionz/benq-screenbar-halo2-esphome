import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export const THEME_LABELS: Record<ThemePref, string> = {
  light: "淺色",
  dark: "深色",
  system: "跟隨系統",
};

const KEY = "halodesk.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export const isThemePref = (value: unknown): value is ThemePref =>
  value === "light" || value === "dark" || value === "system";

/** The saved choice; storage may be unavailable, which falls back to light. */
export function loadTheme(): ThemePref {
  try {
    const value = window.localStorage.getItem(KEY);
    return isThemePref(value) ? value : "light";
  } catch {
    return "light";
  }
}

export function saveTheme(pref: ThemePref) {
  try {
    window.localStorage.setItem(KEY, pref);
  } catch {
    /* The choice still applies for this session. */
  }
}

const darkQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY)
    : null;

/** Resolve 「跟隨系統」 through prefers-color-scheme and follow its changes. */
export function useResolvedTheme(pref: ThemePref): Theme {
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? false);
  useEffect(() => {
    if (pref !== "system") return;
    const media = darkQuery();
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [pref]);
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

/** Set the saved theme before the first render so a dark window does not flash light. */
export function applySavedTheme() {
  const pref = loadTheme();
  const dark = pref === "dark" || (pref === "system" && (darkQuery()?.matches ?? false));
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** Apply the resolved theme to this window's document. */
export function useDocumentTheme(theme: Theme) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}
