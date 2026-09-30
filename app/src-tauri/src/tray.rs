use halo2_app_support::presets::Preset;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Wry,
};

pub const FLYOUT: &str = "tray";
const TRAY_ID: &str = "halo-control";
const PRESET_PREFIX: &str = "halo-preset:";
const WIDTH: f64 = 340.0;
const MARGIN: f64 = 12.0;
const MIN_HEIGHT: f64 = 160.0;
const MAX_HEIGHT: f64 = 720.0;
// A click on the tray icon first blurs (and hides) an open flyout; ignore the
// click that caused it instead of reopening the panel immediately.
const REOPEN_GUARD: Duration = Duration::from_millis(300);

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Edge {
    Top,
    Bottom,
    Left,
    Right,
}

/// The screen edge that holds the tray: among the edges the work area reserves
/// (taskbar, menu bar, Dock) the one nearest the icon, so a macOS menu-bar icon
/// is not mistaken for the Dock. With nothing reserved (auto-hide taskbar) it
/// is simply the screen edge nearest the icon.
fn tray_edge(icon: Area, screen: Area, work: Area) -> Edge {
    let (cx, cy) = (icon.x + icon.w / 2.0, icon.y + icon.h / 2.0);
    let edges = [
        (Edge::Top, work.y - screen.y, cy - screen.y),
        (
            Edge::Bottom,
            (screen.y + screen.h) - (work.y + work.h),
            screen.y + screen.h - cy,
        ),
        (Edge::Left, work.x - screen.x, cx - screen.x),
        (
            Edge::Right,
            (screen.x + screen.w) - (work.x + work.w),
            screen.x + screen.w - cx,
        ),
    ];
    let nearest = |reserved_only: bool| {
        edges
            .iter()
            .filter(|(_, inset, _)| !reserved_only || *inset > 0.0)
            .min_by(|a, b| a.2.total_cmp(&b.2))
            .map(|(edge, _, _)| *edge)
    };
    nearest(true)
        .or_else(|| nearest(false))
        .unwrap_or(Edge::Bottom)
}

/// Top-left corner for the flyout. Like the system flyouts it sits flush
/// against the tray's edge of the work area and is always clamped inside it.
/// Anchoring to the work area rather than the icon keeps the panel on the
/// taskbar when the icon was clicked in the Windows overflow ("hidden icons")
/// popup. Along that edge it goes to the tray's end of the taskbar when
/// `corner` is set (Windows, like Quick Settings: bottom-right, or the bottom
/// of a side taskbar) and is otherwise centred on the icon (macOS menu bar).
pub fn place(
    icon: Area,
    screen: Area,
    work: Area,
    size: (f64, f64),
    margin: f64,
    corner: bool,
) -> (f64, f64) {
    let (width, height) = size;
    let clamp = |v: f64, lo: f64, hi: f64| if hi < lo { lo } else { v.clamp(lo, hi) };
    let (right, bottom) = (work.x + work.w, work.y + work.h);
    let edge = tray_edge(icon, screen, work);
    // A reserved edge anchors on the work area; an auto-hide taskbar reserves
    // nothing, so the panel keeps clear of the icon (and the taskbar) instead.
    let reserved = match edge {
        Edge::Top => work.y > screen.y,
        Edge::Bottom => bottom < screen.y + screen.h,
        Edge::Left => work.x > screen.x,
        Edge::Right => right < screen.x + screen.w,
    };
    let (along_x, along_y) = if corner {
        (right - width - margin, bottom - height - margin)
    } else {
        (
            icon.x + icon.w / 2.0 - width / 2.0,
            icon.y + icon.h / 2.0 - height / 2.0,
        )
    };
    let (x, y) = match edge {
        Edge::Top => {
            let anchor = if reserved {
                work.y
            } else {
                (icon.y + icon.h).max(work.y)
            };
            (along_x, anchor + margin)
        }
        Edge::Bottom => {
            let anchor = if reserved { bottom } else { icon.y.min(bottom) };
            (along_x, anchor - height - margin)
        }
        Edge::Left => {
            let anchor = if reserved {
                work.x
            } else {
                (icon.x + icon.w).max(work.x)
            };
            (anchor + margin, along_y)
        }
        Edge::Right => {
            let anchor = if reserved { right } else { icon.x.min(right) };
            (anchor - width - margin, along_y)
        }
    };
    (
        clamp(x, work.x + margin, right - width - margin),
        clamp(y, work.y + margin, bottom - height - margin),
    )
}

