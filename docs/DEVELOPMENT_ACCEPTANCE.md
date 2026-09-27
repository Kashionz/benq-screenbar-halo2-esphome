# 跨平臺功能開發與實機驗收

目標：依序完成燈光控制、連線與診斷、Windows/macOS/iOS 交付、情境預設與桌面快捷控制及區域網路搜尋。功能存在與 TX_DS 不等於實機驗收完成。

## 狀態

- [x] Windows 前後燈、兩路亮度、色溫與原廠控制器同步：原生 App 與目前配對燈具實測通過；Apple 實機另列。
- [x] Windows 連線資料保存、系統憑證庫、橋接器斷電恢復、可匯出診斷：原生 UI 與實體橋接器驗收通過；Apple 端另列驗收。
- [x] Windows 安裝程式、專案圖示、保存連線與原生開關燈驗收（開發版未簽章）。
- [ ] macOS 建置、權限、系統憑證庫及實機操作。
- [ ] iOS 建置、區域網路權限、前景恢復及實機操作。
- [x] Windows 情境預設與桌面系統匣控制：原生操作及燈具反應通過。
- [ ] 區域網路搜尋、Apple 情境預設與選單列控制。
- [ ] 長時間穩定性及間歇 TX_MAX_RETRIES 調查。

使用者已確認有 Mac 與 iPhone 可供測試；目前自動執行環境是 Windows。

目前開發順序依使用者要求以 Windows 為主，Apple 實機驗收延後；原跨平臺範圍仍保留。

## 2026-09-28 App 介面重構：樣式與主畫面

- 依 `docs/design_handoff_halo_control_acrylic/README.md` 改寫主畫面：單一電源按鈕送出明確的開或關、模式分段控制、三個滑桿、情境膠囊、套用列、燈具預覽、目標清單、最近命令與橫幅。錯誤碼不再出現在主畫面。
- 移除「啟用實驗性控制」開關。`bridge-core` 對燈光欄位只拒絕 unsupported，電源仍必須是 verified；韌體仍回報 experimental，協定與 `examples.json` 未變更。
- 前端 39 項測試、`bridge-core` 測試與兩個 crate 的 clippy 通過。命令流程（先等背景讀取、不自動重送、結果不明時停用）沿用既有程式。
- 只以瀏覽器搭配模擬資料檢查版面；尚未在原生 App 或實體燈具上操作，沒有新的燈具行為驗收。

## 2026-09-27 Windows 情境套用實測

- 已安裝原生 App 先套用前燈 70%、2700 K，命令 `098a682e-cc1d-4c21-b2fb-d50565e86972` 為 1/1 TX_DS、IRQ 2E/FIFO 11。使用者回覆「燈光有變化了」；未額外聲稱光度或色溫經儀器量測。
- 帶入已保存的「目前桌面」後，App 草稿顯示前燈 35%、後燈 50%、5500 K。唯讀 snapshot 仍為前燈 70%、2700 K，命令 ID 與 control_revision=2 不變，確認帶入未發送。
- 接著透過原生 App 按套用，命令 `57db51cd-b58f-4ab6-98db-132b6eeb05d6` 回報 1/1 TX_DS、IRQ 2E/FIFO 11；control_revision=3，目標前燈 35%、後燈 50%、5500 K，電源仍 ON。使用者確認「是，亮度與色溫都恢復」，Windows 情境的保存、重開、帶入不發送及實際套用流程通過。
- 最新 Windows [App CI 36319142788](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/runs/36319142788) 與 [韌體 CI 36319142772](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/runs/36319142772) 已成功；Windows CI 涵蓋前端、Rust 核心與 support 測試、clippy 及 Tauri debug 建置。
- 原廠控制器同步：使用者切成只開後燈並調亮度後，snapshot 顯示 desired.source=remote、mode=back、back_brightness=60、control_revision=9，observed_remote 一致。Windows 原生畫面實際顯示「後燈」、60% 與「原廠控制器最近操作」，確認同步已到 UI，非僅 API 讀取。
- 原生 App 切換前後燈：命令 `ff671e69-f1e2-4747-b396-3c2c3aef4ebf`，前 35%、後 60%、5500 K，1/1 TX_DS、IRQ 2E/FIFO 11。使用者確認「是，前後都亮」。
- 原生 App 改為只開後燈 20%：命令 `83b49c2f-48a8-40a3-8100-ee011a76ea03`，1/1 TX_DS、IRQ 2E/FIFO 11，control_revision=11。使用者確認「是，只有較暗的後燈」，模式與後燈亮度實測通過。
- 測試結束後以同一情境恢復前燈 35%、後燈設定 50%、5500 K，命令 `82823ee9-1136-4d00-8d7c-8f27d0054361` 回報 1/1 TX_DS，control_revision=12。此最後一次恢復僅記錄發送結果；情境實際燈光驗證以上方使用者確認為依據。
- 同批 [Apple CI 36319142766](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/runs/36319142766) 已成功；Apple 實機操作仍依使用者要求延後，不以建置成功代替實機驗收。

