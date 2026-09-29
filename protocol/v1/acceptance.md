# v1 行為驗收案例

這是 dispatcher／HTTP handler／Tauri client 的完整驗收清單，**不是全部已通過的硬體測試報告**。已有 C++ dispatcher／codec 測試、Python client 測試及實機 HTTP 檢查工具；目前覆蓋範圍與限制見 [開發版說明](../../docs/APP_PROTOCOL_IMPLEMENTATION.md)及 [PROJECT_STATUS.md](../../docs/PROJECT_STATUS.md)。Schema 驗證不能替代下列流程測試。

| 編號 | 刺激／前提 | 必要結果 |
| --- | --- | --- |
| A01 | 有效配對、目前 boot/revision，送 power=false | 202 accepted、revision +1；只一次 RF 0x02；結果 transmitted 仍是 effect=unconfirmed |
| A02 | request 已接受但 202 網路遺失，重送完全相同 body | 原 command_id 紀錄；不再次 TX，也不再增加 revision |
| A03 | A02 在原 expected_revision 已過時／deadline 已過時後重送，紀錄仍保存 | 去重優先，仍返回原結果；不以 revision/deadline 錯誤取代既有結果 |
| A04 | 同 ID 改 patch、deadline、revision 或 client_id | 409 COMMAND_ID_REUSED；原紀錄不變 |
| A05 | 改變 JSON key 順序與空白後重送 | 視為相同 request；明確設定欄位與省略該欄位則不相同 |
| A06 | 紀錄已依保留期限淘汰，再送原 body | 409 DEADLINE_EXPIRED，不再次 TX；GET 結果 404 不表示從未執行 |
| A07 | 指令可能已發送但 ESP32 斷電，App 重連 | 新 boot_id；舊 POST／查詢 409 BOOT_CHANGED，App 標 unknown，不自動重播 |
| A08 | 兩客戶端從同 revision 提交不同設定 | 只有一筆可原子接受；另一筆 REVISION_CONFLICT，不互相靜默覆寫 |
| A09 | 已有 active 命令，另一客戶端以最新 revision 提交 | 429 BUSY，desired/revision 不變；不累積等待佇列 |
| A10 | 原廠控制器改變目標，pending 尚未開始 RF | 採用 remote、revision 增加，pending superseded；不再送過期 App 目標 |
| A11 | RF 已開始後才處理原廠控制器的新狀態 | 保留 TX 證據，採用新 remote 狀態，不宣稱能撤回已發射封包 |
| A12 | IRQ=1F FIFO=21 或 MAX_RT | failed，若嘗試過發射 effect=unconfirmed；不得標 transmitted 或斷言燈未收到 |
| A13 | FIFO 未清空、尚未 trigger | failed/TX_FIFO_STUCK、frames_attempted=0、effect=not_attempted；返回 RX 並保留診斷 |
| A14 | 複合 patch 第一包成功、第二包失敗 | failed、planned=2、attempted=2、transmitted=1；不回滾、不承諾 RF 原子性 |
| A15 | accepted 後尚未執行就到 deadline | expired、attempted=0；已發第一包才過期則 failed/DEADLINE_DURING_TX |
| A16 | 64 筆結果仍在保留期，或命令超過節流 | 429 RESULT_BUFFER_FULL／RATE_LIMITED + Retry-After；不能提早淘汰或 TX |
| A17 | app/網頁/HA 同時寫入 | 全部經同一 dispatcher；web 也不能繞過 busy、revision 更新及 TX 記錄 |
| A18 | SSE 連線建立時狀態改變，或慢客戶端落後 | 初始快照與後續版本有序；合併最新值或斷線重同步；記憶體有界 |
| A19 | SSE reconnect 帶舊 Last-Event-ID | 先推目前完整快照；不保證中間事件重播，特定命令結果用 GET 查 |
| A20 | HTTP 舊 session 回應晚於新 SSE／新 boot 抵達 | generation + boot/version 過濾；不使畫面倒退或誤報自己命令成功 |
| A21 | SSE 30 秒無資料但 GET 正常 | 顯示串流重連／改用輪詢；不把掛燈判為離線 |
| A22 | iPhone 進背景再返回 | 取得新快照後恢復操作；不自動送出背景前的 slider/power request |
| A23 | 空 patch、null、錯型別、未知欄位、重複 JSON key | 400 或依規格 422；沒有 partial apply／NVS／RF 副作用 |
| A24 | brightness=0/101、temperature=3926、unsupported 欄位 | 422；不 clamp、不把 0 當關燈、不自動忽略不支援欄位 |
| A25 | 無憑證、錯誤憑證、錯 content type、body 過大 | 401/415/413；每個端點含 SSE 都受認證保護，診斷不含帳密 |
| A26 | reboot 載入 last-settings／pairing | desired source=restored，observed_remote=null，無自動 RF；boot_id 改變但 device_id 不變 |
| A27 | 舊韌體沒有 /api/v1/info | App 明確顯示需升級，不解析舊人類可讀 Radio status 當新協定 |
| A28 | 未知 response 欄位／status／error code | 額外欄位可忽略；未知狀態與錯誤不映射成功，保留診斷 |
| A29 | 24 小時操作、兩 SSE、網頁、原廠控制器交錯、Wi-Fi 斷線 | 無無界記憶體成長、沒有過期命令回放；RF 失敗與本機連線狀態可分辨 |

建議依 A01–A17 完成 dispatcher 測試，A18–A28 完成網路及客戶端測試，再以實體 ESP32／掛燈完成 A29 及所有發射效果驗證。
