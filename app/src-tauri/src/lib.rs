use halo2_app_support::{
    diagnostics::{Diagnostics, Event},
    presets::{Lighting, Preset, Presets},
    profiles::{NativeCredentials, Profiles, SavedConnection},
};
use halo2_bridge_core::{Bridge, Fault, Record, Snapshot, StatePatch};
use std::{path::PathBuf, sync::Mutex as StdMutex};
use tauri::{Manager, State};
use tokio::sync::Mutex;
#[cfg(desktop)]
mod tray;

/// Match the Windows 11 title bar to the App background: #e6e8ec with dark
/// text, or #111317 with light text in the dark theme. Older Windows ignores
/// these attributes and keeps the system title bar.
#[cfg(windows)]
fn match_title_bar(window: &tauri::WebviewWindow, dark: bool) {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    // COLORREF is 0x00BBGGRR.
    let (caption, text) = if dark {
        (0x0017_1311u32, 0x00F5_F2F2u32)
    } else {
        (0x00EC_E8E6u32, 0x001F_1D1Du32)
    };
    for (attribute, color) in [(DWMWA_CAPTION_COLOR, caption), (DWMWA_TEXT_COLOR, text)] {
        // SAFETY: hwnd is this App's live window; the value is a 4-byte COLORREF.
        let _ = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute,
                &color as *const u32 as *const core::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            )
        };
    }
}

#[tauri::command]
async fn discover_bridges() -> Result<Vec<halo2_app_support::discovery::Candidate>, Fault> {
    tauri::async_runtime::spawn_blocking(halo2_app_support::discovery::discover)
        .await
        .map_err(|_| Fault::new("DISCOVERY_UNAVAILABLE", "搜尋無法完成，請手動輸入 IP。"))?
}

// Flyout-only window commands. The flyout never calls bridge commands; its
// lighting intents go to the main window's coordinator as events.
#[tauri::command]
fn flyout_open_main(app: tauri::AppHandle) {
    #[cfg(desktop)]
    tray::open_main(&app);
    #[cfg(mobile)]
    let _ = app;
}
#[tauri::command]
fn flyout_hide(app: tauri::AppHandle) {
    #[cfg(desktop)]
    tray::hide(&app);
    #[cfg(mobile)]
    let _ = app;
}
#[tauri::command]
fn flyout_resize(app: tauri::AppHandle, height: f64) {
    #[cfg(desktop)]
    tray::resize(&app, height);
    #[cfg(mobile)]
    let _ = (app, height);
}
#[tauri::command]
fn flyout_quit(app: tauri::AppHandle) {
    app.exit(0);
}
/// The App's light or dark theme for the main window's native title bar.
#[tauri::command]
fn set_window_theme(window: tauri::WebviewWindow, dark: bool) {
    #[cfg(desktop)]
    let _ = window.set_theme(Some(if dark {
        tauri::Theme::Dark
    } else {
        tauri::Theme::Light
    }));
    #[cfg(windows)]
    match_title_bar(&window, dark);
    #[cfg(mobile)]
    let _ = (window, dark);
}

#[derive(Default)]
struct Session(Mutex<Option<Connection>>);
struct Connection {
    bridge: Bridge,
    host: String,
    port: u16,
    username: String,
    password: String,
}
struct Support {
    presets: Presets,
    profiles: Profiles<NativeCredentials>,
    diagnostics: Result<Diagnostics, Fault>,
    export_dir: PathBuf,
    warning: Option<Fault>,
    last_observed_command: Option<String>,
}
type SupportState = StdMutex<Support>;
#[tauri::command]
async fn list_presets(support: State<'_, SupportState>) -> Result<Vec<Preset>, Fault> {
    support
        .lock()
        .map_err(|_| halo2_app_support::storage_error())?
        .presets
        .list()
}
#[tauri::command]
async fn save_preset(
    name: String,
    values: Lighting,
    support: State<'_, SupportState>,
) -> Result<Vec<Preset>, Fault> {
    support
        .lock()
        .map_err(|_| halo2_app_support::storage_error())?
        .presets
        .save(name, values)
}
#[tauri::command]
async fn restore_preset(
    preset: Preset,
    index: usize,
    support: State<'_, SupportState>,
) -> Result<Vec<Preset>, Fault> {
    support
        .lock()
        .map_err(|_| halo2_app_support::storage_error())?
        .presets
        .restore(preset, index)
}
#[tauri::command]
async fn delete_preset(id: String, support: State<'_, SupportState>) -> Result<Vec<Preset>, Fault> {
    support
        .lock()
        .map_err(|_| halo2_app_support::storage_error())?
        .presets
        .delete(&id)
}
fn log(support: &SupportState, event: Event) {
    if let Ok(mut data) = support.lock() {
        let outcome = match &mut data.diagnostics {
            Ok(log) => log.append(event),
            Err(e) => Err(e.clone()),
        };
        if let Err(e) = outcome {
            data.warning = Some(e);
        }
    }
}
fn log_command(support: &SupportState, device: &str, result: &Result<Record, Fault>) {
    log(
        support,
        match result {
            Ok(r) => Event::command(device, r),
            Err(e) => Event::fault(Some(device), e),
        },
    );
}
fn log_snapshot(support: &SupportState, snapshot: &Snapshot) {
    log(support, Event::state(snapshot));
    if let Some(record) = &snapshot.last_command {
        if let Ok(mut data) = support.lock() {
            let key = format!(
                "{}/{}/{}/{}",
                snapshot.device_id, record.boot_id, record.command_id, record.status
            );
            if data.last_observed_command.as_ref() != Some(&key) {
                let result = match &mut data.diagnostics {
                    Ok(log) => log.append(Event::command(&snapshot.device_id, record)),
                    Err(e) => Err(e.clone()),
                };
                match result {
                    Ok(()) => data.last_observed_command = Some(key),
                    Err(e) => data.warning = Some(e),
                }
            }
        }
    }
}

