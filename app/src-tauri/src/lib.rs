use halo2_bridge_core::{Bridge, Fault, Record, Snapshot};
use tauri::State;
use tokio::sync::Mutex;

#[derive(Default)]
struct Session(Mutex<Option<Bridge>>);

#[tauri::command]
async fn connect_bridge(
    host: String,
    port: u16,
    username: String,
    password: String,
    session: State<'_, Session>,
) -> Result<Snapshot, Fault> {
    let mut slot = session.0.lock().await;
    *slot = None;
    let (bridge, snapshot) = Bridge::connect(&host, port, username, password).await?;
    *slot = Some(bridge);
    Ok(snapshot)
}
#[tauri::command]
async fn disconnect_bridge(session: State<'_, Session>) -> Result<(), Fault> {
    *session.0.lock().await = None;
    Ok(())
}
#[tauri::command]
async fn bridge_state(session: State<'_, Session>) -> Result<Snapshot, Fault> {
    let slot = session
        .0
        .try_lock()
        .map_err(|_| Fault::new("BUSY", "命令處理中。"))?;
    slot.as_ref()
        .ok_or_else(|| Fault::new("NOT_CONNECTED", "請先連線。"))?
        .snapshot()
        .await
}
#[tauri::command]
async fn set_power(
    device_id: String,
    power: bool,
    session: State<'_, Session>,
) -> Result<Record, Fault> {
    let mut slot = session
        .0
        .try_lock()
        .map_err(|_| Fault::new("BUSY", "命令處理中。"))?;
    let bridge = slot
        .as_mut()
        .ok_or_else(|| Fault::new("NOT_CONNECTED", "請先連線。"))?;
    if bridge.device_id != device_id {
        return Err(Fault::new("DEVICE_CHANGED", "裝置已變更，請重新整理。"));
    }
    bridge.power(power).await
}
#[tauri::command]
async fn lookup_command(session: State<'_, Session>) -> Result<Option<Record>, Fault> {
    let mut slot = session
        .0
        .try_lock()
        .map_err(|_| Fault::new("BUSY", "命令處理中。"))?;
    slot.as_mut()
        .ok_or_else(|| Fault::new("NOT_CONNECTED", "請先連線。"))?
        .lookup_pending()
        .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Session::default())
        .invoke_handler(tauri::generate_handler![
            connect_bridge,
            disconnect_bridge,
            bridge_state,
            set_power,
            lookup_command
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Halo 2 Control");
}
