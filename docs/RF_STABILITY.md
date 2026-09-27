# 有界 RF 穩定性測試

`tools/check_rf_stability.py` 使用協定參考用戶端，重複發送目前的電源目標，不改模式、亮度或色溫。它會實際發送 RF；請在可以觀察燈具時執行。

```powershell
python tools/check_rf_stability.py --host 192.168.0.99 --send-rf --count 20 --interval 30 --report rf-report.jsonl
```

帳密由互動提示或 `HALO2_USERNAME`／`HALO2_PASSWORD` 環境變數取得。不要把帳密放入命令列或提交報告中的私人裝置識別資料。

- 必須提供 `--send-rf`；報告使用獨占建立，既有檔案不覆寫。
- 最短間隔 30 秒，最多 2881 次，排程間隔總和最多 24 小時；網路與發送執行時間另計。
- 每筆命令只 POST 一次，accepted／executing 透過唯讀查詢追蹤。送出前先寫入命令 ID，便於結果不明時查核。
- 任一失敗、未知結果、裝置重啟、外部控制、非 ready 狀態均停止；不自動恢復或重送。
- 摘要 `stopped_at` 指出停止階段；例如 `command` 表示送出／追蹤命令期間，`after_command_state` 表示已取得成功發送結果後的狀態查詢／驗證。後者失敗不會抹除先前已確認的 TX 結果，但仍使整組測試未完成。
- `complete=true` 代表本次橋接器發送測試完成；燈具沒有獨立確認，不能代替實體觀察或原生 App UI 驗收。

## 2026-09-27 首次執行

預定 20 次、間隔 30 秒，第一筆即停止，成功 0 次。命令 `e800cf6d-0847-473e-8eee-30d3eb9cf511` 回報 `TX_MAX_RETRIES`：planned=1、attempted=1、transmitted=0、IRQ=`1E`、FIFO=`01`、MODE=2。命令追蹤耗時 271 ms，整個測試 383 ms，結束原因 `TX_NOT_TRANSMITTED`，`complete=false`。

原始報告保留在本機 ignored `.esphome/rf-soak-20260927.jsonl`。測試沒有自動重送。這項結果重現間歇性 RF 發送故障，不能列為長時間穩定性通過；根因尚未確認。

## 同日後續診斷

另行發起一筆開燈命令 `580a822f-e635-4bd9-93d3-55c64236753b`，同步讀取 COM3。發送前出現 `LOGIC RECOVERY rc1=30 fifo=01 mode=2`，既有 RSTLL 復原將 FIFO 變成 `11`，該命令回報 1/1 TX_DS（IRQ `2E`、FIFO `11`）。這證明失敗後的 FIFO 殘留可被現有復原流程清除，尚未解釋首次 MAX_RT 的原因。

依 [BC5602 v1.20 資料手冊](https://www.holtek.com/webapi/116711/BC5602v120.pdf) 第 24 頁的上電校準流程，曾實驗在設定頻道後以 OM.ACAL_EN 啟動校準，等待上限 20 ms。韌體編譯／OTA 成功，但實機開機與再次重啟均未進入 ready；串列日誌確認 `HALO2 VCO CALIBRATION TIMEOUT`，配對仍持久保存。實驗沒有通過，因此撤回正常流程中的校準改動。此結果只表示該實作在本機測試未完成校準，不能判定晶片不支援校準、20 ms 必然足夠，或已排除 VCO 因素。

實驗補丁與編譯／上傳日誌保留於本機 ignored `.esphome/vco-*`。正式程式不納入這項未通過的校準改動。

已重新編譯並 OTA 刷回原韌體（config_hash `0xcc6f4828`）。API 恢復 radio=ready、pairing=ready、pairing_persisted=true；載入前燈 35%、後燈設定 50%、5500 K，desired.source=restored，last_command=null。回復後新關燈命令 `dd229778-9ec3-4b8f-a2a8-13f3ea8a0c9d` 回報 1/1 TX_DS、IRQ `2E`／FIFO `11`；使用者回覆「燈確認已熄滅」，確認這筆命令的實際燈具反應。

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
- 撤回改動後重新編譯／OTA 成功，唯讀 API 確認 radio=ready、pairing=ready、pairing_persisted=true、desired.source=restored，電源目標關閉，last_command=null。未因回復自動重送燈具命令。

本輪另補上測試工具的停止階段紀錄，避免把成功發送後的唯讀錯誤與命令送出結果不明混淆；新增回歸測試後 Python 共 25 項通過。協定契約六項與 MSVC 命令派送器測試通過。這些軟體檢查不代表 RF 穩定性驗收完成。