#[tauri::command]
async fn saved_connection(
    support: State<'_, SupportState>,
) -> Result<Option<SavedConnection>, Fault> {
    support
        .lock()
        .map_err(|_| halo2_app_support::storage_error())?
        .profiles
        .saved()
}
#[tauri::command]
async fn remember_connection(
    session: State<'_, Session>,
    support: State<'_, SupportState>,
) -> Result<SavedConnection, Fault> {
    let slot = session.0.lock().await;
    let connection = slot
        .as_ref()
        .ok_or_else(|| Fault::new("NOT_CONNECTED", "請先連線。"))?;
    support
        .lock()
        .map_err(|_| halo2_app_support::storage_error())?
        .profiles
        .save(
            &connection.host,
            connection.port,
            &connection.username,
            &connection.bridge.device_id,
            &connection.password,
        )
}
#[tauri::command]
async fn forget_connection(support: State<'_, SupportState>) -> Result<(), Fault> {
    support
        .lock()
        .map_err(|_| halo2_app_support::storage_error())?
        .profiles
        .forget()
}
#[tauri::command]
async fn connect_saved(
    session: State<'_, Session>,
    support: State<'_, SupportState>,
) -> Result<Snapshot, Fault> {
    let mut slot = session.0.lock().await;
    *slot = None;
    let (profile, password) = {
        let data = support
            .lock()
            .map_err(|_| halo2_app_support::storage_error())?;
        let profile = data
            .profiles
            .saved()?
            .ok_or_else(|| Fault::new("NO_SAVED_CONNECTION", "沒有已儲存的連線。"))?;
        let password = data.profiles.password(&profile)?;
        (profile, password)
    };
    let result = Bridge::connect(
        &profile.host,
        profile.port,
        profile.username.clone(),
        password.clone(),
    )
    .await;
    let (bridge, snapshot) = match result {
        Ok(v) => v,
        Err(e) => {
            log(&support, Event::fault(Some(&profile.device_id), &e));
            return Err(e);
        }
    };
    if bridge.device_id != profile.device_id {
        let error = Fault::new(
            "DEVICE_CHANGED",
            "此位址的裝置識別已改變，請重新輸入帳密連線。",
        );
        log(&support, Event::fault(Some(&profile.device_id), &error));
        return Err(error);
    }
    log_snapshot(&support, &snapshot);
    *slot = Some(Connection {
        bridge,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password,
    });
    Ok(snapshot)
}

#[derive(serde::Serialize)]
struct DiagnosticReport {
    events: Vec<Event>,
    warning: Option<Fault>,
}
#[tauri::command]
async fn diagnostic_history(support: State<'_, SupportState>) -> Result<DiagnosticReport, Fault> {
    let data = support
        .lock()
        .map_err(|_| halo2_app_support::storage_error())?;
    Ok(DiagnosticReport {
        events: data.diagnostics.as_ref().map_err(Clone::clone)?.list(),
        warning: data.warning.clone(),
    })
}
#[tauri::command]
async fn export_diagnostics(support: State<'_, SupportState>) -> Result<String, Fault> {
    let data = support
        .lock()
        .map_err(|_| halo2_app_support::storage_error())?;
    Ok(data
        .diagnostics
        .as_ref()
        .map_err(Clone::clone)?
        .export(&data.export_dir)?
        .to_string_lossy()
        .into())
}
#[tauri::command]
async fn clear_diagnostics(support: State<'_, SupportState>) -> Result<(), Fault> {
    let mut data = support
        .lock()
        .map_err(|_| halo2_app_support::storage_error())?;
    data.diagnostics.as_mut().map_err(|e| e.clone())?.clear()?;
    data.warning = None;
    Ok(())
}

