# 區域網路搜尋契約

此功能只協助填入連線位址，不取代登入或裝置識別。手動 IP／主機名稱始終可用。

## 橋接器宣告

- DNS-SD 類型：`_halo2-bridge._tcp.local.`。
- SRV：ESPHome 主機名稱與 App API 連接埠；範例 YAML 以同一個 anchor 維持 API 與宣告連接埠一致。
- TXT：`api=1`、`model=screenbar-halo2-bridge`。不廣播帳密、RF 配對資料或燈光狀態。
- 宣告只表示候選服務，不能證明 API 目前可用或設備可信。認證後的 `/api/v1/info` 與保存的 `device_id` 才用來核對控制對象。

服務透過 [ESPHome 自訂 mDNS 服務](https://esphome.io/components/mdns/#services) 發布；同子網路與可通過 multicast 的環境才有機會搜尋到。路由器隔離、VPN 或權限拒絕時應提供清楚結果並保留手動連線。

## App 搜尋與選取

1. 使用者明確按搜尋才開始，單次最多 5 秒；同時只能有一個搜尋。離開畫面不自動重啟。
2. 不掃整個子網路，也不把保存帳密傳給搜尋結果。只瀏覽固定服務類型、解析候選位址。
3. 回傳最多 20 個候選；顯示名稱、主機、連接埠。驗證字串長度、連接埠與主機格式，忽略不相容 TXT，清除移除事件對應候選。
4. 選取只填入主機與連接埠，清除正在輸入的密碼，不連線、不送 RF。使用者按連線才使用當次輸入帳密。
5. 保存連線仍走原本的裝置 UUID 核對；不憑 mDNS 名稱或 IP 覆寫保存資料。

## 平台與驗收

- Windows：優先完成本機 DNS-SD 瀏覽、候選填入及手動 fallback；測試服務與真實橋接器分別驗收。
- macOS／iOS：需驗證 Bonjour 與 OS LAN 權限。iOS 使用原生 Bonjour 瀏覽，宣告固定服務的 `NSBonjourServices`，不依賴需要額外 multicast entitlement 的任意 UDP 掃描。平台限制依 [Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)。
- 實機驗收：至少找到真實橋接器、選取不送出、登入後控制成功；無候選、拒絕權限／斷線有可理解回應；多候選不自動選擇或發送帳密。

## 2026-09-27 韌體實測

ESPHome 2026.9.0 編譯成功，OTA 更新成功。重開後 API 與配對皆 ready、配對仍持久保存，目標設定由 restored 載入，沒有自動重送命令。

對實體橋接器的 UDP 5353 單播 DNS-SD 查詢得到正確 PTR、SRV（8080）、TXT（上述兩個欄位）及主機 A record，確認服務已註冊。一般 Zeroconf 五秒搜尋、指定實際 Wi-Fi 介面的搜尋及 multicast 查詢則沒有結果；不能把單播查詢成功視為自動搜尋已驗收。尚未區分 OS、AP／路由器 multicast 或韌體介面行為，未修改防火牆或路由設定。

App 已加入明確的「搜尋區域網路橋接器」按鈕。Windows 使用 mdns-sd 0.21.4；macOS／iOS 使用系統 DNSServiceBrowse／DNSServiceResolve，並宣告 NSBonjourServices。Apple 介面依據 [Bonjour 公開標頭](https://github.com/apple-oss-distributions/mDNSResponder/blob/main/mDNSShared/dns_sd.h)。搜尋使用獨立工作執行緒，不接觸控制 session 或憑證。

Windows 共用搜尋核心實測 5004 ms 返回空候選；沒有向任何候選登入、發送 HTTP 或 RF。這確認逾時路徑可用，仍不代表真實 multicast 搜尋已通過。原生畫面與三平台完整搜尋驗收仍待完成。

另以同一台 Windows 的 Zeroconf 暫時宣告 `TEST ONLY` 測試服務，Rust 搜尋 5006 ms 仍為空；測試服務於 25 秒後移除，沒有 HTTP 服務或認證。此結果也未能驗證候選成功路徑，不能據此將問題歸因於燈具或 ESP32。

原生安裝版實際按搜尋後，Windows 防火牆提示封鎖 Halo 2 Control 部分功能；背景已顯示未找到橋接器與手動連線表單。此為實際觀察到的權限阻擋線索，仍需使用者處理提示後重試，不能直接宣稱所有空結果均由防火牆造成。

後續使用者回覆「已允許」，原生 App 重新搜尋仍為空。按「使用已保存帳密連線」成功，UI 顯示橋接器已連線、無線模組就緒、配對已保存；單播 DNS-SD 查詢再次取得正確服務記錄。可確認空結果沒有阻止既有 IP 連線，尚無證據將剩餘問題歸因於防火牆、App 或 AP。已請使用者在同網路 Mac 用 `dns-sd -B _halo2-bridge._tcp local.` 做對照，結果待回報。

可在 `app` 目錄執行 `cargo run --locked -p halo2-app-support --example discover`，唯讀輸出耗時與候選，無需帳密。候選只接受符合契約的 `.local` 主機；名稱與位址格式、連接埠、TXT 版本都會檢查。Windows 與 Apple 都處理移除事件，Apple callback 的 TXT 長度與解析數量亦有界限。

## Windows 優先：系統 DNS-SD 後端

使用者選擇先以 Windows 為主，Mac 對照及 Apple 實機驗證延後。

修正測試服務的宣告位址為實際 Wi-Fi 位址後，同一個 `TEST ONLY` 服務能被 Windows `DnsServiceBrowse` 與既有 Bonjour 找到，原 mdns-sd App 仍無候選。因此 Windows 後端改用系統 `DnsServiceBrowse`，不需額外安裝 Bonjour。前述使用 loopback 位址的測試不能作為網路 multicast 判斷依據。

- 固定查詢類型、五秒總期限、最多 20 筆候選；只接受 PTR、SRV、相容 TXT 的完整組合，處理 goodbye／刪除及重複 TXT。
- 取消搜尋後依 [Microsoft API 契約](https://learn.microsoft.com/en-us/windows/win32/api/windns/nf-windns-dnsservicebrowsecancel) 等待最終 `ERROR_CANCELLED` callback；若作業延遲完成，保留其資源與單一作業限制，避免懸空指標或反覆累積查詢。
- 共用搜尋工具在 4851 ms 找到 `halo2-discovery-test.local:18080`。這是 DNS-SD 測試服務，不是燈具；沒有 HTTP 登入或 RF 命令。
- 測試服務停止後，同一工具在 4851 ms 返回空候選。真實 ESP32 的 multicast 搜尋仍未通過，不把此次 App 後端修正等同整個區網搜尋完成。
- Rust support 14 項測試與 clippy 通過，包含 Windows 原生記錄結構、亂序組合、刪除、不相容版本與重複 TXT。
- Windows release 建置與安裝成功，前端 20 項測試通過。原生 App 搜尋列出 `test only`；選取後正確填入 `.local` 主機與 18080，密碼空白、維持未連線且燈光按鈕停用。隨後按已保存帳密連線，使用原保存位址 8080 成功連回真實橋接器，顯示無線模組就緒、配對已保存；沒有對測試服務登入，也未操作燈光。
- 本次 NSIS 安裝包 SHA-256：`8E8EC5A8780778D0EF9B92EF9DF0CE6000C9E5ED8AAB75DF9F6A8865424318B1`。測試服務只暫存於本機並在測試後移除，未加入 App 的保存設定。
