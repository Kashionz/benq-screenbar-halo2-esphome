# ScreenBar Halo 2 跨平臺 App 開發規劃

狀態：韌體 polling API、Rust 核心與 Tauri 最小控制頁已實作；Windows 執行檔已建置，共用 Rust 核心已連實體橋接器驗證電源命令。Apple 平臺與長時間驗收尚未完成。使用方式見 [App 說明](../app/README.md)及[協定開發版說明](APP_PROTOCOL_IMPLEMENTATION.md)。

開發前置順序已確定：先完成 [ESP32 ↔ App protocol v1](APP_PROTOCOL_V1.md)、Schema 與行為驗收，再實作最小韌體／Rust client，通過契約測試後才大量開發 App UI。

## 已確認的產品方向

使用者已選定 Tauri 2，建立可共用核心程式的手機、桌面 App，透過區域網路控制現有 ESP32 + BM5602 橋接器。前端建議採 React + TypeScript + Vite，通訊與裝置管理放在 Rust 核心；前端框架是實作建議。燈具本身不直接連上 App；已保存有效配對的橋接器可在原廠控制器未操作時接受 App 指令。

使用者已確認：第一版支援 Windows、macOS、iOS，在同一區域網路直接連線橋接器，不需要 Home Assistant。建議開發順序為 Windows 打通共用流程，再完成 macOS、iOS 整合；三個平臺均通過驗收才算第一版完成。Android、Linux、Web 與外出遠端控制不列入第一版。

第一版以一個橋接器控制一支已配對 Halo 2 為單位。App 的資料模型可保存多個橋接器，但同一橋接器控制多支燈需另行設計韌體。不將第一代 ScreenBar Halo 納入已支援機型。

## 現有能力及限制

- 已有 HTTP 認證、電源、前後燈模式、前後亮度、色溫與超音波感應控制實體。
- 配對位址、CRC 與 PCF 格式已保存於 ESP32，App 不應內建這組私人配對值。
- 舊 `Lamp state` 仍是相容性目標快取；新 API 已將 desired／observed_remote 分開，附帶來源、時間與版本。
- 網頁改為顯示共享處理器採用的目標；HTTP 成功、頁面數值變更、晶片 TX_DS 都不能單獨證明燈具實際變化。
- Power 已有硬體實測；本配對的其他控制項仍需逐項實測才列入正式支援。
- 發送曾出現 MAX_RT 與 TX FIFO 滿，同時接收同步停止。現有清理修正僅完成即時開關驗證，長時間穩定性仍是發行前必要檢查。
- 現有 HTTP 使用 Basic Auth，沒有傳輸加密；帳密須以作業系統安全儲存保管。加密的 ESPHome native API 是另一條介面，不能視為 HTTP 已加密。遠端控制方案需另外設計。

## 第一版功能

| 畫面 | 功能及驗收重點 |
| --- | --- |
| 新增橋接器 | 手動輸入 IP／主機名稱、帳密；測試連線並分辨認證錯誤與離線。自動搜尋是後續便利功能，不能成為連線前提。 |
| 控制頁 | 電源、Front／Back／Both 模式、兩路亮度 1–100、色溫 2700–6500 K（25 K 步進）；未驗證能力標為實驗性或先隱藏。 |
| 狀態區 | 顯示橋接器連線、傳送中／已送出／失敗、最後更新時間；不把快取值標示為燈具即時回報。 |
| 設定頁 | 編輯連線資料、移除裝置、版本資訊；斷線重連不自動重放上次的開關命令。 |
| 診斷頁 | 顯示最後命令結果、Radio status、配對是否已儲存；可匯出去除帳密的診斷紀錄。 |

情境預設、桌面系統匣、快捷鍵、手機 Widget、排程、App 內韌體更新、完整配對精靈列為後續版本。排程若要在 App 關閉時照常執行，需由橋接器或 Home Assistant 等持續運作的服務負責。

## 連線與程式架構

```text
React / TypeScript 畫面
        ↓ Tauri commands / events
Rust：裝置管理 → 命令佇列 → ESPHome HTTP / SSE client
                                    ↓ 區域網路
                          ESP32 韌體 → BM5602 → Halo 2
```