#[tauri::command]
async fn connect_bridge(
    host: String,
    port: u16,
    username: String,
    password: String,
    session: State<'_, Session>,
    support: State<'_, SupportState>,
) -> Result<Snapshot, Fault> {
    let mut slot = session.0.lock().await;
    *slot = None;
    let result = Bridge::connect(&host, port, username.clone(), password.clone()).await;
    let (bridge, snapshot) = match result {
        Ok(v) => v,
        Err(e) => {
            log(&support, Event::fault(None, &e));
            return Err(e);
        }
    };
    log_snapshot(&support, &snapshot);
    *slot = Some(Connection {
        bridge,
        host,
        port,
        username,
        password,
    });
    Ok(snapshot)
}
#[tauri::command]
async fn disconnect_bridge(session: State<'_, Session>) -> Result<(), Fault> {
    *session.0.lock().await = None;
    Ok(())
}
#[tauri::command]
async fn bridge_state(
    session: State<'_, Session>,
    support: State<'_, SupportState>,
) -> Result<Snapshot, Fault> {
    let slot = session
        .0
        .try_lock()
        .map_err(|_| Fault::new("BUSY", "命令處理中。"))?;
    let connection = slot
        .as_ref()
        .ok_or_else(|| Fault::new("NOT_CONNECTED", "請先連線。"))?;
    let result = connection.bridge.snapshot().await;
    match &result {
        Ok(s) => log_snapshot(&support, s),
        Err(e) => log(
            &support,
            Event::fault(Some(&connection.bridge.device_id), e),
        ),
    }
    result
}
#[tauri::command]
async fn set_power(
    device_id: String,
    power: bool,
    session: State<'_, Session>,
    support: State<'_, SupportState>,
) -> Result<Record, Fault> {
    let mut slot = session
        .0
        .try_lock()
        .map_err(|_| Fault::new("BUSY", "命令處理中。"))?;
    let connection = slot
        .as_mut()
        .ok_or_else(|| Fault::new("NOT_CONNECTED", "請先連線。"))?;
    let bridge = &mut connection.bridge;
    if bridge.device_id != device_id {
        return Err(Fault::new("DEVICE_CHANGED", "裝置已變更，請重新整理。"));
    }
    let result = bridge.power(power).await;
    log_command(&support, &device_id, &result);
    result
}
#[tauri::command]
async fn set_light_state(
    device_id: String,
    patch: StatePatch,
    session: State<'_, Session>,
    support: State<'_, SupportState>,
) -> Result<Record, Fault> {
    let mut slot = session
        .0
        .try_lock()
        .map_err(|_| Fault::new("BUSY", "命令處理中。"))?;
    let connection = slot
        .as_mut()
        .ok_or_else(|| Fault::new("NOT_CONNECTED", "請先連線。"))?;
    let bridge = &mut connection.bridge;
    if bridge.device_id != device_id {
        return Err(Fault::new("DEVICE_CHANGED", "裝置已變更，請重新連線。"));
    }
    let result = bridge.set_state(patch).await;
    log_command(&support, &device_id, &result);
    result
}
#[tauri::command]
async fn lookup_command(
    session: State<'_, Session>,
    support: State<'_, SupportState>,
) -> Result<Option<Record>, Fault> {
    let mut slot = session
        .0
        .try_lock()
        .map_err(|_| Fault::new("BUSY", "命令處理中。"))?;
    let connection = slot
        .as_mut()
        .ok_or_else(|| Fault::new("NOT_CONNECTED", "請先連線。"))?;
    let result = connection.bridge.lookup_pending().await;
    match &result {
        Ok(Some(r)) => log(&support, Event::command(&connection.bridge.device_id, r)),
        Err(e) => log(
            &support,
            Event::fault(Some(&connection.bridge.device_id), e),
        ),
        _ => (),
    }
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Session::default())
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            match (window.label(), event) {
                // Closing the main window ends the App, as before; the flyout
                // cannot act without the main window's command coordinator.
                ("main", tauri::WindowEvent::Destroyed) => window.app_handle().exit(0),
                (tray::FLYOUT, tauri::WindowEvent::Focused(false)) => {
                    tray::hide(window.app_handle())
                }
                _ => (),
            }
            #[cfg(mobile)]
            let _ = (window, event);
        })
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                match_title_bar(&window, false);
            }
            #[cfg(desktop)]
            tray::setup(app)?;
            let root = app.path().app_data_dir()?;
            let export_dir = app
                .path()
                .document_dir()
                .unwrap_or_else(|_| root.clone())
                .join("HaloDesk");
            app.manage(StdMutex::new(Support {
                presets: Presets::new(root.join("presets.json")),
                profiles: Profiles::new(root.join("connection.json"), NativeCredentials),
                diagnostics: Diagnostics::new(root.join("diagnostics.json")),
                export_dir,
                warning: None,
                last_observed_command: None,
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            discover_bridges,
            connect_bridge,
            disconnect_bridge,
            bridge_state,
            set_power,
            set_light_state,
            lookup_command,
            saved_connection,
            remember_connection,
            forget_connection,
            connect_saved,
            diagnostic_history,
            export_diagnostics,
            clear_diagnostics,
            list_presets,
            save_preset,
            restore_preset,
            delete_preset,
            set_window_theme,
            flyout_open_main,
            flyout_hide,
            flyout_resize,
            flyout_quit
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start HaloDesk");
}
