# 有界 RF 穩定性測試

`tools/check_rf_stability.py` 使用協定參考用戶端，重複發送目前的電源目標，不改模式、亮度或色溫。它會實際發送 RF；請在可以觀察掛燈時執行。

```powershell
python tools/check_rf_stability.py --host 192.168.0.99 --send-rf --count 20 --interval 30 --report rf-report.jsonl
```

帳密由互動提示或 `HALO2_USERNAME`／`HALO2_PASSWORD` 環境變數取得。不要把帳密放入命令列或提交報告中的私人裝置識別資料。

- 必須提供 `--send-rf`；報告使用獨占建立，既有檔案不覆寫。
- 最短間隔 30 秒，最多 2881 次，排程間隔總和最多 24 小時；網路與發送執行時間另計。
- 每筆命令只 POST 一次，accepted／executing 透過唯讀查詢追蹤。送出前先寫入命令 ID，便於結果不明時查核。
- 任一失敗、未知結果、裝置重啟、外部控制、非 ready 狀態均停止；不自動恢復或重送。
- 摘要 `stopped_at` 指出停止階段；例如 `command` 表示送出／追蹤命令期間，`after_command_state` 表示已取得成功發送結果後的狀態查詢／驗證。後者失敗不會抹除先前已確認的 TX 結果，但仍使整組測試未完成。
- 查詢或傳輸例外另附 `failure.category`：`timeout`、`connection`、`os_error`、`http_transport`、`http_status`、`protocol` 或 `invalid_data`。結構化 HTTP 拒絕另記數字 `http_status`；不保存例外文字、回應內容或帳密。分類是當下失敗的種類，不直接判定網路或韌體根因，也不改變停止／不重送規則。
- `complete=true` 代表本次橋接器發送測試完成；掛燈沒有獨立確認，不能代替實體觀察或原生 App UI 驗收。

## 2026-09-27 首次執行

預定 20 次、間隔 30 秒，第一筆即停止，成功 0 次。命令 `e800cf6d-0847-473e-8eee-30d3eb9cf511` 回報 `TX_MAX_RETRIES`：planned=1、attempted=1、transmitted=0、IRQ=`1E`、FIFO=`01`、MODE=2。命令追蹤耗時 271 ms，整個測試 383 ms，結束原因 `TX_NOT_TRANSMITTED`，`complete=false`。

原始報告保留在本機 ignored `.esphome/rf-soak-20260927.jsonl`。測試沒有自動重送。這項結果重現間歇性 RF 發送故障，不能列為長時間穩定性通過；根因尚未確認。

## 同日後續診斷

另行發起一筆開燈命令 `580a822f-e635-4bd9-93d3-55c64236753b`，同步讀取 COM3。發送前出現 `LOGIC RECOVERY rc1=30 fifo=01 mode=2`，既有 RSTLL 復原將 FIFO 變成 `11`，該命令回報 1/1 TX_DS（IRQ `2E`、FIFO `11`）。這證明失敗後的 FIFO 殘留可被現有復原流程清除，尚未解釋首次 MAX_RT 的原因。

