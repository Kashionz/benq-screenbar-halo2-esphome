; NSIS hooks for the Tauri installer (tauri.windows.conf.json).

; Launch at login (tauri-plugin-autostart) writes two per-user values named
; after the product: the HKCU Run entry and its Task Manager startup state.
; Tauri's uninstaller already removes the Run entry; remove both here so
; nothing is left behind. Updates keep them, like the Run entry.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  ${EndIf}
!macroend