/// Index of the screen holding `point` (the tray icon's centre), or else the
/// one nearest to it, so an icon rect that lands in a gap between monitors or
/// just off an edge still picks the monitor its taskbar is on.
pub fn pick_screen(point: (f64, f64), screens: &[Area]) -> Option<usize> {
    let distance = |s: &Area| {
        let dx = (s.x - point.0).max(point.0 - (s.x + s.w)).max(0.0);
        let dy = (s.y - point.1).max(point.1 - (s.y + s.h)).max(0.0);
        dx * dx + dy * dy
    };
    screens
        .iter()
        .enumerate()
        .min_by(|a, b| distance(a.1).total_cmp(&distance(b.1)))
        .map(|(index, _)| index)
}

/// Panel size in the target monitor's pixels: the reported CSS height scaled
/// by that monitor's factor, never taller than its work area (small screens or
/// large scaling), where the page scrolls instead.
pub fn panel_size(css_height: f64, scale: f64, work: Area, margin: f64) -> (f64, f64) {
    let height = (css_height * scale).min(work.h - 2.0 * margin).max(1.0);
    ((WIDTH * scale).round(), height.round())
}

#[derive(Default)]
struct Placement {
    icon: Option<Area>,
    height: f64,
    hidden_at: Option<Instant>,
}
#[derive(Default)]
pub struct Flyout(Mutex<Placement>);

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn icon_area(rect: &Rect) -> Area {
    let position = rect.position.to_physical::<f64>(1.0);
    let size = rect.size.to_physical::<f64>(1.0);
    Area {
        x: position.x,
        y: position.y,
        w: size.width,
        h: size.height,
    }
}

/// Resize and move the flyout next to the last clicked tray icon.
fn arrange(app: &tauri::AppHandle, window: &WebviewWindow) {
    // Copy what we need and release the lock before touching the window, whose
    // calls can dispatch window events (for example a blur that hides it).
    let Some((icon, height)) = app
        .state::<Flyout>()
        .0
        .lock()
        .ok()
        .and_then(|p| p.icon.map(|icon| (icon, p.height)))
    else {
        return;
    };
    // Pick the monitor ourselves from physical bounds: every value below
    // (tray rect, monitor bounds, work area, window position) is in physical
    // pixels of the one virtual desktop, including monitors at negative
    // coordinates left of or above the primary one.
    let monitors = app.available_monitors().unwrap_or_default();
    let screens: Vec<Area> = monitors
        .iter()
        .map(|m| Area {
            x: m.position().x as f64,
            y: m.position().y as f64,
            w: m.size().width as f64,
            h: m.size().height as f64,
        })
        .collect();
    let centre = (icon.x + icon.w / 2.0, icon.y + icon.h / 2.0);
    let monitor = pick_screen(centre, &screens)
        .and_then(|index| monitors.get(index).cloned())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let scale = monitor.scale_factor();
    let screen = Area {
        x: monitor.position().x as f64,
        y: monitor.position().y as f64,
        w: monitor.size().width as f64,
        h: monitor.size().height as f64,
    };
    let work = monitor.work_area();
    let work = Area {
        x: work.position.x as f64,
        y: work.position.y as f64,
        w: work.size.width as f64,
        h: work.size.height as f64,
    };
    let margin = MARGIN * scale;
    let (w, h) = panel_size(height, scale, work, margin);
    let (x, y) = place(icon, screen, work, (w, h), margin, cfg!(windows));
    let (x, y) = (x.round(), y.round());
    // Move first so a monitor with another DPI applies its scale (Windows
    // rescales the window on WM_DPICHANGED), then size in that monitor's
    // pixels; a LogicalSize would use the scale of the monitor it came from.
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let size = PhysicalSize::new(w as u32, h as u32);
    let _ = window.set_size(size);
    // On Windows the first resize of the hidden undecorated window measures a
    // stale frame and leaves the client ~a caption taller (a blank strip under
    // the footer). Its frame is settled by then, so one more resize lands.
    if window.inner_size().is_ok_and(|inner| inner != size) {
        let _ = window.set_size(size);
    }
    // set_position places the outer frame, which on Windows includes invisible
    // resize borders. Offset by the frame inset alone (not by wherever a DPI
    // change moved the window) so the visible panel lands exactly on (x, y).
    if let (Ok(inner), Ok(outer)) = (window.inner_position(), window.outer_position()) {
        let (left, top) = ((inner.x - outer.x) as f64, (inner.y - outer.y) as f64);
        if (outer.x as f64, outer.y as f64) != (x - left, y - top) {
            let _ = window.set_position(PhysicalPosition::new(x - left, y - top));
        }
    }
}