## 2026-09-27 情境預設初版

### 桌面快捷控制

- Windows 系統匣／macOS 選單列新增明確開燈、關燈、開啟視窗與結束功能。事件送回既有命令協調器，保留等待背景讀取、裝置驗證、忙碌與結果不明的防護。
- 前端 16 項測試、Windows locked cargo check 與 clippy 通過，release／NSIS 建置成功；iOS 使用條件編譯排除系統匣。
- 更新安裝 exit code 0，原生 App 啟動、保存帳密連線、橋接器 ready 已確認。新安裝包 SHA-256：`F2222CCA21B29FC3E1A042691347315DBB4D8FC8A7BF5301E9DCE138FCCB786E`。
- Windows 自動化工具沒有提供系統匣視窗；使用者實際按快捷關燈、開燈並回覆「都有變化」。隨後原生 App 顯示「指令已送出」、目標開啟前燈，Windows 系統匣電源操作通過。macOS 選單列仍待實機操作。
- 含系統匣的版本已通過 [Apple CI 36315956344](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/runs/36315956344)：macOS bundle、iOS Rust 目標及完整模擬器 App；未代替 macOS 選單列或 iPhone 實機操作。

### 情境保存

- 加入最多 20 組本機情境，保存模式、兩路亮度與色溫；電源不存入情境。選取帶入草稿，需明確按套用，仍受 experimental／offline／未知命令結果限制。
- 儲存採原子寫入，檔案上限 32 KiB，檢查格式版本、名稱、ID 與數值範圍；損壞檔案不自動覆寫。
- 前端 14 項與儲存模組 8 項測試通過，clippy 無警告，Windows release／NSIS 建置成功。
- 安裝更新 exit code 0；原生 UI 使用既有保存帳密連線，建立「目前桌面」（前燈模式、前 35%、後 50%、5500 K）。退出整個 App 程序後再開啟、連線、展開情境，確認資料仍在。此流程未按套用，沒有拿保存測試宣稱 RF 控制成功。
- 本批安裝包 SHA-256：`CCECD844A6A12CCFA2EBBFD663157C618E23B25101110DDD7757B172FA6A026E`。
- Windows 情境原生實際套用已通過，證據見本文件「Windows 情境套用實測」。仍待 Apple 情境保存。Windows 系統匣已通過、macOS 選單列待驗收；LAN 搜尋進度見下節。
- 900 次唯讀 LAN 測試已完成，結果見下節；不代表 RF 長時間穩定已驗收。

## 2026-09-27 約半小時唯讀 LAN 測試

[公開彙總報告](evidence/lan-soak-2026-09-27.json) 排除裝置與開機 UUID，保留原始量測統計。原始本機報告位於 ignored `.esphome/lan-soak-20260927.json`，程序正常結束、`complete=true`。

- 900 次 snapshot 查詢，耗時 1,848,365 ms（約 30 分 48 秒）。成功 894 次，NETWORK 失敗 6 次，其餘錯誤 0。
- 最長連續失敗 1 次，皆在後續唯讀輪詢恢復。沒有橋接器開機變化，也未觀察到 radio 非 ready。
- 平均每次請求延遲 45 ms、最大 2016 ms，統計含失敗請求。
- 測試期間原生 App 也有連線輪詢、重新開啟及使用者操作系統匣；探測程式本身完全不送 RF。不能據此隔離網路逾時原因、宣稱零斷線，或代替 24 小時／RF 壓力與 MAX_RT 調查。
- mDNS 韌體更新在測試程序完成後才開始，未混入此次開機穩定性結果。

## 2026-09-27 LAN 服務宣告