依 [BC5602 v1.20 資料手冊](https://www.holtek.com/webapi/116711/BC5602v120.pdf) 第 24 頁的上電校準流程，曾實驗在設定頻道後以 OM.ACAL_EN 啟動校準，等待上限 20 ms。韌體編譯／OTA 成功，但實機開機與再次重啟均未進入 ready；串列日誌確認 `HALO2 VCO CALIBRATION TIMEOUT`，配對仍持久保存。實驗沒有通過，因此撤回正常流程中的校準改動。此結果只表示該實作在本機測試未完成校準，不能判定晶片不支援校準、20 ms 必然足夠，或已排除 VCO 因素。

實驗補丁與編譯／上傳日誌保留於本機 ignored `.esphome/vco-*`。正式程式不納入這項未通過的校準改動。

已重新編譯並 OTA 刷回原韌體（config_hash `0xcc6f4828`）。API 恢復 radio=ready、pairing=ready、pairing_persisted=true；載入前燈 35%、後燈設定 50%、5500 K，desired.source=restored，last_command=null。回復後新關燈命令 `dd229778-9ec3-4b8f-a2a8-13f3ea8a0c9d` 回報 1/1 TX_DS、IRQ `2E`／FIFO `11`；使用者回覆「燈確認已熄滅」，確認這筆命令的實際掛燈反應。

## 發送前後追蹤

新增 `HALO2 PACKET TRACE`，記錄 TX strobe 前後 IRQ、RT2、執行時間與四個 FIFO 採樣點（初始化後／清除後／寫入後／完成後）。失敗另讀回主要設定；日誌於硬體完成或逾時後才輸出。未修改頻道、重試次數或封包內容，但新增 SPI 讀取會略微影響測試時序。

韌體編譯、OTA 與 Python 24 項測試通過；開機 API ready，配對與關燈目標保存。兩組各預定 6 筆、間隔 30 秒，遇失敗停止：

| 組別 | 成功筆數 | 失敗筆 | IRQ 前→後 | RT2 前→後 | 發送追蹤時間 | FIFO |
| --- | --- | --- | --- | --- | --- | --- |
| 第一組 | 1 | 2 | 0E→1E | 01→11 | 12,404 μs | 11/11/01/01 |
| 第二組 | 3 | 4 | 0E→1E | 00→10 | 11,954 μs | 11/11/01/01 |

失敗命令分別為 `fc5bf05c-9ae0-4425-a05d-6197770b9689` 與 `d5f2fcfe-50ac-40e6-8450-028784b14545`；兩次讀回 `cfg=00 rc1=30 mask=00 pkt=20 rfch=05 dm1=82 rt1=72 ce=00`，清除後 FIFO 仍為 `01`。可確認這兩次發送前沒有舊 MAX_RT／TX_DS、TX FIFO 原本為空，新的 MAX_RT 發生於 TX 後；不能因此判定 ACK 遺失的物理原因或推導空中封包內容。RT2 保留原值，不將其低半位元組誤當成所有歷史重試的累計。

兩組之間的對照命令：開燈 `b1b4907f-512c-43e0-824d-747f75bf0057` 經既有 FIFO 邏輯復原後成功；關燈 `ea024abc-47d3-4bb2-9b34-4ac0289769d7` 與再次相同關燈 `549c3bf8-a6d7-432d-851a-7fbe65b07bfb` 皆為 1/1 TX_DS。故尚無證據認定相同 payload 必然失敗，這三筆沒有另取得使用者逐筆觀察。

原始串列與 API 對照位於本機 ignored `.esphome/packet-trace-soak.jsonl`、`.esphome/packet-trace-soak-2.jsonl`。兩組均 `complete=false`，不列為穩定性通過；測試已停止，燈的目標保持關閉。

## 每筆發送前重置邏輯的對照實驗

將既有 RSTLL 復原從「FIFO 清除失敗時」改為「每筆新命令寫入 payload 前」，保留原頻道、硬體重試與單次 TX strobe，沒有重送失敗命令。實驗 OTA 映像 SHA-256：`7E3997639D18AA485AFD2367B062FD4BF4165FB8E98A3D81F22AEF4A411B038E`。

- 第一組預定六筆，前三筆均 1/1 TX_DS；第三筆 `f4aca206-500c-4411-b551-74c309766311` 後的狀態讀取出錯，整組停止。之後唯讀查核確認裝置未重啟、該命令仍為 transmitted、配對保存且 radio=ready。沒有重送該筆。
- 另開第二組，前三筆成功，第四筆 `8e10d7a5-ad26-4cf5-b08a-101c01128186` 失敗。重置後 FIFO=`11`、RC1=`30`，IRQ `0E→1E`、RT2 `00→10`、TX 追蹤 11,975 μs，FIFO `11/11/01/01`；失敗後清除仍為 `01`。
- 這項實驗未消除 MAX_RT，因此撤回每筆強制重置改動。不能將前三筆成功或六筆累計成功解讀為修復通過。
- 原始紀錄與實驗補丁保留在本機 ignored `.esphome/logic-init-*`。後續調查需要納入接線、供電與擺放資訊；目前沒有足夠證據確定是傳送、ACK 接收或硬體狀態哪一環節造成失敗。
- 撤回改動後重新編譯／OTA 成功，唯讀 API 確認 radio=ready、pairing=ready、pairing_persisted=true、desired.source=restored，電源目標關閉，last_command=null。未因回復自動重送掛燈命令。

本輪另補上測試工具的停止階段紀錄，避免把成功發送後的唯讀錯誤與命令送出結果不明混淆；新增回歸測試後 Python 共 25 項通過。協定契約六項與 MSVC 命令派送器測試通過。這些軟體檢查不代表 RF 穩定性驗收完成。

## 硬體擺放資訊與待測條件

使用者提供模組距掛燈約 60 cm、模組與 ESP32 接線約 20 cm、USB 線約 2 m，後續確認 USB 另一端接電腦。尚未量測供電電壓，不能從線長判定供電不足。

照片顯示整組橋接器位於電腦機殼頂部，無線模組看起來緊鄰金屬網板；照片不足以確認天線面方向、焊點品質或是否有導電接觸。依 [Holtek BC5602 射頻設計說明 AN0560](https://www.holtek.com.cn/webapi/116740/an0560scv110.pdf) 的天線佈局指引，天線附近的導體配置值得列入調查，但目前沒有證據認定機殼就是故障原因。

對照建議只改擺放：以非金屬支架將整組抬離機殼約 10–20 cm，保持供電、不重啟、不改韌體或接線，再跑原有固定間隔測試。此距離是建議的實驗條件，不是原廠規定的最小間距；使用者回覆已移開，但未另提供移動後的實測高度。

### 移離機殼後的短時間對照

保留原本條件式 FIFO 復原韌體，六筆關燈目標命令間隔 30 秒，約 152 秒完成，六筆皆 1/1 TX_DS，IRQ=`2E`、FIFO=`11`，沒有 MAX_RT 或裝置重啟。第一筆先經既有邏輯復原清除殘留 FIFO；後五筆發送前 FIFO 原本為空。TX 追蹤時間 3,769–4,500 μs，RT2 前後均 `00`。原始紀錄保留於本機 ignored `.esphome/off-metal-soak.jsonl`。

這組結果較前面在第二或第四筆停止的測試改善，但樣本短、未做移回原位的重複對照，不能據此認定金屬機殼是唯一根因或長時間穩定性已通過。測試維持原先關燈目標，無法從掛燈未亮推導每筆實際收到命令。

其後另外送出一次前燈 35%、5500 K 開燈命令，回報 1/1 TX_DS、IRQ=`2E`、FIFO=`11`；使用者確認「是，燈已亮起」。再送出一筆關燈也回報 1/1 TX_DS，使用者確認「是，燈已熄滅」。這輪沒有重刷、修改 RF 參數或重送失敗命令。

### 30 分鐘排程：唯讀查詢失敗而提前停止

使用者要求開始穩定性測試後，安排 61 筆、間隔 30 秒，保持目前關燈目標與移離機殼的擺放。約 185 秒後停止：前六筆均 1/1 TX_DS，IRQ=`2E`、FIFO=`11`；第七筆送出前的狀態查詢失敗，`stopped_at=before_command_state`、`reason=REQUEST_FAILED_OR_UNKNOWN`、`complete=false`。第七筆沒有 POST，也沒有 RF 發送或自動重送。

六筆的 TX 追蹤時間為 3,744–6,883 μs；前五筆 RT2 從 `00` 到 `00`，第六筆從 `00` 到 `01`，最終均成功。此輪沒有觀察到 MAX_RT，但未完成 30 分鐘驗收；目前的報告未保留例外種類，不能將停止原因直接判為 Wi-Fi 中斷或特定 HTTP 錯誤。

停止後另做唯讀查核，API 已可回應、裝置未重啟、radio/pairing 均 ready、配對仍保存，最後命令仍是第六筆 transmitted，目標保持關閉。沒有因查詢恢復自動重開測試。原始串列與 API 報告位於本機 ignored `.esphome/off-metal-30min-soak.jsonl`；本輪沒有新增掛燈實際反應的觀察。

### 查詢錯誤分類與唯讀對照

測試工具新增允許清單式錯誤分類，保留既有停止階段與未知結果語意，不增加 POST／RF 重送。回歸測試涵蓋逾時、連線中斷、OS 錯誤、HTTP 傳輸／狀態錯誤、協定及資料錯誤，確認錯誤文字不進入報告、送出前失敗沒有 POST，以及送出後逾時不重送。Python 共 26 項測試通過。

另以相同用戶端與 3 秒逾時，執行 61 次、間隔 5 秒的唯讀狀態查詢，歷時約五分鐘；全部成功，延遲 27–127 ms，裝置未重啟、控制 revision 未變，radio 均 ready。本輪沒有發送 RF，原始紀錄保留於 ignored `.esphome/readonly-connection-probe.jsonl`。

此次未重現先前查詢故障，不能回溯判定舊錯誤種類或認定已修復。查詢頻率與有 RF 發送的原測試不同，結果不取代 30 分鐘 RF 驗收；後續應使用新增診斷重新執行原條件的測試。未改動韌體、網路參數或逾時設定。

### 帶錯誤分類重測：第二筆重現 MAX_RT

再次安排 61 筆、間隔 30 秒，沿用移位後的擺放、電腦 USB 與原韌體。第一筆 1/1 TX_DS；第二筆回報 `TX_MAX_RETRIES`，約 30.7 秒即停止，`successful=1`、`stopped_at=tx_result`、`reason=TX_NOT_TRANSMITTED`、`complete=false`。此次 HTTP 正常回傳終端失敗結果，並非先前的唯讀查詢錯誤。

失敗追蹤為 IRQ `0E→1E`、RT2 `00→10`、12,124 μs、FIFO `11/11/01/01`，設定讀回 `cfg=00 rc1=30 mask=00 pkt=20 rfch=05 dm1=82 rt1=72 ce=00`，失敗後清除仍為 FIFO `01`。發送前 FIFO 原本為空；這些資料仍不足以區分傳送端、ACK 接收、供電或其他硬體因素。

後續唯讀確認沒有重啟、配對仍保存、radio/pairing 為 ready，最後命令仍為該筆 failed；沒有重送或恢復命令。原始紀錄保留在 ignored `.esphome/off-metal-30min-diagnostics.jsonl`。

移開機殼未消除故障，先前六筆短測成功不能視為修復。下一個待執行對照為保持電腦 USB 插孔、模組位置及訊號接線，只替換較短 USB 線；尚未換線或量測供電，不能先判定線材有問題。換線會造成重新上電，後續解讀必須納入此差異，不能只以換線後短暫成功推論線材是根因。

### 電腦供電 USB Hub 對照

使用者沒有短 USB 線，改插 USB Hub，並確認 Hub 只靠電腦 USB 供電。此次改變 USB 連接路徑，並非獨立電源對照。換插後裝置確實重新上電，API ready、配對自動恢復、關燈目標由儲存資料載入。

沿用 61 筆、間隔 30 秒的排程，前八筆均 1/1 TX_DS，第九筆 `TX_MAX_RETRIES`；約 243 秒停止，`successful=8`、`complete=false`。失敗前後 IRQ `0E→1E`、RT2 `00→10`，追蹤 12,201 μs，FIFO `11/11/01/01`，失敗後清除仍為 `01`。設定讀回與前次一致，HTTP 正常回傳該筆 failed；沒有自動重送。停止後唯讀確認測試期間未重啟、配對保存且最後命令仍為該筆 failed。

Hub 路徑仍重現 RF 故障，不能以成功筆數增加推定供電改善，也不能排除供電因素；重新上電與隨機性皆可能影響比較。原始紀錄位於 ignored `.esphome/hub-30min-diagnostics.jsonl`，未完成 30 分鐘穩定性驗收。

### 獨立 USB 充電器對照

使用者改接獨立 USB 充電器。換插後 API 確認重新開機、radio/pairing ready、配對保存、關燈目標自動恢復。此輪透過網路 API 測試，沒有電腦 USB 串列追蹤；充電器規格與實際電壓未量測。

同樣安排 61 筆、間隔 30 秒，第一筆 1/1 TX_DS；第二筆 `TX_MAX_RETRIES`，planned=1、attempted=1、transmitted=0、IRQ=`1E`、FIFO=`01`、MODE=2。約 30.7 秒後停止，`successful=1`、`stopped_at=tx_result`、`complete=false`，沒有自動重送。API 正常回傳 failed，沒有觀察到查詢錯誤；沒有串列資料可判定本次發送前 FIFO 或 RT2。

更換電源來源未消除故障，不能單憑此測試排除供電品質、USB 線材或模組接線，也不能確定是協定或 ACK 問題。原始報告位於 ignored `.esphome/charger-30min-diagnostics.jsonl`，30 分鐘穩定性仍未通過；此輪未取得新的掛燈實際反應確認。

### PID 與 ACK 處理檢查

對照 [BC5602 v1.20](https://www.holtek.com/webapi/116711/BC5602v120.pdf) 第 22、26–29 頁及 [Pico 參考實作](https://github.com/kuzmin-no/BenQ_ScreenBar_HALO_2_HA_integration/blob/main/src/benq_halo/__init__.py)：

- 正式控制在 `PCF_PREFIX_ZERO=1` 時將十位元組 payload 交給 `W_TX_FIFO_WITH_ACK`，PCF、PID 與 CRC 由硬體產生；`halo_app_pid` 不參與這條路徑。不能修改它就宣稱修復封包引擎序號。
- 手冊規定 PID 為兩位元、ACK 成功後推進；重傳保留同一 PID。重複封包判斷結合 PID 與 CRC。現有 API／IRQ 記錄沒有空中 PID，尚不能證明序號碰撞或其因果。
- canonical PCF bit 0 是 NO_ACK，bits 2:1 才是 PID。既有 RX 判斷 `frame[0] & 1` 的程式行為未改，但修正將其誤稱為「奇偶 PID」的註解與文件。依既有樣本略過 NO_ACK=1 回覆是專案觀察，不代表此位元普遍保證發送者身分。
- DPL、CRC、ENAA、RT1 的設定與參考實作相同。參考實作在 FIFO 未空時會再次觸發 TX，並可能送出多筆狀態同步命令；本專案保留單次觸發與不自動重送語意，不能直接抄入這些行為來掩蓋失敗。
- `0x10` 是手冊中的 PTX／PRX pipe 0 位址寫入命令，不能套用其他晶片的暫存器配置，直接斷言少寫了一個 RX 位址就是原因。

目前沒有足夠證據修改正式 PID／ACK 邏輯。本輪只修正文詞，未重刷或更改 RF 設定；地址學習／CRC C++ 測試通過。另發起一次新的開燈目標回報 1/1 TX_DS，使用者確認燈已亮起；下一筆關燈也回報 1/1 TX_DS，使用者確認燈已熄滅。這兩筆未重現 MAX_RT，不能用來確定故障時的實際掛燈反應。先前同目標關燈測試無法區分「命令未生效」與「掛燈已收到但橋接器未取得 ACK」，需要故障當下的實際狀態變化補足證據。

### 逐筆實際切換：送出前 TCP 連線逾時

保持獨立充電器供電，新增一組逐筆詢問使用者實際反應的測試：

| 步驟 | API／傳輸結果 | 使用者觀察 |
| --- | --- | --- |
| 1：開燈 | 1/1 TX_DS，IRQ=`2E`、FIFO=`11` | 燈已亮起 |
| 2：關燈 | 1/1 TX_DS，IRQ=`2E`、FIFO=`11` | 燈已熄滅 |
| 3：準備開燈 | 初始 `/api/v1/info` 身分查核在 `socket.connect()` 等待逾時 | 未送出命令，停止切換 |

第三步例外為 `TimeoutError`，發生在 TCP 建立連線階段，尚未 POST 或發送 RF；不是 HTTP 拒絕、JSON 解析錯誤或 MAX_RT。此次可以確認 TCP 連線逾時，但不能回溯判定先前缺乏錯誤細節的失敗，也不能區分 Wi-Fi、網路路徑或伺服器接收連線的根因。

後續單次唯讀查核已恢復，裝置未重啟、配對正常，最後命令仍為第二筆關燈且 transmitted。沒有自動補送第三筆。前兩筆原始紀錄位於 ignored `.esphome/observed-power-*.jsonl`；本機輔助工具亦補上身分查核失敗時的安全分類與紀錄。這輪沒有捕捉到「實際狀態切換同時 MAX_RT」的案例，RF 根因與 30 分鐘驗收仍未完成。

### TCP／ESPHome 日誌同步診斷

保持獨立充電器供電，以網路訂閱 ESPHome 日誌，並以相同 3 秒逾時的 HTTP 用戶端每 10 秒查詢一次狀態，同步執行一次 ICMP ping；共 31 次、約 302 秒，全程沒有 POST 或 RF 發送。

- HTTP 與 ping 均 31/31 成功，HTTP 延遲 27–69 ms；ping 工具程序的總耗時不當作 ICMP RTT。
- 所有狀態回應的 boot 與 control revision 均未變。ESPHome 日誌每 10 秒持續更新 RX 計數，這段期間未見 Wi-Fi 斷線、TCP／HTTP 錯誤或日誌連線中斷。啟動時有一項 SRAM1 配置建議警告，沒有據此判為故障原因。
- Wi-Fi 配置輸出顯示當時訊號約 −42 dBm、頻道 8；此為單次讀值，不能據此排除間歇性網路問題。
- 本機探測器能區分 TCP 建立連線、傳送請求、等待 HTTP 標頭、讀取內容與驗證階段；本次沒有失敗，因此未觸發失敗後的 port 80 TCP 對照。
- 日誌訂閱在測試結束後已停止。新增持續日誌連線與 ping 會改變網路流量，且查詢間隔與原 RF 測試不同；不能以這組未重現結果宣稱 TCP 或 RF 故障已修復。

原始資料保留於 ignored `.esphome/network-correlation.jsonl`、`.esphome/network-esphome.log`；未改動韌體、Wi-Fi 或用戶端逾時參數。尚缺故障當下的同步資料。後續應將相同診斷套用於原本 30 秒間隔、實際切換燈光的觀察，仍遇失敗即停；不再把短時間無故障當作穩定性通過。

### 同步日誌的六筆實際開關觀察

保持獨立充電器供電，訂閱 ESPHome 網路日誌，逐筆發送 ON／OFF 交替命令。每筆等待使用者確認前一筆實際反應，間隔至少 30 秒；實際間隔約 47–88 秒，六筆從第一筆送出至第六筆回應約 339 秒。這是有限次數的人員觀察，不是固定 30 秒間隔的原穩定性測試。

六筆皆 1/1 TX_DS、IRQ=`2E`、FIFO=`11`，API 與晶片追蹤一致；FIFO 四個採樣點均 `11/11/01/11`，TX 追蹤 3,948–6,323 μs。第一筆 RT2 `01→00`，其餘皆 `00→00`。未出現 MAX_RT、TCP 逾時、裝置重啟或日誌斷線。

使用者逐筆確認六筆 ON／OFF／ON／OFF／ON／OFF 的實際反應，最後燈已熄滅。測試已停止並關閉日誌訂閱，沒有補送或修改韌體。原始 API 紀錄在 ignored `.esphome/observed-power-*.jsonl`，同步日誌在 `.esphome/observed-log-session.log`。

這輪仍未捕捉到失敗當下的實際掛燈行為。與先前同目標關燈的失敗測試相比，payload 交替、間隔與持續日誌連線均不同；不能僅以這組成功認定重複 payload 是原因或日誌連線能修復問題。30 分鐘 RF 穩定性仍未通過。

## 2026-09-27 至 28 固定間隔 A/B 對照

維持獨立充電器、原韌體與同一個 ESPHome 網路日誌連線，先完成 A 組，再執行 B 組。每筆完成及狀態核對後等待 30 秒，實際送出間隔約 30.3–30.4 秒；兩組各十筆、各約 274 秒。兩組之間未重啟或改 RF 設定，間隔約 51 秒。

| 組別 | 電源目標 | API 結果 | TX 追蹤時間 | RT2 結束值為 01 的筆次 |
| --- | --- | --- | --- | --- |
| A | 重複 OFF | 10/10 TX_DS | 3,814–7,707 μs | 第 1 筆 |
| B | ON/OFF 交替，最後 OFF | 10/10 TX_DS | 3,858–8,376 μs | 第 1、6、10 筆 |

其餘 RT2 結束值為 `00`。全部 IRQ=`2E`、FIFO=`11`，晶片 FIFO 四個採樣點均 `11/11/01/11`；沒有 MAX_RT、HTTP 查詢錯誤、裝置重啟或日誌斷線。兩組皆遇失敗即停且不重送，本次沒有觸發停止條件；測試完成後已關閉日誌訂閱。

B 組使用者整組確認「每次都有變化，最後已熄滅」，因此五次開燈、五次關燈皆有實際觀察支持。A 組從已關燈狀態重複 OFF，無法以不變的燈光證明每一筆均被掛燈接收。原始資料保留於 ignored `.esphome/comparison-a.jsonl`、`.esphome/comparison-b.jsonl`、`.esphome/comparison-log-session.log`。

此次沒有測得兩組失敗率差異，不支持把重複 payload 直接認定為故障根因。只有一次固定 A→B 順序、每組十筆且皆帶持續日誌連線，仍可能受時間與網路活動影響；不代表排除重複封包因素或完成 30 分鐘 RF 驗收。後續若繼續調查，應保留這組基準，針對日誌訂閱有無做單一條件對照，而非直接改動 ACK／PID 邏輯。

### 2026-09-28 無持續日誌的交替開關對照

沿用 B 組的交替 ON/OFF、十筆及每筆結束後等待 30 秒的腳本，只更換原始報告檔名；不啟動持續 ESPHome 日誌。先前日誌程序已有結束結果，本輪另唯讀檢查電腦程序清單，未找到相關 ESPHome logs 程序。保留獨立充電器、韌體與既有開機狀態；沒有重啟、重新配對或更改 RF 參數。

十筆全部 1/1 TX_DS、IRQ=`2E`、FIFO=`11`，約 274 秒完成，沒有 MAX_RT、HTTP 失敗、開機識別或外部控制變更。最後目標 OFF，測試已停止。使用者在下一輪驗收前確認「全部有動作，目前已熄滅」，補足本組實際燈光觀察。因未訂閱日誌，本輪沒有每筆 RT2 或發送前 FIFO 採樣資料。原始 API 紀錄位於 ignored `.esphome/comparison-no-logger.jsonl`。

有持續日誌的 B 組與本輪皆為 10/10 成功，這個樣本未測得差異；不能據此認定日誌連線是故障原因、必要條件或修復方式。測試先後順序與時間未隨機化，且各組只有十筆，仍不能排除間歇性因素或替代連續 30 分鐘驗收。

## 2026-09-28 收斂驗收：長測提前停止

規劃僅兩階段：第一階段無持續日誌、交替 ON/OFF 62 筆、每筆完成後等待 30 秒，預期超過 30 分鐘且最後 OFF；第一階段通過後才開始 30 分鐘閒置與恢復控制。使用者先確認上一輪實際反應及目前熄滅，保持獨立充電器、位置、接線、韌體與原開機狀態。

約 549.8 秒（9 分 10 秒）停止：前 18 筆皆 1/1 TX_DS、IRQ=`2E`、FIFO=`11`；第 19 筆送出前狀態查詢逾時，`stage=before_command_state`、`failure.category=timeout`、`complete=false`。第 19 筆沒有 POST 或 RF 發送，沒有補送；此次報告不能進一步區分 TCP 連線或回應等待逾時，不把前次 TCP 證據直接套用。

停止後一次唯讀查核已恢復正常，開機識別未變、配對保存且 radio/pairing ready；最後命令仍為第 18 筆關燈 transmitted。使用者整組確認這輪九次開燈、九次關燈「每次都有動作，目前已熄滅」。原始紀錄保留於 ignored `.esphome/acceptance-30min-alternating.jsonl`。

收斂結論：短測的實際開關已有確認；長時間控制仍因查詢逾時未通過，歷史 MAX_RT 亦尚未證明已排除。依驗收規則結束本輪，不自動重開另一組短測、不進入閒置驗證，也不因本次未見 MAX_RT 就宣稱 RF 穩定。後續優先處理可重現的連線可靠性，取得故障時的傳輸階段與網路證據，再重跑同一驗收條件。

## 2026-09-28 傳輸階段診斷

Python 參考客戶端及 RF 測試工具新增安全的傳輸失敗欄位：`transport_phase` 區分 `connect`、`send_request`、`response_headers`、`response_body`；`elapsed_ms` 是該 HTTP 請求開始至失敗的總時間，並非單一階段耗時。`connect` 在使用主機名稱時包含名稱解析，不能直接視為已證明 TCP 連線故障。既有 `stopped_at` 仍描述驗收流程位置，`category` 保留 timeout／connection 等分類。

沿用原本三秒 socket timeout 與每請求獨立連線，明確關閉隱式重新連線；沒有新增 POST 重送。報告不包含 URL、主機、帳密、回應內容或原始例外文字。這是 Python 測試工具的診斷更新，未更動 App、韌體或 RF 參數，也不代表已修復間歇性故障。

28 項 Python 測試通過，包含四個傳輸階段的逾時注入、關閉連線、無重送、隱私欄位與驗收失敗摘要保留。實機僅做一次身分查詢與三次間隔十秒的唯讀狀態查詢，三次分別 30／27／29 ms，開機識別相同且 radio ready；沒有發送控制命令，沒有重現逾時。原始紀錄位於 ignored `.esphome/transport-phase-smoke-*.jsonl`。長測及閒置驗收仍待完成；下次長測發生傳輸失敗時可直接使用上述欄位判讀階段。

## 2026-09-28 啟用傳輸診斷後重跑：第 13 筆 MAX_RT

使用更新後的 Python 客戶端重跑相同 62 筆交替 ON/OFF 驗收，每筆完成後等待 30 秒，首筆 ON、預期末筆 OFF；任一錯誤即停止。沿用既有供電及硬體設定，不重啟、不重刷、不調整 RF 參數，也未啟動持續 ESPHome 日誌。原始報告保留於 ignored `.esphome/acceptance-phases-20260928-005607.jsonl`。

約 364.5 秒（6 分 4 秒）停止：前 12 筆皆 1/1 TX_DS、IRQ=`2E`、FIFO=`11`；第 13 筆開燈收到 API 終態 `failed`，錯誤 `TX_MAX_RETRIES`，frames planned/attempted/transmitted=`1/1/0`、IRQ=`1E`、FIFO=`01`、MODE=`2`。摘要為 `TX_NOT_TRANSMITTED`、`stopped_at=tx_result`、`complete=false`。本輪沒有 HTTP 傳輸例外，故不是前一輪查詢逾時的重現。

停止後一次唯讀查核確認開機識別未變、radio/pairing ready、配對仍保存，最後命令仍是同一筆失敗的 ON。使用者確認「前 12 次都有實際動作，目前保持熄滅」：前六次開燈及六次關燈有實際觀察，第 13 次開燈沒有生效。`desired.power=true` 只表示已接受的目標，不代表燈已亮起。沒有補送或補償關燈。

此結果確認在目前交替開關條件下仍會出現 MAX_RT，不能將先前短測通過視為故障已排除。30 分鐘驗收未通過，未進入閒置驗收；後續應保留這次失敗樣本及實際燈光觀察，針對 RF／ACK 路徑取得進一步證據，HTTP 逾時則保留為另一項尚未定位的問題。

## RF 診斷快照（RAM）

橋接器既有網頁新增 `RF last packet` 與 `RF last failure` 文字感測器，每秒由 RAM 更新。ESPHome 2026.9.0 以實體名稱匹配路徑，可透過既有網頁認證讀取 port 80 的 `GET /text_sensor/RF%20last%20packet` 與 `GET /text_sensor/RF%20last%20failure`，回應的 `value` 是 JSON 字串；這不是 port 8080 App protocol v1 的新端點。查詢只讀快照，不讀取晶片、不觸發 RF，也不需要持續訂閱 ESPHome 日誌。

- `seq`：本次開機的 packet-engine 呼叫序號；`uptime_ms`：快照保存時間。搭配命令完成時間、CMD 與 CONTROL 比對，並非 App command UUID。
- `stage`：guard／flush／queue／terminal，代表退出階段；terminal 也包含等待終態逾時，不保證收到 ACK。
- `attempted`／`sent`、`irq`／`fifo`／`mode`：沿用原判定；`sent` 不等於獨立掛燈狀態確認。
- `fifo_steps`：初始／清理後／寫入 payload 後的 FIFO；`irq_before`、`rt2`（前／後）、`elapsed_us` 僅在 terminal 階段有效。
- `logic_recovery`：本次是否走過既有 FIFO 卡住復原流程。
- `config_valid` 為 true 時，`config` 依序是 CFG、RC1、MASK、PKT、RFCH、DM1、RT1、CE；`cleanup_valid` 為 true 時才解讀 `cleanup_fifo`／`cleanup_rc1`。數值均為十進位，未採樣欄位的零不能解讀成真實暫存器零值。

後續成功發送會更新 last packet，但不抹除 last failure；新的失敗才覆蓋 last failure。重啟後兩者都是 `available=false`，不寫入 NVS，因此故障後應先匯出再重啟。原廠控制器的被動 RX 不會更新這兩份 TX 快照。資料沿用原本 SPI 讀值，未增加發送重試或改變 RF 設定；診斷能保留已採樣證據，仍無法直接觀察空中封包與 ACK。

### 2026-09-28 編譯、刷入與快照讀取驗證

ESPHome 2026.9.0 編譯及 OTA 成功（config hash `0x15703ddb`），開機後 radio/pairing ready、配對保存，兩份快照初始 `available=false`。28 項 Python 測試、C++ dispatcher、codec 與新增快照保留測試通過；CI 已加入快照測試。測試涵蓋成功不覆蓋失敗、失敗未採樣欄位不沿用舊值、重啟初始空值及輸出長度上限。

僅送出 ON／OFF 各一筆，兩者 1/1 TX_DS、IRQ=`2E`、FIFO=`11`，使用者分別確認「燈有亮起來」與「燈熄滅了」。port 80 快照讀取成功，seq 依序為 1／2，CMD=2、CONTROL=1／0，RT2 前後皆零，耗時分別 4430／4054 us。第一筆 FIFO steps=`01/11/01`、logic recovery=true；第二筆=`11/11/01`、logic recovery=false。這是既有復原流程的觀察，不足以判定故障根因。

兩筆成功後 last failure 仍為 `available=false`；「成功後仍保留先前失敗」已在 C++ 測試驗證，實機本輪未觸發失敗，尚未驗證該情境。控制測試已結束，燈已熄滅，不以這兩筆宣稱長測通過或 MAX_RT 已修復。原始讀取報告保存於 ignored `.esphome/rf-snapshots-*.jsonl`。

### 2026-09-28 快照長測：第 27 筆 MAX_RT

沿用快照韌體與同一次開機，從 OFF 開始規劃 62 筆交替命令，每筆完成後等待 30 秒，未訂閱持續日誌。停止後等待 1.2 秒讓文字感測器發布，再唯讀查詢 state 與兩份快照，沒有補送、重啟或改動 RF 參數。原始報告為 ignored `.esphome/acceptance-snapshots-20260928-011257.jsonl`。

約 789.2 秒（13 分 9 秒）停止：前 26 筆均 1/1 TX_DS；第 27 筆 ON 為 `failed/TX_MAX_RETRIES`，frames planned/attempted/transmitted=`1/1/0`，IRQ=`1E`、FIFO=`01`、MODE=`2`。HTTP 無例外，最後 state 顯示同一次開機、radio/pairing ready、配對保存，沒有 active command，last command 為該筆發送端判定失敗的 ON。使用者確認「前26次有動作，燈目前是開啟狀態」：前十三次開燈、十三次關燈有實際觀察，停止後燈為 ON，與第 27 筆開燈目標一致，不能將此筆 MAX_RT 解讀成掛燈未執行。

last packet 與 last failure 都成功讀出相同 seq=29（本次開機先前另有兩筆驗證命令），快照 uptime 與該命令完成時間一致，CMD=`02`、CONTROL=`01`：

| 項目 | 快照（暫存器以十六進位表示） |
| --- | --- |
| 退出階段 | terminal；attempted=true、sent=false |
| FIFO 初始／清理後／入列後 | `11 / 11 / 01` |
| 發送前 IRQ／終態 IRQ | `0E / 1E` |
| 發送前後 RT2 | `00 / 10` |
| 發送耗時 | 12210 us |
| 發送前邏輯復原 | false |
| CFG／RC1／MASK／PKT | `00 / 30 / 00 / 20` |
| RFCH／DM1／RT1／CE | `05 / 82 / 72 / 00` |
| 失敗清理後 FIFO／RC1 | `01 / 30` |

發送前 FIFO 的 TX_EMPTY 位元已設、IRQ 尚無 TX_DS/MAX_RT；因此這筆不是發送前已知 FIFO 未清空或殘留 MAX_RT 旗標。發送後約 12.2 ms 進入 MAX_RT，後續清理仍未取得 TX_EMPTY。這些資料與先前日誌的失敗型態一致，但清理不成功是終態之後的觀察，不能倒推為本筆 RF 失敗原因。結合使用者觀察，本筆支持「掛燈已動作，但橋接器未取得成功終態」的情境；ACK 未回傳、未收到或未被正確辨識仍只是待查方向，沒有空中封包或 ACK 捕捉可定位原因。

此觀察與上一輪第 13 筆 MAX_RT 後燈仍熄滅的結果不同，兩者都保留：MAX_RT 可能伴隨掛燈動作，也可能伴隨未動作，不能一律改判成功或自動重送。協定的 `effect=unconfirmed` 仍適用，`frames_transmitted=0` 是依橋接器終態計數，不是空中未曾發送的證明。後續排查優先比對 ACK 接收／辨識與完成判定，並繼續分開記錄 TX 結果與實際燈光反應。

已驗證無持續日誌時可在實機失敗後取回兩份 RAM 快照；成功發送後保留歷史失敗的實機情境尚未測試。30 分鐘長測仍未通過，未開始閒置驗收。

### ACK 設定核對與讀回診斷

對照 [BC5602 v1.20 手冊](https://www.holtek.com/webapi/116711/BC5602v120.pdf) 第 13–14、17–18、22 頁及 [上游 prepare_to_transfer](https://raw.githubusercontent.com/kuzmin-no/BenQ_ScreenBar_HALO_2_HA_integration/main/src/benq_halo/__init__.py)：目前 DPL1=`01`、DPL2=`04`、ENAA=`3F`、PKT1=`20`、RT1=`72` 的寫入設定與上游相同。RT1 表示 2 ms 間隔、最多兩次硬體重傳；RT2 高半位元組是封包遺失計數、低半位元組是重傳計數，因此原始 `RT2=10` 不能解讀為 16 次重傳，也不能以此單一採樣推算所有空中封包。

原本快照沒有讀回 DPL／ENAA，無法檢查晶片實際設定。新增 `ack_config_valid`、`ack_config`（DPL1／DPL2／ENAA）及 `address_match`：只在既有完成等待結束後、清理及切回被動 RX 前讀取，成功與失敗均採樣；讀取 `0x90` 位址後僅保存是否與目前配對一致，不輸出配對位址。有效時預期 `ack_config=[1,4,63]`、`address_match=true`。

這次增加三個暫存器及一次位址 SPI 讀取，不插入 ACK 等待期間，也不改動發送參數、重送政策或成功判定；仍可能增加完成後切回 RX 的短暫延遲。讀回一致只能排除採樣當下的明顯設定差異，不能證明 ACK 已接收，亦無法回補先前失敗缺少的讀值。

2026-09-28 驗證：28 項 Python 測試與擴充後的 C++ 快照測試通過，ESPHome 2026.9.0 編譯及 OTA 成功。刷入前另存上一筆 seq=29 的故障快照；新版開機配對恢復且兩份快照為空。一筆 OFF 回報 TX_DS，seq=1 的讀回為 `ack_config_valid=true`、`ack_config=[1,4,63]`、`address_match=true`，IRQ=`2E`、FIFO=`11`、RT2=`00/00`、耗時 4601 us；本筆走過既有邏輯復原流程。使用者確認「熄滅了」，補足此筆實際關燈觀察。新欄位在成功發送時已驗證，失敗時的設定讀回仍待捕捉，MAX_RT 與長測問題尚未解決。

此版本只有 header 變更，ESPHome config hash 仍為 `0x15703ddb`，不能僅靠該值區分版本；本次 OTA 映像 SHA-256 為 `49c0993895f151d846fc8c0b22b99b71ed93039808e83a3a28170828dec8990d`。實機回應含新增 ACK 欄位，確認執行到新版診斷程式。

### 2026-09-28 ACK 讀回長測：第 12 筆關燈 MAX_RT

保持上述韌體、同一次開機與硬體條件，沿用每筆完成後等待 30 秒、62 筆上限、失敗即停的交替開關腳本，無持續日誌。約 334.2 秒（5 分 34 秒）停止：前 11 筆（六次 ON、五次 OFF）皆 1/1 TX_DS；第 12 筆 OFF 回報 `failed/TX_MAX_RETRIES`、frames=`1/1/0`、IRQ=`1E`、FIFO=`01`、MODE=`2`。使用者確認「前11次有動作，現在確實是關燈」：前 11 筆都有實際觀察，第 12 筆 MAX_RT 後燈也確實熄滅。

停止後取得同一次開機的 ready 狀態、保存的配對及該筆失敗命令，沒有 active command。兩份快照都是 seq=13（開機後另有一筆 OFF 驗證），保存時間與本筆命令完成時間一致，CMD=`02`、CONTROL=`00`，資料如下：

| 項目 | 故障讀回（暫存器以十六進位表示） |
| --- | --- |
| FIFO 初始／清理後／入列後 | `11 / 11 / 01` |
| 發送前 IRQ／終態 IRQ | `0E / 1E` |
| RT2 前／後 | `00 / 10` |
| 發送耗時 | 12376 us |
| 發送前邏輯復原 | false |
| CFG／RC1／MASK／PKT | `00 / 30 / 00 / 20` |
| RFCH／DM1／RT1／CE | `05 / 82 / 72 / 00` |
| 失敗清理後 FIFO／RC1 | `01 / 30` |
| ACK 設定有效、DPL1／DPL2／ENAA | true、`01 / 04 / 3F` |
| 位址與目前配對一致 | true |

已捕捉失敗當下的 ACK 設定及位址讀回，與先前成功樣本一致，未發現這些欄位設定錯誤。這是完成等待之後的採樣，不能證明空中 ACK 已收到，也不能排除期間暫態、類比 RF／供電／接線或硬體狀態問題；沒有依據調整 ACK 開關或將 MAX_RT 改判成功。HTTP 無例外、裝置未重啟，沒有補送。30 分鐘長測仍未通過，未進入閒置驗收。

原始報告保留於 ignored `.esphome/acceptance-snapshots-20260928-013930.jsonl`。後續應以這份設定一致的失敗樣本為基準，進行單一硬體條件對照或空中封包量測，避免僅重複相同條件的短測。

## 閒置後短暫失效的後續調查

使用者補充閒置約半小時後 App／網頁控制失敗，約一分鐘內恢復；失效時網頁仍正常，但顯示 TX FAILED／MAX_RT 或燈沒有反應。因此本症狀優先調查 RF／ACK，歷史 HTTP 逾時仍是另一項待定位問題。

目前快照的初始 FIFO 是重新初始化後的採樣，缺少閒置結束、初始化前的晶片狀態。本機診斷新增 `pre_init_valid`、`pre_init_mode_valid` 及 `pre_init`（CFG、RC1、IRQ、FIFO、CE、RFCH、bank-0 STA1）。只在原 bank=0 時採樣 STA1，無效時不解讀該欄位。採樣不切換 bank、不發送 RF，也不更動控制參數；額外 SPI 讀取仍會影響初始化前時序。這是待實機驗證的診斷更新，不是修復。

本輪設計、驗證與限制記於 [閒置調查紀錄](evidence/idle-investigation-20260928.md)。目前尚未定位根因。

### 30 分鐘唯讀閒置與單次 OFF

後續部署紀錄：使用者明確授權後，初始化前診斷版 OTA 成功；唯讀確認同一裝置重新開機、
配對保存、radio/pairing ready，兩份 RAM 快照均為空。未額外送出控制命令；新診斷欄位的
實機發送資料仍待取得，不能將部署成功視為 MAX_RT 已修復。詳見本輪 evidence 紀錄。

使用者另確認失效後是「隔一會兒重新操作才成功」，不是原失敗命令自行延遲生效。
本輪 30 分鐘無主動查詢後，13 筆狀態 GET 全部成功，延遲 326–436 ms，開機與控制 revision 均未變。
last packet／last failure 均保留歷史 seq=320 的 OFF MAX_RT：發送前 FIFO=`11/11/01`、終態 IRQ=`1E`／FIFO=`01`，失敗清理仍為 `01`。

依本次單次關燈授權送出新的 OFF，取得 1/1 TX_DS；seq=321 的 FIFO 初始／清理後／入列後=`01/11/01`，`logic_recovery=true`，IRQ=`2E`、FIFO=`11`、RT2=`00/00`，耗時 4,372 µs。使用者確認「原本亮著，剛才確實熄滅」。成功後 last failure 仍保留 seq=320，實機驗證成功不抹除歷史失敗。

兩筆 packet 快照相隔 3,467.924 秒（約 57 分 48 秒），序號只增加一。這支持下一筆新命令觸發殘留 FIFO 復原的過程，不能描述為等待一分鐘即自動修復；也不能將前一筆發送後的 FIFO 殘留倒推為 MAX_RT 的最初原因。第一筆失敗前 FIFO 原本為空，最初 RF／ACK 故障仍待定位。

這輪未重刷、重送或更改 RF 參數。原始報告保留於 ignored `.esphome/idle-readonly-20260928-211637.jsonl`、`.esphome/idle-single-off-20260928-214754.jsonl`；完整數據與限制見上述調查紀錄。
