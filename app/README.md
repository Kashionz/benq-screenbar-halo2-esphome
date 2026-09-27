# Halo 2 Control — Tauri 開發版

Tauri 2 + React/TypeScript + Rust，共用 `bridge-core` 直接連線 ESP32 protocol v1。
本版提供一台橋接器的登入、每 2 秒前景輪詢、電源 ON/OFF、原廠控制器觀察與命令診斷。

## Windows 使用

已建置的本機測試版：`target/debug/halo2-control.exe`。它內嵌前端，不需要開啟 Vite。

1. 啟動 App，輸入橋接器 IP 或主機名稱，連接埠預設 `8080`。
2. 輸入 ESPHome 網頁相同帳密，按「連線橋接器」。
3. 按開燈／關燈。`指令已送出` 是 RF 完成發送，不是燈具獨立確認。
4. 結果不明時按「查詢命令結果」。App 不會自動重送 POST。

帳密只留在記憶體，關閉或中斷連線即移除本次 session；尚未提供「記住密碼」或多裝置保存。使用者需於下次開啟重新登入。不可使用瀏覽器預覽直接控制，原生通訊一律在 Rust 執行。

## 開發與檢查

需 Node.js 24、Rust MSVC、C++ Build Tools 與 WebView2；套件版本以 lockfiles 為準。

```sh
npm ci
npm run tauri dev
npm run build
npm test
cargo test -p halo2-bridge-core
cargo clippy -p halo2-bridge-core --all-targets -- -D warnings
npm run tauri build -- --debug --no-bundle
```

正式 bundle 用 `npm run tauri build`；簽章與發行安裝包另行處理。

`bridge-core/examples/live_probe.rs` 可使用 `HALO2_HOST`、`HALO2_USERNAME`、`HALO2_PASSWORD` 環境變數測試相同 Rust 核心；預設唯讀，只有明確指定 `--power-on`／`--power-off` 才送 RF。

## 架構與錯誤語意

- 前端僅使用受限的 Tauri commands：connect、disconnect、state、power、lookup；沒有任意 URL 或 shell 代理。
- Rust 序列化 session 存取，校驗 device_id；每筆 POST 前讀取新 boot/revision。
- 不跟隨 HTTP redirect、不使用環境 proxy；回應上限 8192 bytes。
- POST 回應遺失時保留 command_id/boot_id、禁止新寫入，只以 GET 查詢原結果。
- 認證／不相容協定／未就緒／衝突／逾時分別顯示；未知 status 不映射成功。
- 前端使用 generation 排除已中斷 session 的晚到回應，同 boot 不倒退 state_version。
- 回到前景只同步狀態，不重播背景前的命令。配對私有位址不在 App 內建。

## 平臺與驗收範圍

Windows 已完成本機建置、前端互動測試、Rust 模擬網路測試，以及 Rust 核心對實體 ESP32 的 OFF/ON（均 transmitted）。瀏覽器做過版面檢查；Windows 原生 UI 的人工登入點擊驗收仍待進行。

macOS／iOS 共用程式與 LAN 用途描述已準備，**尚未在 Apple 平臺建置或實測**。需 Mac、Xcode、簽章與 iPhone；在 Mac 執行 `npm run tauri ios init` 後再 `npm run tauri ios dev`。`Info.plist` 提供本地網路用途與 local networking 宣告，macOS entitlement 允許網路 client；這些設定不能替代實機權限驗證。

亮度／色溫、SSE、自動探索、OS 安全憑證保存與背景控制未包含在本最小版本。測試結果見 [驗收紀錄](../docs/VALIDATION_2026-09-27.md)。