- 已加入 `_halo2-bridge._tcp.local.`，編譯與 OTA 成功；重開後 API ready、pairing_persisted=true、desired.source=restored、last_command=null。
- 實機單播 DNS-SD 確認 PTR／SRV／TXT／A 宣告正確，8080 連接埠與 API 一致。一般與指定 Wi-Fi 的 multicast 搜尋未找到，原因仍待定位；不將其標為搜尋完成。
- App 已加入 Windows DNS-SD、Apple Bonjour 與明確搜尋／選取介面；Windows 唯讀核心在 5004 ms 返回空候選，真實 multicast 搜尋仍未通過。契約及實測範圍見 [LAN 搜尋](LAN_DISCOVERY.md)。
- 新增搜尋版本檢查、候選上限／去重／移除、並行搜尋拒絕與選取不登入／不發送／清除密碼的測試。Windows support 11 項、前端 19 項及 Tauri clippy 通過；Apple 新版建置與原生搜尋驗收待完成。
- 原生檢查另發現橋接器重開後仍顯示前一次 boot 的成功結果；已修正 snapshot 更新時清除舊命令結果。增加不重播命令的回歸測試後，前端共 20 項通過，歷史診斷不刪除。
- Apple CI 首次因找不到獨立 dns_sd 庫失敗，改以 libSystem 連結後，[修正版 CI 36317392509](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/runs/36317392509) 全部成功：macOS Rust 測試與 App bundle、兩個 iOS Rust 目標、完整 iOS 模擬器 App 及 Bonjour／LAN／文件權限宣告。TXT 解析移至跨平台測試，Windows support 現為 12 項通過。這不代表搜尋、權限或控制已在 Apple 實機驗收。
- Windows 更新安裝 exit code 0，安裝包 SHA-256：`4901E3161636DCBB3044E43DADA6785A5E4B9AA27854BF7AADECD3E34695C2B2`。原生啟動可見搜尋按鈕與保存連線，未自動登入。
- 原生按搜尋後出現 Windows 安全性／防火牆提示，要求允許 Halo 2 Control 的網路存取；背景可見空結果提示與手動 IP 表單。權限提示交由使用者操作，目前尚未確認允許後的搜尋與登入，不自動調整防火牆。

## 2026-09-27 安裝包與 Apple 建置

- Windows x64 release 與 NSIS 安裝包建置成功，採 currentUser、繁體中文／英文、官方 WebView2 bootstrapper，未簽章。
- 安裝程序 exit code 0，版本 0.1.0；已安裝 App 可啟動並使用開發版保存的帳密連線。執行檔與建置檔只差 Tauri 打包時的 `UNK` → `NSS` 三位元組 bundle 標記。
- 安裝版關燈命令 `053172ca-9188-4849-a10e-4ca081706872` 回報 1/1 TX_DS，使用者確認熄滅。
- 原生測試發現按鈕與背景讀取重疊時回報 BUSY，命令未送出。已修正前端先等待既有讀取、發送期間暫停輪詢；讀取失敗則不送命令，不自動重試 POST。新增兩項回歸測試，前端共 11 項通過。
- 修正版 release 重新建置、覆蓋安裝 exit code 0、保存帳密仍可連線。開燈命令 `7ab06ce8-c299-4b33-b339-66076a107da8` 回報 1/1 TX_DS，IRQ 2E/FIFO 11；使用者確認燈亮起。
- 本次安裝包 SHA-256：`544FD06B5A7DBDF614CE96A1C8AD169D31FC218C419B78148C936D681C62D6F7`。產物為 `app/target/release/bundle/nsis/Halo 2 Control_0.1.0_x64-setup.exe`；後續重新建置需重新記錄雜湊。
- [Apple CI 36313722538](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/runs/36313722538) 全部成功：macOS App bundle、iOS 真機／模擬器 Rust library 檢查與前端／Rust 測試。這不代表 iOS Xcode App 已建置，也不代表 Apple 實機驗收通過。
- 使用者確認為 Apple Silicon Mac，已安裝 Xcode，可 USB 連接 iPhone；操作步驟見 [Apple 實機驗收](APPLE_TESTING.md)。
- 後續 [Apple CI 36314887598](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/runs/36314887598) 已完成完整 iOS 模擬器 App 建置及產生後的 LAN／文件共享權限宣告檢查。先前 Xcode 15.4 無法開啟 project format 77，改用 Xcode 16.2 後通過；尚未啟動模擬器 App 或完成 Apple 實機驗收。

## 2026-09-27 燈光實測

透過與 App 共用的 Rust Bridge::set_state 與實體橋接器測試，尚不代替原生 UI 點擊驗收。保留現有 capabilities 的 experimental 標記，避免將單一配對結果套用所有裝置。

| 測試 | 命令 ID | 發送結果 | 使用者實際觀察 |
| --- | --- | --- | --- |
| 前燈、30%、2700 K、電源 ON | 95a7aca8-ec61-43e1-971b-ed37c2ee436b | 2/2 TX_DS，IRQ 2E/FIFO 11 | 已確認只開前燈且變暖 |
| 前燈 80%、6500 K | 619848f8-60eb-4e00-b397-00746a8e5798 | 1/1 TX_DS，IRQ 2E/FIFO 11 | 已確認變亮且冷白 |
| 後燈、20%、3925 K | 34f3acbf-2883-400e-ae89-1985268e97e0 | 1/1 TX_DS，IRQ 2E/FIFO 11 | 已確認只剩較暗後燈 |
| 前後同開、前 40%／後 80% | 5b715b35-d6a6-4b54-ae3f-780ccf20551e | TX_MAX_RETRIES，IRQ 1E/FIFO 01，0/1 發送 | 不列成功 |
| 新命令：前後同開、前 40%／後 80% | 53f3622c-8e43-470d-b220-67d82fe56842 | 邏輯復原 FIFO 01→11，1/1 TX_DS | 已確認前後都亮、後燈變亮 |

