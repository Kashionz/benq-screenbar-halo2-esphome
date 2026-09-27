use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

pub struct Controls {
    on: MenuItem<tauri::Wry>,
    off: MenuItem<tauri::Wry>,
}
impl Controls {
    pub fn set_enabled(&self, enabled: bool) -> tauri::Result<()> {
        self.on.set_enabled(enabled)?;
        self.off.set_enabled(enabled)
    }
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "halo-show", "開啟 Halo 2 Control", true, None::<&str>)?;
    let on = MenuItem::with_id(app, "halo-on", "開燈", false, None::<&str>)?;
    let off = MenuItem::with_id(app, "halo-off", "關燈", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "halo-quit", "結束 Halo 2 Control", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &on, &off, &quit])?;
    let mut builder = TrayIconBuilder::with_id("halo-control")
        .tooltip("Halo 2 Control")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "halo-show" => show(app),
            "halo-on" | "halo-off" => {
                show(app);
                // The existing frontend coordinator waits for in-flight reads,
                // guards unknown outcomes and never automatically retries POST.
                let _ = app.emit_to("main", "halo-tray-power", event.id.as_ref() == "halo-on");
            }
            "halo-quit" => app.exit(0),
            _ => (),
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.manage(Controls { on, off });
    Ok(())
}
