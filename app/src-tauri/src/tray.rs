use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalSize, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const FLYOUT: &str = "tray";
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

/// Top-left corner for the flyout: centred on the icon, above it when the icon
/// sits in the lower half of the work area (Windows taskbar), otherwise below
/// it (macOS menu bar), and always clamped inside the work area.
pub fn place(icon: Area, work: Area, width: f64, height: f64, margin: f64) -> (f64, f64) {
    let clamp = |v: f64, lo: f64, hi: f64| if hi < lo { lo } else { v.clamp(lo, hi) };
    let x = clamp(
        icon.x + icon.w / 2.0 - width / 2.0,
        work.x + margin,
        work.x + work.w - width - margin,
    );
    let below = icon.y + icon.h / 2.0 < work.y + work.h / 2.0;
    let y = if below {
        (icon.y + icon.h).max(work.y) + margin
    } else {
        icon.y.min(work.y + work.h) - height - margin
    };
    (
        x,
        clamp(y, work.y + margin, work.y + work.h - height - margin),
    )
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
    let monitor = app
        .monitor_from_point(icon.x + icon.w / 2.0, icon.y + icon.h / 2.0)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let work = Area {
        x: work.position.x as f64,
        y: work.position.y as f64,
        w: work.size.width as f64,
        h: work.size.height as f64,
    };
    let (x, y) = place(icon, work, WIDTH * scale, height * scale, MARGIN * scale);
    let _ = window.set_size(LogicalSize::new(WIDTH, height));
    let _ = window.set_position(PhysicalPosition::new(x, y));
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
        .title("Halo 2 快速控制")
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

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    app.manage(Flyout(Mutex::new(Placement {
        height: 480.0,
        ..Default::default()
    })));
    // Without the flyout the tray menu still opens the App, so a window that
    // cannot be created (for example an unsupported backdrop) must not stop it.
    if let Err(error) = flyout_window(app) {
        eprintln!("tray flyout unavailable: {error}");
    }
    let show_item = MenuItem::with_id(app, "halo-show", "開啟 Halo 2 Control", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "halo-quit", "結束 Halo 2 Control", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit])?;
    let mut builder = TrayIconBuilder::with_id("halo-control")
        .tooltip("Halo 2 Control")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "halo-show" => open_main(app),
            "halo-quit" => app.exit(0),
            _ => (),
        })
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
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Area = Area {
        x: 0.0,
        y: 0.0,
        w: 1920.0,
        h: 1032.0,
    };

    #[test]
    fn opens_above_a_bottom_taskbar_icon() {
        let icon = Area {
            x: 1700.0,
            y: 1040.0,
            w: 24.0,
            h: 40.0,
        };
        assert_eq!(place(icon, WORK, 340.0, 500.0, 12.0), (1542.0, 520.0));
    }

    #[test]
    fn opens_below_a_menu_bar_icon_and_stays_on_screen() {
        let icon = Area {
            x: 1900.0,
            y: 0.0,
            w: 22.0,
            h: 24.0,
        };
        let work = Area {
            y: 25.0,
            h: 1055.0,
            ..WORK
        };
        assert_eq!(place(icon, work, 340.0, 500.0, 12.0), (1568.0, 37.0));
    }

    #[test]
    fn clamps_a_tall_panel_inside_the_work_area() {
        let icon = Area {
            x: 10.0,
            y: 1040.0,
            w: 24.0,
            h: 40.0,
        };
        let (x, y) = place(icon, WORK, 340.0, 2000.0, 12.0);
        assert_eq!((x, y), (12.0, 12.0));
    }
}
