import { createContext, useContext, useEffect } from "react";
import type { Fault } from "./bridge";
import type { Platform } from "./platform";
import type { ThemePref } from "./theme";

export type Locale = "zh-TW" | "en";
export type LocalePref = Locale | "system";
/** Text that is resolved when it is shown, so it follows a language change. */
export type Text = (m: Messages) => string;

const KEY = "halodesk.locale";

export const isLocalePref = (value: unknown): value is LocalePref =>
  value === "zh-TW" || value === "en" || value === "system";

/** The saved choice; storage may be unavailable, which falls back to the system language. */
export function loadLocale(): LocalePref {
  try {
    const value = window.localStorage.getItem(KEY);
    return isLocalePref(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function saveLocale(pref: LocalePref) {
  try {
    window.localStorage.setItem(KEY, pref);
  } catch {
    /* The choice still applies for this session. */
  }
}

/** Any Chinese system language gets Traditional Chinese; everything else English. */
export function resolveLocale(
  pref: LocalePref,
  languages: readonly string[] = typeof navigator === "undefined"
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
): Locale {
  if (pref !== "system") return pref;
  return languages[0]?.toLowerCase().startsWith("zh") ? "zh-TW" : "en";
}

const zhTW = {
  lang: "zh-Hant",
  appName: "HaloDesk",
  flyoutTitle: "HaloDesk 快速控制",
  version: (v: string) => `開發版 ${v}`,
  header: { back: "燈光", settings: "設定" },
  lock: {
    offline: "已斷線",
    radio: "無線模組未就緒",
    busy: "處理中",
    unknown: "結果不明，請先查詢",
  },
  banner: {
    offlineTitle: "已斷線，重試中",
    offlineBody: (updated: string) => `最後同步 ${updated}。不會重送先前的操作。`,
    retry: "立即重試",
    radioTitle: "無線模組未就緒",
    radioBody: "控制已暫停，模組就緒後即可操作。",
    unknownTitle: "上一筆結果不明",
    unknownBody: (action: string) => `請先查詢「${action}」的結果。`,
    lastCommand: "上一筆命令",
    lookup: "查詢命令結果",
    rebootTitle: "裝置已重新開機",
    rebootBody: "已重新同步，先前的命令結果無法查詢。",
    dismiss: "知道了",
  },
  action: {
    power: (on: boolean): string => (on ? "開燈" : "關燈"),
    setting: (on: boolean, title: string) => `${on ? "開啟" : "關閉"}${title}`,
    adjust: "調整燈光",
  },
  power: {
    on: "開啟",
    off: "關閉",
    lightOff: "燈已關閉",
    hint: (next: string) => `按一下${next}`,
  },
  feedback: {
    busy: "處理中",
    sending: (action: string) => `正在送出「${action}」`,
    unknown: "結果不明",
    unknownBody: "請先查詢，不要重送。",
    failed: "發送失敗",
    failedBody: "請稍後再試。",
    transmitted: "指令已送出",
    expired: "指令已過期",
    superseded: "指令已被新操作取代",
    ready: "就緒",
    waiting: "等待連線",
  },
  tray: {
    notConnected: "未連線",
    lookupSuffix: "，請先查詢",
    open: "開啟 HaloDesk",
    lookup: "查詢",
    quit: "結束",
  },
  connection: {
    none: "未連線",
    online: (updated: string) => `已連線 · 同步 ${updated}`,
    offline: (updated: string) => `已斷線 · 重試中 · 最後同步 ${updated}`,
  },
  modes: { front: "前燈", back: "後燈", both: "前後燈" } as Record<string, string>,
  modeGroup: "模式",
  level: { front: (n: number) => `前 ${n}%`, back: (n: number) => `後 ${n}%` },
  preview: { front: "前", back: "後", caption: "目標示意" },
  lights: {
    section: "燈光",
    disabled: (reason: string) => `已停用：${reason}`,
    sliders: {
      front_brightness: { label: "前燈", name: "前燈亮度" },
      back_brightness: { label: "後燈", name: "後燈亮度" },
      temperature_k: { label: "色溫", name: "色溫" },
    },
    experimental: "實驗性",
    sendingSetting: "正在送出…",
    settings: {
      auto_dimming: {
        title: "自動調光",
        desc: (_on: boolean): string => "自動偵測環境光線，即時調整亮度，並將色溫設定在 4000K",
      },
      ultrasonic_enabled: { title: "入席偵測", desc: (_on: boolean): string => "在使用者進入偵測區域時自動開燈" },
    },
  },
  presets: {
    section: "情境",
    deleted: (name: string) => `已刪除「${name}」`,
    undo: "復原",
    full: (max: number) => `最多 ${max} 組情境`,
    addTitle: "以目前設定新增情境",
    add: "＋ 新增",
    done: "完成",
    edit: "編輯",
    newPreset: "新增情境",
    newHint: "以目前的燈光設定保存",
    nameLabel: "情境名稱",
    namePlaceholder: "名稱",
    cancel: "取消",
    save: "保存",
    confirmDelete: "刪除這個情境？",
    delete: "刪除",
    apply: (name: string) => `帶入情境 ${name}`,
    remove: (name: string) => `刪除情境 ${name}`,
  },
  connect: {
    title: "連接掛燈",
    browserOnly: "請在 Tauri 桌面或手機 App 中開啟；瀏覽器預覽不會連接掛燈。",
    saved: "已保存",
    storedIn: (store: string) => `密碼存於 ${store}。`,
    useSaved: "使用已保存帳密連線",
    forgetTitle: "忘記已保存連線",
    forgetDesc: "移除保存的位址、帳號與密碼。",
    forget: "忘記",
    login: "登入",
    host: "主機",
    port: "連接埠",
    username: "帳號",
    password: "密碼",
    required: "必填",
    showPassword: "顯示密碼",
    hidePassword: "隱藏密碼",
    remember: "記住此連線與帳密",
    connecting: "連線中…",
    connect: "連線",
    retryForget: "重試移除保存資料",
    savedNote: "連線已保存，密碼存放於系統憑證庫。",
    saveFailed: (message: string) => `本次已連線，但保存失敗：${message}`,
    forgotten: "已移除保存的連線與帳密。",
  },
  store: {
    windows: "Windows 認證管理員",
    macos: "macOS 鑰匙圈",
    ios: "iOS 鑰匙圈",
    other: "系統憑證庫",
  } as Record<Platform, string>,
  discoveryHint: {
    windows: "若曾拒絕防火牆提示，請到「Windows 安全性」允許。",
    macos: "請確認未開 VPN。",
    ios: "請在「設定」→「隱私權」→「區域網路」允許。",
    other: "",
  } as Record<Platform, string>,
  discovery: {
    section: "區域網路",
    title: "搜尋區域網路",
    searching: "搜尋中…約 5 秒",
    desc: "約 5 秒，選取後只會填入位址。",
    search: "搜尋",
    select: (name: string, address: string) => `選取 ${name} ${address}`,
    picked: "已填入，請輸入密碼。",
    empty: "找不到裝置，可直接輸入 IP。",
  },
  settings: {
    title: "設定",
    device: "裝置",
    online: "已連線",
    offline: "已斷線 · 重試中",
    radio: "無線模組",
    ready: "就緒",
    notReady: "未就緒",
    pairing: "配對",
    pairingSaved: "已保存",
    pairingUnsaved: "未保存",
    lastSync: "最後同步",
    connection: "連線",
    refresh: "重新整理",
    refreshDesc: "立即向控制盒讀取最新狀態。",
    change: "更換裝置",
    changeDesc: "中斷目前連線，回到連線畫面。",
    disconnect: "中斷連線",
    savedConnection: "已保存的連線",
    forget: "忘記",
    forgetName: "忘記已保存連線",
    theme: "主題",
    themes: { light: "淺色", dark: "深色", system: "跟隨系統" } as Record<ThemePref, string>,
    language: "語言",
    languages: { "zh-TW": "繁體中文", en: "English", system: "跟隨系統" } as Record<LocalePref, string>,
    diagAppOnly: "診斷紀錄只在 App 中提供。",
    deviceTab: "裝置與連線",
    lookTab: "外觀",
    startupTab: "啟動",
    diagTab: "診斷紀錄",
    autostart: "開機時自動啟動",
    autostartDesc: (platform: Platform): string =>
      platform === "macos"
        ? "登入後在背景啟動並留在選單列，需要時再從選單列開啟主視窗。"
        : "登入後在背景啟動並縮到系統匣，需要時再從系統匣開啟主視窗。",
    on: "已開啟",
    off: "已關閉",
  },
  diag: {
    command: "命令",
    sent: "已送出",
    sendFailed: "發送失敗",
    expired: "已過期",
    superseded: "已被取代",
    busy: "處理中",
    unknown: "結果不明",
    sync: "狀態同步",
    ready: "就緒",
    learning: "學習位址中",
    radio: "無線模組未就緒",
    unknownState: "狀態不明",
    connection: "連線",
    storage: "儲存",
    failed: "失敗",
    cleared: "歷史紀錄已清除。",
    exported: (path: string) => `已匯出：${path}`,
    ok: "成功",
    events: "事件",
    recent: (n: number) => `最近 ${n} 筆 · 保留最近 200 筆`,
    raw: "原始資料",
    empty: "沒有紀錄",
    privacy: "匯出檔不含帳號、IP 與密碼。",
    export: "匯出 JSON",
    clear: "清除紀錄",
    iphoneHint: "到「檔案」→「我的 iPhone」→「HaloDesk」→「HaloDesk」取用。",
  },
  /** The native layer already reports Traditional Chinese messages. */
  fault: (fault: Fault) => fault.message,
};

export type Messages = typeof zhTW;

/** English messages for the native layer's fault codes; its own text is Chinese. */
const EN_FAULTS: Record<string, string> = {
  APP_ERROR: "The operation could not be completed. Please reconnect.",
  AUTOSTART_UNAVAILABLE: "Could not read or change the launch-at-login setting.",
  BOOT_CHANGED: "The device just restarted. Please reconnect.",
  BUSY: "Another command is in progress.",
  CREDENTIAL_STORE:
    "The system credential store is unavailable. Turn off “Remember” to connect for this session only.",
  DEVICE_CHANGED: "The device has changed. Please refresh or reconnect.",
  DISCOVERY_BUSY: "A search is still running. Try again in a moment.",
  DISCOVERY_PERMISSION: "Local network access was denied. Allow HaloDesk to access the local network in system settings.",
  DISCOVERY_UNAVAILABLE:
    "Could not search the local network. Check the network and the App's local network permission, or enter the IP.",
  INVALID_CREDENTIALS: "Enter a username and password. The username cannot contain a colon.",
  INVALID_HOST: "Enter an IP or host name, without http://, a path or credentials.",
  INVALID_PRESET: "The preset name or lighting values are invalid, or the preset already exists.",
  INVALID_VALUE: "The lighting value is out of the supported range.",
  NETWORK: "Could not connect or the connection timed out. Check the device and the local network.",
  NO_SAVED_CONNECTION: "There is no saved connection.",
  NOT_CONNECTED: "Please connect first.",
  PRESET_LIMIT: "Up to 4 presets can be saved. Delete one you no longer need first.",
  PROTOCOL_ERROR: "The device response does not match protocol v1. Check the firmware version.",
  RADIO_UNAVAILABLE: "The device is not ready, or power control for this pairing is not verified yet.",
  RATE_LIMITED: "Please wait a moment before trying again.",
  STORAGE_ERROR: "Could not read or write local data. Check storage space and permissions.",
  UNAUTHORIZED: "Incorrect username or password.",
  UNKNOWN_OUTCOME: "Outcome unknown. Look up the result; do not repeat the action.",
  UNSUPPORTED_FIELD: "This device does not support that control.",
};

const en: Messages = {
  lang: "en",
  appName: "HaloDesk",
  flyoutTitle: "HaloDesk Quick Controls",
  version: (v) => `Dev build ${v}`,
  header: { back: "Lighting", settings: "Settings" },
  lock: {
    offline: "Offline",
    radio: "Radio not ready",
    busy: "Sending",
    unknown: "Outcome unknown, look it up first",
  },
  banner: {
    offlineTitle: "Offline, retrying",
    offlineBody: (updated) => `Last synced ${updated}. Earlier actions will not be resent.`,
    retry: "Retry now",
    radioTitle: "Radio not ready",
    radioBody: "Controls are paused until the radio is ready.",
    unknownTitle: "Last outcome unknown",
    unknownBody: (action) => `Look up the outcome of “${action}” first.`,
    lastCommand: "the last command",
    lookup: "Look up result",
    rebootTitle: "Device restarted",
    rebootBody: "Resynced. Earlier command outcomes can no longer be looked up.",
    dismiss: "Got it",
  },
  action: {
    power: (on) => (on ? "Turn on" : "Turn off"),
    setting: (on, title) => `Turn ${on ? "on" : "off"} ${title}`,
    adjust: "Adjust lighting",
  },
  power: {
    on: "On",
    off: "Off",
    lightOff: "Light is off",
    hint: (next) => `Click to ${next.toLowerCase()}`,
  },
  feedback: {
    busy: "Sending",
    sending: (action) => `Sending “${action}”`,
    unknown: "Outcome unknown",
    unknownBody: "Look it up first; do not resend.",
    failed: "Send failed",
    failedBody: "Try again later.",
    transmitted: "Command sent",
    expired: "Command expired",
    superseded: "Replaced by a newer action",
    ready: "Ready",
    waiting: "Waiting for connection",
  },
  tray: {
    notConnected: "Not connected",
    lookupSuffix: ", look it up first",
    open: "Open HaloDesk",
    lookup: "Look up",
    quit: "Quit",
  },
  connection: {
    none: "Not connected",
    online: (updated) => `Connected · synced ${updated}`,
    offline: (updated) => `Offline · retrying · last synced ${updated}`,
  },
  modes: { front: "Front", back: "Back", both: "Both" },
  modeGroup: "Mode",
  level: { front: (n) => `Front ${n}%`, back: (n) => `Back ${n}%` },
  preview: { front: "Front", back: "Back", caption: "Target preview" },
  lights: {
    section: "Lighting",
    disabled: (reason) => `Disabled: ${reason}`,
    sliders: {
      front_brightness: { label: "Front", name: "Front brightness" },
      back_brightness: { label: "Back", name: "Back brightness" },
      temperature_k: { label: "Color temp", name: "Color temperature" },
    },
    experimental: "Experimental",
    sendingSetting: "Sending…",
    settings: {
      auto_dimming: {
        title: "Auto Dimming",
        desc: () => "Adjusts brightness to the surrounding light and sets the color temperature to 4000 K.",
      },
      ultrasonic_enabled: {
        title: "Presence Detection",
        desc: () => "Turns the light on automatically when you enter the detection area.",
      },
    },
  },
  presets: {
    section: "Presets",
    deleted: (name) => `Deleted “${name}”`,
    undo: "Undo",
    full: (max) => `Up to ${max} presets`,
    addTitle: "Save the current settings as a preset",
    add: "+ Add",
    done: "Done",
    edit: "Edit",
    newPreset: "New preset",
    newHint: "Saves the current lighting",
    nameLabel: "Preset name",
    namePlaceholder: "Name",
    cancel: "Cancel",
    save: "Save",
    confirmDelete: "Delete this preset?",
    delete: "Delete",
    apply: (name) => `Apply preset ${name}`,
    remove: (name) => `Delete preset ${name}`,
  },
  connect: {
    title: "Connect to your lamp",
    browserOnly: "Open this in the HaloDesk desktop or mobile App; the browser preview does not connect to the lamp.",
    saved: "Saved",
    storedIn: (store) => `Password stored in ${store}.`,
    useSaved: "Connect with saved login",
    forgetTitle: "Forget saved connection",
    forgetDesc: "Removes the saved address, username and password.",
    forget: "Forget",
    login: "Sign in",
    host: "Host",
    port: "Port",
    username: "Username",
    password: "Password",
    required: "Required",
    showPassword: "Show password",
    hidePassword: "Hide password",
    remember: "Remember this connection and login",
    connecting: "Connecting…",
    connect: "Connect",
    retryForget: "Retry removing saved data",
    savedNote: "Connection saved; the password is kept in the system credential store.",
    saveFailed: (message) => `Connected, but saving failed: ${message}`,
    forgotten: "The saved connection and login were removed.",
  },
  store: {
    windows: "Windows Credential Manager",
    macos: "the macOS Keychain",
    ios: "the iOS Keychain",
    other: "the system credential store",
  },
  discoveryHint: {
    windows: "If you denied the firewall prompt, allow HaloDesk in Windows Security.",
    macos: "Make sure no VPN is on.",
    ios: "Allow it in Settings → Privacy → Local Network.",
    other: "",
  },
  discovery: {
    section: "Local network",
    title: "Search the local network",
    searching: "Searching… about 5 s",
    desc: "About 5 s. Picking a result only fills in the address.",
    search: "Search",
    select: (name, address) => `Select ${name} ${address}`,
    picked: "Filled in. Enter the password.",
    empty: "No devices found. You can enter the IP directly.",
  },
  settings: {
    title: "Settings",
    device: "Device",
    online: "Connected",
    offline: "Offline · retrying",
    radio: "Radio",
    ready: "Ready",
    notReady: "Not ready",
    pairing: "Pairing",
    pairingSaved: "Saved",
    pairingUnsaved: "Not saved",
    lastSync: "Last sync",
    connection: "Connection",
    refresh: "Refresh",
    refreshDesc: "Read the latest state from the bridge now.",
    change: "Change device",
    changeDesc: "Disconnect and return to the connect screen.",
    disconnect: "Disconnect",
    savedConnection: "Saved connection",
    forget: "Forget",
    forgetName: "Forget saved connection",
    theme: "Theme",
    themes: { light: "Light", dark: "Dark", system: "System" },
    language: "Language",
    languages: { "zh-TW": "繁體中文", en: "English", system: "System" },
    diagAppOnly: "Diagnostics are available only in the App.",
    deviceTab: "Device & connection",
    lookTab: "Appearance",
    startupTab: "Startup",
    diagTab: "Diagnostics",
    autostart: "Launch at login",
    autostartDesc: (platform) =>
      platform === "macos"
        ? "Starts in the background when you log in and stays in the menu bar; open the window from there."
        : "Starts in the background when you sign in and stays in the system tray; open the window from there.",
    on: "On",
    off: "Off",
  },
  diag: {
    command: "Command",
    sent: "Sent",
    sendFailed: "Send failed",
    expired: "Expired",
    superseded: "Superseded",
    busy: "In progress",
    unknown: "Outcome unknown",
    sync: "State sync",
    ready: "Ready",
    learning: "Learning address",
    radio: "Radio not ready",
    unknownState: "Unknown state",
    connection: "Connection",
    storage: "Storage",
    failed: "Failed",
    cleared: "History cleared.",
    exported: (path) => `Exported: ${path}`,
    ok: "Succeeded",
    events: "Events",
    recent: (n) => `${n} recent · keeps the last 200`,
    raw: "Raw data",
    empty: "No records",
    privacy: "Exports exclude usernames, IPs and passwords.",
    export: "Export JSON",
    clear: "Clear history",
    iphoneHint: "Find it in Files → On My iPhone → HaloDesk → HaloDesk.",
  },
  // Other codes come from the device refusing a request.
  fault: (fault) =>
    EN_FAULTS[fault.code] ?? "The device refused the request. Refresh the state before deciding whether to try again.",
};

export const MESSAGES: Record<Locale, Messages> = { "zh-TW": zhTW, en };

/** Components rendered outside a provider (tests, previews) use Traditional Chinese. */
export const I18nContext = createContext<Messages>(zhTW);
export const useMessages = () => useContext(I18nContext);

/** Keep <html lang> and the window title in step with the shown language. */
export function useDocumentLocale(m: Messages, title: string) {
  useEffect(() => {
    document.documentElement.lang = m.lang;
    document.title = title;
  }, [m, title]);
}