fn toggle(app: &tauri::AppHandle, rect: &Rect) {
    let Some(window) = app.get_webview_window(FLYOUT) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        hide(app);
        return;
    }
    if let Ok(mut placement) = app.state::<Flyout>().0.lock() {
        if placement
            .hidden_at
            .is_some_and(|at| at.elapsed() < REOPEN_GUARD)
        {
            return;
        }
        placement.icon = Some(icon_area(rect));
    }
    arrange(app, &window);
    let _ = window.show();
    let _ = window.set_focus();
    // Both webviews re-sync: the main coordinator reads state (GET only) and
    // the flyout drops any draft left from a previous opening.
    let _ = app.emit_to("main", "halo-flyout-shown", ());
    let _ = app.emit_to(FLYOUT, "halo-flyout-shown", ());
}

pub fn hide(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(FLYOUT) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            if let Ok(mut placement) = app.state::<Flyout>().0.lock() {
                placement.hidden_at = Some(Instant::now());
            }
        }
    }
}

pub fn resize(app: &tauri::AppHandle, height: f64) {
    if !height.is_finite() {
        return;
    }
    if let Ok(mut placement) = app.state::<Flyout>().0.lock() {
        placement.height = height.clamp(MIN_HEIGHT, MAX_HEIGHT);
    }
    if let Some(window) = app.get_webview_window(FLYOUT) {
        arrange(app, &window);
    }
}

pub fn open_main(app: &tauri::AppHandle) {
    hide(app);
    show_main(app);
}

fn flyout_window(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    let builder = WebviewWindowBuilder::new(app, FLYOUT, WebviewUrl::App("tray.html".into()))
        .title("HaloDesk 快速控制")
        .inner_size(WIDTH, 480.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false);
    // Windows gets a real acrylic backdrop; macOS keeps an opaque panel so the
    // app does not need the private transparency API.
    #[cfg(windows)]
    let builder = builder.transparent(true).effects(
        tauri::window::EffectsBuilder::new()
            .effect(tauri::window::Effect::Acrylic)
            .build(),
    );
    builder.build()
}

/// What the tray menu may offer, from the main window's published flyout
/// state: power and presets only while controls are unlocked, and only the
/// power item that changes the lamp's desired state.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MenuFlags {
    ready: bool,
    power: Option<bool>,
}

pub fn menu_flags(state: &serde_json::Value) -> MenuFlags {
    let connected = state["connected"].as_bool() == Some(true);
    let power = state["desired"]["power"].as_bool().filter(|_| connected);
    let ready = power.is_some()
        && state["lock"].is_null()
        && state["status"]["tone"].as_str() != Some("busy");
    MenuFlags { ready, power }
}

/// The intent a tray menu item sends to the main window's coordinator, the
/// same one the flyout sends; the main window re-checks its lock first.
pub fn menu_intent(id: &str, presets: &[Preset], serial: u64) -> Option<serde_json::Value> {
    let id_value = format!("tray-menu-{serial}");
    match id {
        "halo-power-on" | "halo-power-off" => Some(serde_json::json!({
            "id": id_value,
            "kind": "power",
            "value": id == "halo-power-on",
        })),
        _ => {
            let preset_id = id.strip_prefix(PRESET_PREFIX)?;
            let preset = presets.iter().find(|p| p.id == preset_id)?;
            Some(serde_json::json!({
                "id": id_value,
                "kind": "adjust",
                "patch": preset.values,
            }))
        }
    }
}

#[derive(Default)]
pub struct TrayMenu(Mutex<MenuFlags>);

fn stored_presets(app: &tauri::AppHandle) -> Vec<Preset> {
    app.try_state::<crate::SupportState>()
        .and_then(|support| {
            support
                .lock()
                .ok()
                .and_then(|data| data.presets.list().ok())
        })
        .unwrap_or_default()
}

