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

- Windows：實作並驗證本機 DNS-SD 瀏覽、候選填入及手動 fallback。
- macOS／iOS：需驗證 Bonjour 與 OS LAN 權限。iOS 使用原生 Bonjour 瀏覽，宣告固定服務的 `NSBonjourServices`，不依賴需要額外 multicast entitlement 的任意 UDP 掃描。平台限制依 [Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)。
- 實機驗收：至少找到真實橋接器、選取不送出、登入後控制成功；無候選、拒絕權限／斷線有可理解回應；多候選不自動選擇或發送帳密。

## 2026-09-27 韌體實測

ESPHome 2026.9.0 編譯成功，OTA 更新成功。重開後 API 與配對皆 ready、配對仍持久保存，目標設定由 restored 載入，沒有自動重送命令。

對實體橋接器的 UDP 5353 單播 DNS-SD 查詢得到正確 PTR、SRV（8080）、TXT（上述兩個欄位）及主機 A record，確認服務已註冊。一般 Zeroconf 五秒搜尋、指定實際 Wi-Fi 介面的搜尋及 multicast 查詢則沒有結果；不能把單播查詢成功視為自動搜尋已驗收。尚未區分 OS、AP／路由器 multicast 或韌體介面行為，未修改防火牆或路由設定。

目前只有韌體宣告與契約，App 搜尋程式與三平台驗收尚未完成。需保留此真實網路環境的空結果案例及手動輸入 fallback。
