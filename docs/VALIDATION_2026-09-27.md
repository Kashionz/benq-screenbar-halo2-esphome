# 2026-09-27 開發驗收紀錄

## HTTP 連線對照

相同 ESP32、AP、電腦，唯讀 `/api/v1/state`，每次新 HTTP 連線，間隔 250 ms，逾時 2 秒；不自動重試、不丟棄失敗樣本。

| 設定 | 次數 | 失敗 | 成功請求 p95 | 成功請求最慢 | boot 改變 |
| --- | ---: | ---: | ---: | ---: | --- |
| Wi-Fi LIGHT | 120 | 1 | 113 ms | 195 ms | 否 |
| Wi-Fi NONE | 300 | 0 | 54 ms | 377 ms | 否 |

基準失敗後，80／6053／8080 的 TCP 探測皆成功。停用省電後的短期結果改善，因此採用 NONE；這是已驗證的緩解設定，不能證明所有過往逾時的唯一根因，也不能代表 24 小時穩定性。可用 `tools/check_connectivity.py` 重現測試。

## 已通過

- 23 項實機 HTTP 契約檢查：認證、錯誤 JSON、大小限制、版本／期限、命令查詢及去重。兩筆電源命令皆一包、IRQ=2E、FIFO=11、transmitted。
- 舊 port-80 Power OFF 經共享 dispatcher 更新 source=legacy、revision 與命令紀錄；接著新 API ON 成功傳送。
- 軟體重啟後配對自動載入、device_id 不變、boot_id 改變、舊 boot 查詢拒絕、無自動 RF 命令。
- FIFO=01 卡住時一次 RC1.RSTLL 恢復為 FIFO=11，後續 ON 的實體亮燈由使用者確認。
- Python 15 項、C++ dispatcher／codec／address learning、Schema 6 組與 5 份實際 C++ encoder 回應通過。
- ESPHome 2026.9.0 編譯及 COM3 115200 刷入，寫入 hash 驗證成功。
- 重啟後約 15 分鐘無 App 命令（uptime 918–922 秒、last_command=null），以 Tauri 共用 Rust 核心送 OFF／ON，兩筆皆 transmitted、IRQ=2E、FIFO=11。
- Tauri Windows debug 執行檔建置、TypeScript/Vite 建置、5 項前端互動測試、6 項 Rust 測試與 core Clippy 通過。Rust 測試含真實 loopback TCP 的回應遺失／查詢恢復與衝突不覆寫。
- 桌面與 390px 窄螢幕瀏覽器版面已檢視。這不替代 Windows 原生 UI／Apple 實機驗收。

## 尚待驗證

- 本次新版原廠控制器／API 交替操作與所有實體 OFF 效果（已請使用者協助）。
- 24 小時運作、AP 斷線與復原；15 分鐘閒置與短期查詢測試不能替代。
- macOS／iOS 建置、安裝、LAN 權限與實機控制；需要 Mac／Xcode。
- SSE 尚未提供，App 使用輪詢。亮度、色溫等維持 experimental。

`TX_DS` 代表本機 RF 發送條件成立；只有使用者觀察的項目標為實體確認。
