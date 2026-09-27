# 跨平臺功能開發與實機驗收

目標：依序完成燈光控制、連線與診斷、Windows/macOS/iOS 交付、情境預設與桌面快捷控制及區域網路搜尋。功能存在與 TX_DS 不等於實機驗收完成。

## 狀態

- [ ] 前後燈、兩路亮度、色溫與原廠控制器同步：程式已新增，逐項驗收中。
- [x] Windows 連線資料保存、系統憑證庫、橋接器斷電恢復、可匯出診斷：原生 UI 與實體橋接器驗收通過；Apple 端另列驗收。
- [x] Windows 安裝程式、專案圖示、保存連線與原生開關燈驗收（開發版未簽章）。
- [ ] macOS 建置、權限、系統憑證庫及實機操作。
- [ ] iOS 建置、區域網路權限、前景恢復及實機操作。
- [ ] 情境預設、桌面系統匣控制、區域網路搜尋。
- [ ] 長時間穩定性及間歇 TX_MAX_RETRIES 調查。

使用者已確認有 Mac 與 iPhone 可供測試；目前自動執行環境是 Windows。

## 2026-09-27 情境預設初版

- 加入最多 20 組本機情境，保存模式、兩路亮度與色溫；電源不存入情境。選取帶入草稿，需明確按套用，仍受 experimental／offline／未知命令結果限制。
- 儲存採原子寫入，檔案上限 32 KiB，檢查格式版本、名稱、ID 與數值範圍；損壞檔案不自動覆寫。
- 前端 14 項與儲存模組 8 項測試通過，clippy 無警告，Windows release／NSIS 建置成功。
- 安裝更新 exit code 0；原生 UI 使用既有保存帳密連線，建立「目前桌面」（前燈模式、前 35%、後 50%、5500 K）。退出整個 App 程序後再開啟、連線、展開情境，確認資料仍在。此流程未按套用，沒有拿保存測試宣稱 RF 控制成功。
- 本批安裝包 SHA-256：`CCECD844A6A12CCFA2EBBFD663157C618E23B25101110DDD7757B172FA6A026E`。
- 待驗收：情境的原生實際套用與燈光觀察、Apple 情境保存。桌面系統匣與 LAN 搜尋尚未實作。
- 900 次唯讀 LAN 測試正在執行，報告仍為 `complete=false`；期間已觀察到單次網路逾時後恢復，不能宣稱全程無斷線或 RF 長期穩定。

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