fn build_menu(app: &tauri::AppHandle, flags: MenuFlags) -> tauri::Result<Menu<Wry>> {
    let on = flags.ready && flags.power == Some(false);
    let off = flags.ready && flags.power == Some(true);
    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> = vec![
        Box::new(MenuItem::with_id(
            app,
            "halo-power-on",
            "開燈",
            on,
            None::<&str>,
        )?),
        Box::new(MenuItem::with_id(
            app,
            "halo-power-off",
            "關燈",
            off,
            None::<&str>,
        )?),
    ];
    let presets = stored_presets(app);
    if !presets.is_empty() {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
        for preset in presets {
            items.push(Box::new(MenuItem::with_id(
                app,
                format!("{PRESET_PREFIX}{}", preset.id),
                &preset.name,
                flags.ready,
                None::<&str>,
            )?));
        }
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "halo-show",
        "開啟 HaloDesk",
        true,
        None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "halo-quit",
        "結束 HaloDesk",
        true,
        None::<&str>,
    )?));
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|item| item.as_ref()).collect();
    Menu::with_items(app, &refs)
}

/// Rebuild the right-click menu, for example after the presets changed.
pub fn refresh_menu(app: &tauri::AppHandle) {
    let flags = app
        .try_state::<TrayMenu>()
        .and_then(|menu| menu.0.lock().ok().map(|flags| *flags))
        .unwrap_or_default();
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), build_menu(app, flags)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn on_state(app: &tauri::AppHandle, payload: &str) {
    let Ok(state) = serde_json::from_str::<serde_json::Value>(payload) else {
        return;
    };
    let flags = menu_flags(&state);
    let changed = app
        .state::<TrayMenu>()
        .0
        .lock()
        .map(|mut current| std::mem::replace(&mut *current, flags) != flags)
        .unwrap_or(false);
    if changed {
        refresh_menu(app);
    }
}

