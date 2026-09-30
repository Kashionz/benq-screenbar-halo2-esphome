# HaloDesk — Tauri 開發版

Tauri 2 + React/TypeScript + Rust，共用 `bridge-core` 直接連線 ESP32 protocol v1。
本版提供一台橋接器的登入、每 2 秒前景輪詢、電源 ON/OFF 與命令診斷。
主畫面左側是目標示意圖（含電源按鈕與命令狀態）和情境，右側是模式、兩路亮度與色溫；連線狀態顯示在視窗左下角。視窗預設 880×580，最小 760×560，寬度不足時改為單欄。
另提供前／後／雙燈模式、兩路亮度及色溫調整。亮度只能調整模式點亮的燈：前燈模式時後燈滑桿停用、後燈模式時前燈滑桿停用，前後燈模式兩路都可調；未點亮那一路的亮度不會送出，主視窗與系統匣面板相同。橋接器仍會回報各欄位的 verified／experimental 標記，但 App 不再要求另外勾選啟用，只停用 unsupported 欄位。拖曳滑桿、點模式或情境會即時送出，沒有「套用」步驟；尚未被橋接器狀態確認的值，畫面直接顯示調整中的數值，不另外標示。橋接器同一時間只處理一筆命令、間隔至少 500 ms，所以拖曳時會在前一筆完成後送出當下最新的值，中間值直接捨棄、不排隊。已嘗試送出的值無論成功或失敗都不會自動重送；之後若原廠控制器或網頁改了目標，App 也不會送命令去「修正」。命令結果不明、斷線、控制停用或 App 轉到背景時，尚未送出的值會被丟棄。每次送出都是一筆 RF 命令，也會寫入診斷紀錄。電源是單一按鈕，依目前目標送出明確的開燈或關燈，不送切換指令。燈光命令傳送中按電源，會等那筆完成後才送出電源命令，並停止後續的即時燈光傳送；若那筆結果不明則不送出。電源命令傳送中按鈕外觀不變，但重複按下不會再送。燈光卡片底部的「入席感應」開關對應協定的 `ultrasonic_enabled`，與電源相同：依目前目標送出明確的開或關、傳送中鎖定全部控制、不自動重送，開關只顯示橋接器回報的目標值；橋接器標為 experimental 時旁邊顯示「實驗性」。同一張卡片上的「自動調光」開關對應協定的 `auto_dimming`，行為相同；打開時送出原廠按鍵同樣的命令，由掛燈依環境光決定亮度，手動調整亮度會把它關閉（與原廠控制器一致），其他命令不會關掉它。橋接器韌體沒有回報這個欄位時，App 不顯示這個開關。系統匣面板沒有這兩個開關。

## Windows 使用

開發測試版：`target/debug/halodesk.exe`。Release 安裝包：`target/release/bundle/nsis/HaloDesk_0.1.0_x64-setup.exe`。兩者都內嵌前端，不需要開啟 Vite。

Windows 安裝設定為目前使用者，支援繁體中文／英文；缺少 WebView2 時由安裝程式下載官方 runtime。現階段安裝包尚未簽章，屬於開發驗收版本。安裝不會內建橋接器帳密或配對位址；同一使用者的既有 App 設定可繼續使用。

1. 啟動 App，輸入橋接器 IP 或主機名稱，連接埠預設 `8080`。
2. 輸入 ESPHome 網頁相同帳密，按「連線」。也可以先按「搜尋區域網路」選取橋接器，選取只會填入位址並清除密碼。
3. 按電源按鈕（顯示「開燈」或「關燈」）。`指令已送出` 是 RF 完成發送，不是掛燈獨立確認。
4. 結果不明時按「查詢命令結果」。App 不會自動重送 POST。

未勾選「記住此連線與帳密」時，帳密只留在本次 session。勾選後，位址、帳號與預期裝置識別保存在 App 資料目錄，密碼存於 Windows Credential Manager／macOS、iOS Keychain；不寫入 JSON、診斷檔或前端儲存。

下次開啟可按「使用已保存帳密連線」，密碼不回傳前端。連線後會核對裝置識別，位址若變成另一台橋接器，會拒絕建立控制 session。按「忘記已保存連線」會刪除設定與系統憑證；本次已登入 session 可繼續使用，按中斷連線可清除記憶體中的帳密。