前端負責畫面、輸入驗證與滑桿的即時預覽。Rust 核心統一管理裝置狀態、命令佇列、HTTP 認證、連線及重連策略；畫面透過具型別的 Tauri commands 呼叫核心，核心以 events 回報狀態。前端保存的是核心狀態的呈現副本，避免兩邊各自維護獨立命令佇列。

建議先在本 Repository 的 `app/` 建立 Tauri 2 專案，便於同步調整韌體與 App 契約。若後續需要獨立發布或維護，再拆 Repository。

```text
app/
  src/
    features/devices/     # 新增與選擇裝置
    features/control/     # 控制頁
    features/diagnostics/ # 連線、失敗與除錯資訊
    lib/bridge.ts         # Tauri commands/events 封裝
    types/                # 前後端資料契約
  src-tauri/
    capabilities/         # 各視窗、各平臺所需權限
    src/commands.rs       # 前端可呼叫的有限操作
    src/devices.rs        # 每個橋接器的狀態與佇列
    src/transport.rs      # HTTP / SSE、認證、逾時
    src/credentials.rs    # 憑證儲存介面
    src/models.rs         # 裝置、狀態、命令結果
```

採新設計的 `/api/v1` REST API 與 `/api/v1/events` SSE，由 Rust HTTP client（例如 reqwest）執行請求，再發出精簡 Tauri events。新端點需先在韌體實作，並非現有 ESPHome `/events` 的別名。前端不以 WebView 的 fetch／EventSource 直接連橋接器，讓三個平臺共用認證與串流處理。這個架構不會讓橋接器的 HTTP 自動變成加密，也不免除 OS 的網路權限要求。SSE 需實機驗證斷線恢復及資源占用；必要時退回前景低頻輪詢。App 返回前景時重新同步，不假設 iOS 背景連線持續存在。

Tauri commands 以已登錄的 device_id 接受操作，由 Rust 驗證目標與參數；不提供任意 URL 代理或任意 shell 命令。帳密由 Rust 儲存及使用，正常狀態事件不回傳帳密。安全儲存先驗證三平臺的原生憑證庫方案；Stronghold 可作加密儲存備選，但需另行設計解鎖金鑰的保存，不能把它當作內建 Keychain 自動替代品。

| 操作 | 現有介面 |
| --- | --- |
| 開／關 | `POST /switch/Power/turn_on`、`turn_off` |
| 狀態 | `GET /text_sensor/Lamp%20state`，其 `value` 是另一層 JSON 字串 |
| 發射狀態 | `GET /text_sensor/Radio%20status` |
| 前／後亮度 | `POST /number/Front%20brightness/set?value=...`、`Back%20brightness` |
| 色溫 | `POST /number/Color%20temperature/set?value=...` |
| 模式 | `POST /select/Lamp%20mode/set?option=Front`（或 Back、Both） |

上表只作舊韌體盤點與遷移對照，正式 App 使用版本化 v1 命令與結果；不以舊實體端點作靜默 fallback。

認證、URL 編碼及實體名稱集中在 Rust transport；不能散落於畫面。以現有 ESPHome 2026.9.0 作為第一版相容基準；新增其他版本前以實際回應測試。

每個橋接器全域限制一筆未終結命令。滑桿先更新本地預覽，依 info 公告的最小間隔合併（v1 基準 500 ms），放開時保留最新意圖並依節流送出。接收遠端狀態不觸發新的控制請求。網路逾時以同 ID 查詢／去重，不更換 ID 盲目重放；重啟後則標示結果不明。

## 韌體契約追蹤

下列 1–5 已由 protocol v1 polling 開發版落實；第 6 項通用配對發行方式仍待處理。SSE 不在目前最小實作內。