fn on_menu(app: &tauri::AppHandle, id: &str) {
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    match id {
        "halo-show" => open_main(app),
        "halo-quit" => app.exit(0),
        _ => {
            let presets = stored_presets(app);
            let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
            // One intent per click; nothing here retries or replays it.
            if let Some(intent) = menu_intent(id, &presets, serial) {
                let _ = app.emit_to("main", "halo-flyout-intent", intent);
            }
        }
    }
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    app.manage(Flyout(Mutex::new(Placement {
        height: 480.0,
        ..Default::default()
    })));
    app.manage(TrayMenu::default());
    // Without the flyout the tray menu still opens the App, so a window that
    // cannot be created (for example an unsupported backdrop) must not stop it.
    if let Err(error) = flyout_window(app) {
        eprintln!("tray flyout unavailable: {error}");
    }
    let handle = app.handle().clone();
    // The main window publishes its state to the flyout; the menu reads the
    // same event to enable only what the main window would accept.
    app.listen_any("halo-flyout-state", move |event| {
        on_state(&handle, event.payload())
    });
    let menu = build_menu(app.handle(), MenuFlags::default())?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("HaloDesk")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle(tray.app_handle(), &rect);
            }
        });
    // The small icon (icons/tray.png, from the design's app-icon-small.svg)
    // stays legible at 16–32 px, unlike the full App icon.
    builder = builder.icon(tauri::include_image!("icons/tray.png"));
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_app_support::presets::Lighting;
    use serde_json::json;

    fn state(
        connected: bool,
        power: bool,
        lock: serde_json::Value,
        tone: &str,
    ) -> serde_json::Value {
        json!({
            "connected": connected,
            "lock": lock,
            "desired": { "power": power },
            "status": if tone.is_empty() { json!(null) } else { json!({ "tone": tone }) },
            "updated": "",
        })
    }

    #[test]
    fn the_menu_offers_only_what_the_main_window_would_accept() {
        let ready = |power| MenuFlags {
            ready: true,
            power: Some(power),
        };
        assert_eq!(
            menu_flags(&state(true, false, json!(null), "")),
            ready(false)
        );
        assert_eq!(
            menu_flags(&state(true, true, json!(null), "ok")),
            ready(true)
        );
        for locked in [
            state(true, true, json!("處理中"), ""),
            state(true, true, json!("結果不明，請先查詢"), "warn"),
            state(true, false, json!(null), "busy"),
        ] {
            assert!(!menu_flags(&locked).ready);
        }
        assert_eq!(
            menu_flags(&state(false, true, json!(null), "")),
            MenuFlags::default()
        );
        assert_eq!(menu_flags(&json!({})), MenuFlags::default());
    }

    #[test]
    fn menu_items_send_one_flyout_intent() {
        let presets = [Preset {
            id: "3f1c2d6e-8a1b-4c3d-9e2f-0a1b2c3d4e5f".into(),
            name: "閱讀".into(),
            values: Lighting {
                mode: "front".into(),
                front_brightness: Some(70),
                back_brightness: None,
                temperature_k: 4300,
            },
        }];
        assert_eq!(
            menu_intent("halo-power-on", &presets, 1),
            Some(json!({ "id": "tray-menu-1", "kind": "power", "value": true }))
        );
        assert_eq!(
            menu_intent("halo-power-off", &presets, 2),
            Some(json!({ "id": "tray-menu-2", "kind": "power", "value": false }))
        );
        assert_eq!(
            menu_intent(
                "halo-preset:3f1c2d6e-8a1b-4c3d-9e2f-0a1b2c3d4e5f",
                &presets,
                3
            ),
            Some(json!({
                "id": "tray-menu-3",
                "kind": "adjust",
                "patch": { "mode": "front", "front_brightness": 70, "temperature_k": 4300 },
            }))
        );
        // A preset deleted since the menu was built sends nothing.
        assert_eq!(menu_intent("halo-preset:gone", &presets, 4), None);
        assert_eq!(menu_intent("halo-show", &presets, 5), None);
    }

    const SCREEN: Area = Area {
        x: 0.0,
        y: 0.0,
        w: 1920.0,
        h: 1080.0,
    };
    // A 48 px Windows taskbar at the bottom.
    const WORK: Area = Area {
        h: 1032.0,
        ..SCREEN
    };

    fn icon(x: f64, y: f64, w: f64, h: f64) -> Area {
        Area { x, y, w, h }
    }

    #[test]
    fn opens_in_the_bottom_right_corner_above_the_taskbar() {
        let icon = icon(1700.0, 1040.0, 24.0, 40.0);
        assert_eq!(
            place(icon, SCREEN, WORK, (340.0, 500.0), 12.0, true),
            (1568.0, 520.0)
        );
    }

    #[test]
    fn centres_on_the_icon_without_the_corner() {
        let icon = icon(1500.0, 1040.0, 24.0, 40.0);
        assert_eq!(
            place(icon, SCREEN, WORK, (340.0, 500.0), 12.0, false),
            (1342.0, 520.0)
        );
    }

    #[test]
    fn an_overflow_icon_opens_in_the_same_corner() {
        // Clicked inside the "hidden icons" popup, well above the taskbar.
        let icon = icon(1500.0, 900.0, 32.0, 32.0);
        assert_eq!(
            place(icon, SCREEN, WORK, (340.0, 500.0), 12.0, true),
            (1568.0, 520.0)
        );
    }

    #[test]
    fn opens_below_a_menu_bar_icon_and_stays_on_screen() {
        let icon = icon(1900.0, 0.0, 22.0, 24.0);
        let work = Area {
            y: 25.0,
            h: 1055.0,
            ..SCREEN
        };
        assert_eq!(
            place(icon, SCREEN, work, (340.0, 500.0), 12.0, false),
            (1568.0, 37.0)
        );
    }

    #[test]
    fn a_menu_bar_icon_ignores_a_larger_dock() {
        let icon = icon(1800.0, 0.0, 22.0, 24.0);
        // Menu bar 25 px on top, Dock 80 px at the bottom.
        let work = Area {
            y: 25.0,
            h: 975.0,
            ..SCREEN
        };
        assert_eq!(
            place(icon, SCREEN, work, (340.0, 500.0), 12.0, false),
            (1568.0, 37.0)
        );
    }

    #[test]
    fn opens_at_the_bottom_beside_a_side_taskbar() {
        let icon = icon(8.0, 500.0, 32.0, 24.0);
        let work = Area {
            x: 62.0,
            w: 1858.0,
            ..SCREEN
        };
        assert_eq!(
            place(icon, SCREEN, work, (340.0, 500.0), 12.0, true),
            (74.0, 568.0)
        );
        assert_eq!(
            place(icon, SCREEN, work, (340.0, 500.0), 12.0, false),
            (74.0, 262.0)
        );
    }

    #[test]
    fn keeps_clear_of_an_auto_hide_taskbar() {
        let icon = icon(1700.0, 1040.0, 24.0, 40.0);
        assert_eq!(
            place(icon, SCREEN, SCREEN, (340.0, 500.0), 12.0, true),
            (1568.0, 528.0)
        );
    }

    #[test]
    fn clamps_a_tall_panel_inside_the_work_area() {
        let icon = icon(10.0, 1040.0, 24.0, 40.0);
        let (x, y) = place(icon, SCREEN, WORK, (340.0, 2000.0), 12.0, false);
        assert_eq!((x, y), (12.0, 12.0));
    }

    // Primary 2560x1440, a 1920x1080 monitor to its left and one above it.
    const PRIMARY: Area = Area {
        x: 0.0,
        y: 0.0,
        w: 2560.0,
        h: 1440.0,
    };
    const LEFT: Area = Area {
        x: -1920.0,
        y: 180.0,
        w: 1920.0,
        h: 1080.0,
    };
    const ABOVE: Area = Area {
        x: 0.0,
        y: -1440.0,
        w: 2560.0,
        h: 1440.0,
    };

    #[test]
    fn picks_the_monitor_holding_the_icon() {
        let screens = [PRIMARY, LEFT, ABOVE];
        assert_eq!(pick_screen((2400.0, 1410.0), &screens), Some(0));
        assert_eq!(pick_screen((-100.0, 1230.0), &screens), Some(1));
        assert_eq!(pick_screen((2400.0, -30.0), &screens), Some(2));
    }

    #[test]
    fn an_icon_off_every_monitor_picks_the_nearest() {
        let screens = [PRIMARY, LEFT, ABOVE];
        // Just past the primary's right edge, and in the gap below LEFT.
        assert_eq!(pick_screen((2565.0, 1400.0), &screens), Some(0));
        assert_eq!(pick_screen((-500.0, 1300.0), &screens), Some(1));
        assert_eq!(pick_screen((0.0, 0.0), &[]), None);
    }

    #[test]
    fn sizes_the_panel_in_the_target_monitor_pixels() {
        let work = Area {
            h: 1380.0,
            ..PRIMARY
        };
        for (scale, size) in [
            (1.0, (340.0, 395.0)),
            (1.25, (425.0, 494.0)),
            (1.5, (510.0, 593.0)),
            (2.0, (680.0, 790.0)),
        ] {
            assert_eq!(panel_size(395.0, scale, work, 12.0 * scale), size);
        }
    }

    #[test]
    fn caps_the_panel_to_a_small_work_area() {
        // 1280x720 at 175%: 672 px of work area, 21 px margins.
        let work = Area {
            x: 0.0,
            y: 0.0,
            w: 1280.0,
            h: 672.0,
        };
        assert_eq!(panel_size(395.0, 1.75, work, 21.0), (595.0, 630.0));
        let icon = icon(1200.0, 680.0, 40.0, 40.0);
        let screen = Area { h: 720.0, ..work };
        assert_eq!(
            place(icon, screen, work, (595.0, 630.0), 21.0, true),
            (664.0, 21.0)
        );
    }

    #[test]
    fn opens_in_the_corner_of_a_monitor_left_of_the_primary() {
        // 150% scaling there: a 72 px taskbar, 18 px margins.
        let work = Area { h: 1008.0, ..LEFT };
        let icon = icon(-300.0, 1200.0, 36.0, 48.0);
        assert_eq!(
            place(icon, LEFT, work, (510.0, 593.0), 18.0, true),
            (-528.0, 577.0)
        );
    }

    #[test]
    fn opens_in_the_corner_of_a_monitor_above_the_primary() {
        let work = Area { h: 1380.0, ..ABOVE };
        let icon = icon(2300.0, -50.0, 30.0, 50.0);
        assert_eq!(
            place(icon, ABOVE, work, (425.0, 494.0), 15.0, true),
            (2120.0, -569.0)
        );
    }
}