若憑證庫拒絕存取，本次成功連線仍可使用，畫面會顯示保存失敗。資料寫入使用原子替換與憑證 ID 清理紀錄，重開時重試未完成清理。只有 Windows 的原生憑證庫已實測，Apple 端仍需驗收。

不可使用瀏覽器預覽直接控制，原生通訊一律在 Rust 執行。前景斷線期間繼續唯讀輪詢，恢復後同步狀態；不自動重送任何燈光命令。

## 診斷紀錄

主畫面右上角的「設定」頁在桌面以左側分頁分成「裝置與連線」「外觀」「診斷紀錄」，手機寬度時三段依序排列。打開「診斷紀錄」時才讀取本機保存的最近 200 筆命令／連線事件與成功、結果不明、失敗的筆數，並可清除或匯出。列表只顯示「命令 · 已送出」這類說明；錯誤碼、TX、IRQ、FIFO 與裝置 JSON 要打開「原始資料」開關才會出現。相同狀態或連續相同網路錯誤不重複寫入；失敗命令保留錯誤碼、發送計數、IRQ 與 FIFO。輪詢也會收錄橋接器回報的最新命令，方便追查其他介面發起的操作。

匯出位置為系統文件目錄下 `HaloDesk/halo2-diagnostics-<UUID>.json`（文件目錄不可取得時使用 App 資料目錄）。畫面顯示完整路徑。檔案含裝置／開機／命令識別及時間，沒有帳號、IP、密碼、HTTP 請求與自由文字錯誤訊息。未儲存成功時顯示警告，RF 操作結果不會因診斷檔寫入失敗而被改寫。

## 開發與檢查

需 Node.js 24、Rust MSVC、C++ Build Tools 與 WebView2；套件版本以 lockfiles 為準。

```sh
npm ci
npm run tauri dev
npm run build
npm test
cargo test -p halo2-bridge-core
cargo test -p halo2-app-support
cargo clippy -p halo2-bridge-core --all-targets -- -D warnings
cargo clippy -p halo2-app-support --all-targets -- -D warnings
npm run tauri build -- --debug --no-bundle
```

Windows bundle 用 `npm run tauri build -- --bundles nsis`；平台設定由 `tauri.windows.conf.json` 合併。簽章與公開發行另行處理。

圖示來源為專案自行繪製的 `app-icon.svg`（「琉璃」設計稿，原檔與 16–32 px 用的 `app-icon-small.svg` 在 `docs/design_handoff_halodesk_liuli/icons/`）。以 `npm run tauri icon -- app-icon.svg --ios-color '#e9ebef'` 重新產生各平台圖示，再以 `npm run tauri icon -- ../docs/design_handoff_halodesk_liuli/icons/app-icon-small.svg -o <暫存目錄> -p 32` 輸出 32 px，複製到 `src-tauri/icons/32x32.png` 與系統匣用的 `src-tauri/icons/tray.png`。它代表本專案，並非 BenQ 官方標誌。

`bridge-core/examples/live_probe.rs` 可使用 `HALO2_HOST`、`HALO2_USERNAME`、`HALO2_PASSWORD` 環境變數測試相同 Rust 核心；預設唯讀，只有明確指定 `--power-on`／`--power-off` 或 `--patch '{"mode":"front"}'` 才送 RF。patch 模式可送出 experimental 欄位（與 App 相同，不需額外旗標），僅供人工監督的實機驗證。

`cargo run --locked -p halo2-bridge-core --example soak -- 900 report.json` 使用相同環境變數進行約 30 分鐘唯讀 LAN 測試（每次回應後間隔 2 秒，逾時會延長總時間）。報告包含完成筆數、連線失敗、開機變化、模組未就緒及延遲統計，不包含帳密或主機位址。必須選擇尚不存在的報告路徑；中途停止的報告保留 `complete=false`。此程式不送 RF，不能證明 RF 控制長期穩定。

## 架構與錯誤語意

- 前端使用受限的 Tauri commands：連線、燈光控制、查詢、設定保存與診斷；沒有任意 URL、檔案路徑或 shell 代理。每個命令都要在 `src-tauri/capabilities/` 明確授權：主視窗可用橋接器命令與設定自己標題列深淺色的命令，系統匣面板只能用事件、`list_presets` 與面板視窗命令。
- Rust 序列化 session 存取，校驗 device_id；每筆 POST 前讀取新 boot/revision。
- 不跟隨 HTTP redirect、不使用環境 proxy；回應上限 8192 bytes。
- POST 回應遺失時保留 command_id/boot_id、禁止新寫入，只以 GET 查詢原結果。
- 認證／不相容協定／未就緒／衝突／逾時分別顯示；未知 status 不映射成功。
- 前端使用 generation 排除已中斷 session 的晚到回應，同 boot 不倒退 state_version。
- 回到前景只同步狀態，不重播背景前的命令。配對私有位址不在 App 內建。

