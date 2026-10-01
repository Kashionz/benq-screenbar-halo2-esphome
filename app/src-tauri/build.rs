fn main() {
    // Every app command needs an explicit capability entry, so the tray flyout
    // window can be limited to its own commands (see capabilities/).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "discover_bridges",
            "connect_bridge",
            "disconnect_bridge",
            "bridge_state",
            "set_power",
            "set_light_state",
            "lookup_command",
            "saved_connection",
            "remember_connection",
            "forget_connection",
            "connect_saved",
            "diagnostic_history",
            "export_diagnostics",
            "clear_diagnostics",
            "list_presets",
            "save_preset",
            "restore_preset",
            "delete_preset",
            "set_window_theme",
            "launched_hidden",
            "autostart_enabled",
            "set_autostart",
            "flyout_open_main",
            "flyout_hide",
            "flyout_resize",
            "flyout_quit",
        ]),
    ))
    .expect("failed to run tauri-build");
}