1. 提供結構化裝置資訊：協定版本、韌體版本、裝置識別與能力清單。
2. 分離 `desired_state` 與 `observed_remote_state`，後者附接收時間或相對經過時間；原廠控制器封包仍不等於獨立燈具確認。橋接器可用 uptime 加 boot_id，避免依賴尚未校時的 UTC。
3. 統一所有控制項的發送結果：至少區分 accepted、transmitted、failed、unknown，保存錯誤類別與時間。晶片 TX_DS 只能映射 transmitted。
4. 為完整狀態命令提供 command_id、狀態 revision 與結構化結果，讓重連及多個客戶端不會把舊結果誤認為新命令成功。新增專用端點需自訂 ESPHome 元件／HTTP handler，不能假設現有 YAML 已具備。
5. 在橋接器端合併及序列化命令，處理 App、網頁與 Home Assistant 同時操作；App 端的佇列只能約束單一客戶端。
6. 通用發行版本應改成每台裝置自己的配對流程與未配對狀態，不能將本 fork 的硬編碼私人預設配對當成所有使用者的預設。

上述需求的具體 wire format、狀態機與期限以 APP_PROTOCOL_V1.md 為準。先完成可測試的契約及最小 dispatcher／HTTP handler，再建立 Rust client；App 不先大量綁定舊端點。

## 開發順序與完成條件

| 階段 | 工作 | 完成條件 |
| --- | --- | --- |
| 0：協定設計 | Wire format、Schema、範例、去重／並行／重啟／錯誤與資源上限 | 契約檢查通過，行為案例可供兩端共同實作 |
| 1：最小韌體及 client | dispatcher、狀態分離、v1 HTTP／SSE、Tauri Rust client | 三平臺能連線及開關；模擬失敗不誤報成功，舊韌體明確要求升級 |
| 2：可用 App | 模式、亮度、色溫、指令合併、裝置保存、診斷 | 逐項硬體驗證；原廠控制器及 App 交替使用不產生回送循環 |
| 3：穩定性 | 重啟、Wi-Fi 中斷、IP 變更、滑桿連拖、兩客戶端與 24 小時運作 | 失敗可辨識及恢復、無過期命令重放；保留實測紀錄，明確區分橋接器在線與燈具確認 |
| 4：跨平臺發行 | Windows、macOS、iOS 權限、安全儲存、打包、簽署與實機測試 | 三個目標 OS 都有實際安裝與控制驗證；Apple 平臺建置環境需另行準備 |

Rust 測試重點為解析現有 JSON／事件格式、401／逾時／未知 TX 結果、滑桿命令合併、多命令先後與斷線重連。前端以 Vitest／React Testing Library 驗證互動與狀態呈現；瀏覽器模擬不能替代 Tauri IPC、原生網路及憑證庫測試。三個平臺均需安裝包與燈具實測。

## 平臺整合與後續決策

Tauri 2 支援 Windows、macOS、iOS；桌面功能與插件不能假設可直接用於 iOS。各 OS 的本地網路存取、HTTP 政策、發現服務、安全儲存及背景生命週期需分別驗證。系統匣、全域快捷鍵只規劃於桌面版。所有候選插件必須檢查三個目標的支援。

Windows 開發需要 Rust MSVC 工具鏈、Microsoft C++ Build Tools 與 WebView2；前端使用 Node.js 工具鏈。Apple 平臺需要 macOS／Xcode、對應 Rust targets 及 iPhone 實機。macOS 與 iOS 須驗證 Keychain、網路權限及必要的沙盒設定。Windows 使用作業系統提供的受保護儲存。具體最低 OS 版本、Mac 建置環境及發行方式（自用安裝或公開發行）在開始平臺整合前確認。

Web 可列為獨立評估項目：瀏覽器跨來源、HTTPS 頁面存取 HTTP 橋接器及本地網路存取限制，會影響直接控制方式。遠端控制則優先評估既有 Home Assistant 或 VPN 整合，再決定是否值得維護雲端服務。

參考：

- [Tauri 2 開發環境與 iOS 前置需求](https://v2.tauri.app/start/prerequisites/)
- [Tauri HTTP Client](https://v2.tauri.app/plugin/http-client/)
- [Tauri Stronghold](https://v2.tauri.app/plugin/stronghold/)
- [ESPHome Web Server API](https://esphome.io/web-api/)
- [本專案狀態](PROJECT_STATUS.md)