原廠控制器交替測試：使用者回覆已改成只開前燈並調亮度；隨後 Rust 唯讀取得 desired.source=remote、mode=front、front_brightness=50，observed_remote 同樣為 front/50，control_revision=40，radio=ready。確認接收同步進入共用 API；新版原生 UI 點擊仍待驗收。

自動檢查：Rust 7 項測試通過、核心 clippy 無警告；前端新增草稿不發送、只提交修改欄位、遠端更新不覆蓋草稿與停用狀態測試。

第一個探測程序在 connect 階段 NETWORK 失敗，未發送命令；三次唯讀狀態查詢成功後重新發起明確的新測試。這表示先前短期 HTTP 無逾時結果不能解讀為永久排除連線問題。

滑桿設計：拖曳只修改本地草稿，按套用才發送，只提交修改過的欄位。Rust 仍限制最短命令間隔 500ms，禁止未知結果時發送新命令，檢查最新能力與合法範圍，使用既有 revision/deadline 契約。

## 2026-09-27 保存與診斷驗證

- 原生儲存介面採 keyring 3.6.3，明確啟用 windows-native／apple-native；不允許未支援平臺落入 mock store。依據 [官方儲存介面文件](https://docs.rs/keyring/3.6.3/keyring/)。
- 使用真實 Windows Credential Manager 保存橋接器帳密；JSON 檔不含密碼。
- 結束保存程序，另一程序不提供帳密環境變數，從憑證庫取回後唯讀連線實體橋接器。device_id 與原保存值一致、radio=ready。
- 第三程序執行忘記連線，確認設定已移除、原生憑證再也無法取回。測試資料使用獨立目錄，不覆寫 App 的使用者設定。
- 實際匯出診斷 JSON 成功；這組探測沒有發送 RF，不能用來聲稱燈光控制的 UI 已驗收。
- 儲存模組 6 項測試通過：設定不含密碼、替換與刪除、清理失敗可重試、損壞設定不覆寫、診斷去除任意訊息、200 筆上限／重開讀取、連續錯誤去重（其中部分合併於同項測試）。
- 前端共 9 項測試通過，新增保存資料載入不自動連線／不發送命令、憑證保存失敗不破壞已成功 session。
- 原生 App：使用者登入並勾選記住後，完整關閉程序再啟動；密碼欄保持空白，按「使用已保存帳密連線」成功連回同一台橋接器。
- 原生滑桿由前燈 10% 調到 35%，套用前唯讀 API 仍為 10%；套用後命令 `cc58bd29-a162-4881-a3be-3f5aa720a462` 回報 1/1 TX_DS，IRQ 2E/FIFO 11。使用者確認燈具確實變亮。
- 原生「匯出診斷 JSON」成功寫入系統文件目錄 Halo2Control；實際解析匯出檔為 halo2-diagnostics-v1，含該次成功命令。相同命令可能分別從即時回應與後續輪詢收錄，分析應依 command_id 合併。
- 使用者將 ESP32 USB 電源拔掉約 10 秒後插回。App 記錄 NETWORK 後恢復 ready；boot_id 從 `4936a9f3-5e61-4532-b504-12c5f2ebaabe` 改成 `89c0371d-377f-4eb8-a2de-c35e52b294eb`，device_id 不變、pairing_persisted=true。前景 UI 同步新狀態並清除舊 observed_remote，無需重新登入或學習。
- 重開後 desired.source=restored、前燈 35%、後燈 50%、5500 K；last_command=null，確認這次恢復未自動重送控制命令。此測試未涵蓋 AP 中斷或命令發送途中斷電。
- 待驗收：Apple Keychain；AP 斷線／換網路、命令結果不明時恢復與長時間穩定性。

## 2026-09-27 RF 穩定性測試未通過

- 有界測試預定 20 次，首筆回報 `TX_MAX_RETRIES`（IRQ `1E`／FIFO `01`），立即停止且沒有重送；成功 0 次。詳見 [測試方式與失敗證據](RF_STABILITY.md)。
- 已通過的後燈 20% 與其他互動控制實測仍有效，但不能據此宣稱間歇性 RF 故障已修復。
- 工具新增停止條件、單次 POST、非同步結果查詢與明確 opt-in 測試；Python 測試共 24 項通過。