## 平臺與驗收範圍

Windows 已完成本機建置、前端互動測試、Rust 模擬網路測試，以及 Rust 核心對實體 ESP32 的電源、燈光模式、亮度與色溫測試。原生 UI 已驗證登入、保存帳密、重開連線、診斷匯出與前燈亮度套用；使用者確認實際變亮。ESP32 斷電重新上線後，App 恢復同步且未重送命令。

macOS App 與完整 iOS 模擬器 App 已通過 CI 建置；iOS 真機的 Rust library 通過編譯檢查，**尚未完成 Apple 實機操作驗收**。需 Mac、Xcode 16 以上、簽章與 iPhone；在 Mac 執行 `npm run tauri ios init` 後再 `npm run tauri ios dev`。平台 Info.plist 提供本地網路用途與 local networking 宣告，macOS entitlement 允許網路 client；這些設定不能替代實機權限驗證。

Apple Silicon Mac 的完整步驟與結果表見 [Apple 實機驗收](../docs/APPLE_TESTING.md)。

## 情境預設

主畫面「情境」最多 4 組。按「＋ 新增」會以畫面上的模式、點亮那一路（前後燈模式則兩路）的亮度及色溫保存，輸入名稱後按「保存」（Esc 取消）。按「編輯」後點情境右上角的「−」，確認後才刪除；刪除後 6 秒內可按「復原」放回原位置。資料存在本機 App 目錄，沒有帳密或配對資料；不會自動跨裝置同步。舊版情境不論模式都存了兩路亮度，仍可讀取；讀取與帶入時只使用點亮那一路，下次寫檔時改成新格式。儲存檔超過 4 組視為不合法，會顯示錯誤並保留原檔。

點選情境會立即送出與目前目標不同的欄位（一筆命令），電源維持原設定。離線、無線模組未就緒、處理中或命令結果不明時不能點選或新增。載入、保存、刪除與復原情境均不發送 RF，重新開啟也不會自動套用。儲存檔損壞時顯示錯誤並保留原檔。

## 外觀

「設定」→「外觀」可選淺色、深色或跟隨系統；選擇立即生效並保存在本機。系統匣面板跟著主視窗的主題，Windows 主視窗標題列也會換成對應顏色。

## 桌面快捷控制

左鍵點 Windows 系統匣或 macOS 選單列圖示，會開啟快速控制面板：電源、模式、兩路亮度、色溫與情境，調整方式與主視窗相同，都是即時送出。命令狀態顯示在電源按鈕旁，連線狀態在面板底部。面板失去焦點或按 Esc 會隱藏。Windows 面板固定在點擊圖示那個螢幕的工作區右下角（工作列在上方時為右上角，在側邊時為該側底部）；macOS 面板在選單列圖示正下方。尺寸依該螢幕的縮放比例換算，放不下時限制在工作區內並可捲動。右鍵選單只保留「開啟 HaloDesk」與「結束 HaloDesk」。

面板不直接連線橋接器，只把主視窗發佈的狀態顯示出來，並把「開燈／關燈／調整燈光」意圖送回主視窗。主視窗仍是唯一的命令協調者：它會重新檢查停用條件，再走與主畫面相同的命令流程（先等背景讀取、裝置驗證、不自動重送、結果不明時停用）。停用條件與主畫面相同；結果不明時，面板的「查詢」只會開啟主視窗。面板的 Tauri 權限只有事件、讀取情境與它自己的視窗命令，無法呼叫連線、燈光、帳密或診斷命令。

Windows 面板使用透明視窗加系統壓克力背景；macOS 為避免使用私有 API，面板是不透明的矩形視窗。最小化可保留快捷控制；關閉主視窗或選擇結束會退出 App，不會自行改變掛燈。iOS 沒有桌面系統匣。各平台實際操作仍以驗收紀錄為準。

SSE 與自動探索尚未提供。最新功能與實機結果見 [開發驗收紀錄](../docs/DEVELOPMENT_ACCEPTANCE.md)，初期協定驗證見 [協定驗收紀錄](../docs/VALIDATION_2026-09-27.md)。
