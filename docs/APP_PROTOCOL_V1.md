# Halo 2 Bridge ↔ App Protocol v1

狀態：v1.0 HTTP polling 契約已固定供 App 開發；共享 dispatcher 與 23 項實機 HTTP 契約檢查通過。SSE 為可選能力，目前韌體未提供；跨平臺與長時間驗收另行追蹤。實作範圍見 [開發版說明](APP_PROTOCOL_IMPLEMENTATION.md)。目標客戶端為 Tauri 2 的 Windows、macOS、iOS App。本文的 MUST／不得為必要契約，建議值可依文中能力欄位協商。

本文、[JSON Schema](../protocol/v1/schema.json)、[範例](../protocol/v1/examples.json)及[驗收案例](../protocol/v1/acceptance.md)共同構成協定；Schema 檢查資料形狀，本文及驗收案例規範跨請求行為。若矛盾，需修正設計，不能任意選一個解讀。

## 1. 範圍與關鍵決定

- 一台橋接器對應一支已配對 Halo 2，App 可保存多台橋接器。
- HTTP/1.1、UTF-8 JSON、`/api/v1`；狀態推送為 `/api/v1/events` SSE。
- App 使用 Rust 通訊核心；ESP32 RF 封包格式、CRC、位址順序留在韌體。
- v1 提供裝置資訊、狀態快照、設定命令、結果查詢；配對寫入、Wi-Fi 設定、OTA、重新啟動及 RF 測試不屬於此控制協定。
- 命令是絕對設定，不提供 toggle、加一級、重播 RF 等相對或除錯操作。
- `transmitted` 只代表所有預定 RF 封包達到目前驅動的本機送出條件。v1 沒有 `confirmed`，也沒有「燈具目前在線」的可靠判定。
- 第一版直接使用可信任區域網路及現有 HTTP Basic Auth。HTTP 不加密；Tauri 原生 HTTP 與 ESPHome native API 的加密不能改變這一點。這不是公開網際網路介面。

## 2. 傳輸、認證及版本

所有端點（包括 info 與 SSE）均需相同的 `Authorization: Basic ...`；帳密由使用者輸入，若跨啟動保存，App 必須使用受保護儲存。最小版本可只保存在記憶體並於關閉後要求重新登入。不得放入 URL、錯誤訊息或診斷匯出。401 回覆 `WWW-Authenticate: Basic realm="Halo2 Bridge"`。App 不攜帶憑證跟隨跨主機重新導向。

目前韌體的 API base URL 為 `http://<host>:8080/api/v1`，原 ESPHome 網頁仍用 port 80；App 的裝置設定必須包含 port，不能把 IP 相同視為服務相同。HTTP polling 開發版宣告 state_events=false；未提供的 `/events` 仍先認證，再回 404。

POST 需 `Content-Type: application/json`。JSON 不接受重複 key、非有限數字、布林替代整數或未知 request 欄位。整數欄位使用整數 JSON token，不使用小數點或指數記法（例如傳 `3925`，不傳 `3925.0`／`3.925e3`）；這項 wire 格式限制與重複 key 檢查須在 Schema 以外驗證。最大 request body 為 1024 bytes；不支援壓縮請求。JSON 回應最大 8192 bytes，使用 `Cache-Control: no-store`。不回傳 HTML 作為 v1 協定錯誤。

`info.protocol` 固定含 `name="halo2-bridge"`、`major=1`、`minor=0`。相容的回應欄位擴充可提高 minor；客戶端忽略未知回應欄位，未知命令狀態／錯誤碼採保守「結果不明／無法處理」，不得視為成功。request 欄位擴充需能力協商；破壞性變更使用 `/api/v2`。

本設計的 Schema 對 request 嚴格，response 允許額外欄位。Schema 的已知 enum 是 v1.0 發送端的限制；未來客戶端解碼器仍需保留 unknown 分支。

若 `/api/v1/info` 回覆 404、HTML 或不是本協定，App 顯示「需要支援 App protocol v1 的橋接器韌體」，不偷偷改呼叫舊 `/switch/...` 控制。手動 IP／主機名稱必須可用；mDNS 是後續發現功能，不能當唯一裝置識別。

## 3. 識別、時間與版本號

| 欄位 | 定義 |
| --- | --- |
| `device_id` | 橋接器初次設定產生並保存的 UUID；更新韌體、一般重啟、IP 變更不改變。清除裝置儲存可改變；不是 RF 位址。 |
| `boot_id` | 每次啟動重新產生 UUID；即使結果快取遺失，也能拒絕舊開機時期的命令。 |
| `client_id` | App 安裝實例產生的 UUID，用於來源追蹤，不是認證身分。 |
| `command_id` | 每個新意圖產生的 UUID；同一次傳輸重試保留完整 request 與 ID，永不把舊 ID 改作新命令。 |
| `control_revision` | 同一 boot 的控制目標／控制前提版本，從 0 起。用於比較後更新，不能跨 boot 比較。 |
| `state_version` | 同一 boot 的可觀察狀態版本，從 0 起。命令階段、遠端觀察、配對／無線狀態改變時增加。 |
| `uptime_ms` | 同一 boot 的單調毫秒，使用 64-bit 延伸計時，不得直接暴露會在約 49 天回繞的 32-bit millis。 |

JSON 計數／時間限 0…9007199254740991，避免 JavaScript 精度問題；實作不得回繞，達界前重建 boot epoch。欄位為數值，不混用 hex 字串。原始 IRQ=2E 在 JSON 表示 46。

`control_revision` 在接受新命令時增加一次（即使目標值相同，仍可明確重送設定）；有效原廠控制器封包若與當前 desired 值不同，採用它並增加一次；配對變更、進出學習或 RF 重設等使控制前提失效的操作也增加。重複接收同樣 desired 值、單純 TX 階段改變與 heartbeat 不增加它。

`state_version` 在上述修改及命令階段／觀察時間更新時增加；單純 GET、讀取時 uptime 增加與 heartbeat 不增加。全部修改及快照在同一狀態管理器中序列化。

## 4. 端點

| 方法與路徑 | 回應與目的 |
| --- | --- |
| `GET /api/v1/info` | 200 `DeviceInfo`：識別、協定、韌體、傳輸能力、資源限制；同一 boot 內這些能力與限制不變。 |
| `GET /api/v1/state` | 200 `Snapshot`：一致性快照，不觸發 RF 查詢或發射。 |
| `POST /api/v1/commands` | 新命令 202 `CommandRecord`（accepted）；相同 ID 已終結則 200，相同 ID 執行中則 202。 |
| `GET /api/v1/commands/{command_id}?boot_id={boot_id}` | 200 `CommandRecord`；缺 boot_id 為 400，boot 不符 409，紀錄不存在／已淘汰 404。 |
| `GET /api/v1/events` | 200 `text/event-stream`；初次及重連均推完整快照，詳見第 8 節。 |

HTTP handler 只驗證及登錄命令，RF 工作由主迴圈執行，不在網路 callback 中阻塞 TX。202 發出前必須完成記錄與 desired/revision 的原子更新；RAM 接受不等於耐斷電提交。

## 5. 狀態模型與能力

`LightState`：

```json
{"power":true,"mode":"back","front_brightness":22,"back_brightness":10,"temperature_k":3925,"ultrasonic_enabled":false}
```

- `power`、`ultrasonic_enabled` 是 boolean。
- `mode` 為 `front | back | both`，不另提供可互相矛盾的 front/back 布林。
- 兩路亮度是 1–100 的整數；0 不是關燈別名。
- `temperature_k` 是 2700–6500、25 K 步進，套用到目前協定共用的前後燈色溫。
- 關燈保留模式、亮度及色溫。修改它們不隱含開燈；要開燈須明確指定 `power:true`。
- Patch 至少一個欄位，缺少代表保留、null 不允許。不得默默 clamp 或捨入。

Snapshot 的 `features` 逐欄標示 `verified | experimental | unsupported`；verified 必須根據該裝置／配對的實測，不得因 App 有 UI 就宣稱支援。第一版 App 預設隱藏或停用 experimental，開發者可明確啟用。設定 unsupported 欄位整筆拒絕。配對改變時，features 與 control_revision/state_version 在同一次修改中更新，避免新配對沿用舊配對的驗證標記；App 依最新快照呈現能力。

Snapshot 有兩組狀態：

1. `desired`：橋接器最近採用的完整控制目標，附 `source=boot_default|restored|app|legacy|remote`、`updated_at_uptime_ms` 及 nullable `command_id`。接受命令即更新；TX 失敗保留目標及失敗結果，不能假裝它是燈具真實狀態，也不自動倒回覆蓋後來的控制。
2. `observed_remote`：nullable，保存目前 RX 解析器判為原廠控制器請求的完整狀態與最後接收時間。這是控制器的意圖證據，不是獨立燈具回覆。開機初始必為 null，不把舊快取包裝成新接收。

`lamp_confirmation` 固定 `unavailable`。`radio_status=initializing|ready|learning|fault` 描述本機無線驅動；ready 不代表燈具可達。`pairing_status=unpaired|learning|ready` 與 `pairing_persisted` 分別描述目前配對可用性及是否保存。故障欄位 `radio_error_code` 為 nullable。

`active_command` 是 accepted/executing 的完整紀錄或 null；`last_command` 是最近終結的完整紀錄或 null。App 必須用 ID 比對，不能把別的客戶端結果套到自己按鈕上。重啟清空這兩者；恢復的設定 source=restored，但不自動發送。

## 6. 命令、並行及發射

Request 範例：

```json
{
  "command_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "client_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "boot_id":"22222222-2222-4222-8222-222222222222",
  "expected_revision":12,
  "not_after_uptime_ms":104000,
  "type":"set_state",
  "patch":{"power":false}
}
```

App 先取得 uptime=100000、revision=12 的快照，再建立例如 4 秒內失效的 request。deadline 是橋接器 uptime，不能用手機 UTC；App 用自身單調計時估計快照年齡。過舊或延遲不確定的快照先重取；新 request 必須滿足 `now < not_after <= now + max_command_future_ms`，預設 max=5000。

接受順序（全部不可有 RF 副作用）：

1. 認證、大小、JSON 形狀、boot_id。
2. 查 command_id 紀錄。相同 request 的去重命中直接返回原紀錄，**早於 deadline、revision、busy 檢查**；不同 request 回 409 `COMMAND_ID_REUSED`。
3. 驗證 deadline、欄位能力、配對／radio 狀態、expected_revision。
4. 驗證全域處理槽、節流及結果紀錄空間。v1 全橋接器最多一筆 accepted/executing；busy 拒絕，不累積延遲控制佇列。
5. 將 patch 原子合併至 desired，revision +1，保存完整 target 與 accepted 紀錄；回覆 202。

Request 等同性比較解碼後的所有欄位，含 deadline、revision 及 patch 欄位集合；JSON 空白與 key 順序不影響。省略欄位與明確指定同值不是相同 request。

主迴圈開始執行前重新檢查 deadline、revision 是否仍等於 accepted_revision、配對及 radio。deadline 過期為 expired；控制目標已被原廠控制器或控制前提變更覆蓋為 superseded。RF 已開始後無法撤銷空中封包；後來的觀察可更新 desired，但不能改寫既有命令的 TX 證據。

v1 的驅動對應規則：含非 power 欄位先送 0x03；含 power 欄位再送 0x02，兩者均使用同一完整 target。最多兩個 RF frame；只有 power 時只送 0x02。這是待逐項硬體驗證的 adapter 規則，複合 patch 只保證軟體狀態原子合併，**不保證燈具在 RF 層原子套用**。第二包前失敗／過期時保留部分傳送資訊，不執行回滾封包。

每包送出前檢查 deadline；硬體已觸發的一包可完成其有界重傳。未開始就逾時為 expired；已送出部分封包後逾時為 failed / DEADLINE_DURING_TX。從 executing 起最多 1000 ms 完成或以 TX_TIMEOUT 終結；驅動必須有界，不能卡住主迴圈無限等待。這是故障上限，不是允許每次阻塞網路一秒。App 的 HTTP 逾時不取消已接受命令。

所有舊網頁、ESPHome native API、Home Assistant 控制入口必須透過同一 dispatcher，帶內部 command_id、revision 及結果，不可繞過仲裁直接 TX。維護／RF 測試操作需鎖住 dispatcher 並使控制前提版本失效；v1 App 不呼叫測試按鈕。

## 7. 結果、去重及 ESP32 資源界限

```text
accepted → executing → transmitted
    │          └────→ failed
    ├───────────────→ expired
    ├───────────────→ superseded
    └───────────────→ failed（執行前發現配對／硬體不可用）
```

終結狀態不可再改成另一終結狀態。`error` 在前三種非錯誤階段 accepted/executing/transmitted 為 null，在 failed/expired/superseded 含穩定 code 與可讀 message。接受前拒絕使用 HTTP `Error` envelope，不產生命令紀錄、不改 desired/revision。

CommandRecord 包含 boot_id、command_id、client_id、accepted_revision、完整 target、status、accepted/started/finished timestamps，以及 `tx`。`tx` 記錄 `frames_planned`、`frames_attempted`、`frames_transmitted`、nullable 最後一包 irq/fifo/mode。成功 TX_DS 必須且僅能依驅動原有的成功條件判斷；MAX_RT／FIFO stuck 不得映射 transmitted。直接傳送路徑 raw IRQ 可為 null。

`effect=not_attempted|unconfirmed`：尚未觸發任何 RF 時為 not_attempted；任一包嘗試後必為 unconfirmed，即使 MAX_RT 仍不能斷言燈沒收到。沒有 confirmed 或「保證未改變」的錯誤推論。

v1 基準限制（info 必須公告，App 依公告值節流）：

| 項目 | 基準 |
| --- | --- |
| 未終結命令數 | 1，全橋接器共用 |
| 新接受命令最小間隔 | 500 ms，全來源共用；重複 ID 查詢不占新命令額度 |
| 命令 deadline 最大未來距離 | 5000 ms |
| 結果紀錄容量 | 64 筆，精簡二進位欄位保存，不保存 64 份 JSON 字串 |
| 終結後最短保留 | 30000 ms；未終結不可淘汰 |
| SSE 訂閱數 | 2；額外訂閱 429，可用低頻 GET |
| SSE heartbeat | 10000 ms |
| SSE 快照合併間隔 | 最多每 250 ms 一份最新快照，初始快照立即發送 |

64 筆與 500 ms 間隔使 30 秒結果保留有界；任何情況容量不足都拒絕新命令 `RESULT_BUFFER_FULL`，不得提早淘汰還在承諾保留期內的紀錄。裝置可公告更保守限制；不得用無界 heap 擴充來滿足請求。

正常重送：同 boot、同 ID、同完整 request，只返回紀錄且不得再次 TX。結果淘汰後，舊 request 的 deadline 已過，不得重新接受。客戶端不得重用舊 ID 搭配新的 deadline。v1 **不承諾跨斷電 exactly-once**：boot 改變或查不到結果時 App 顯示結果不明，取得新快照，等待新的使用者意圖；不自動發送反向或相同控制命令。

命令紀錄只保存在 RAM，不逐次寫入 NVS。配對仍持久化；一般 last-settings 可延遲保存，但開機載入不得自動 TX。

## 8. SSE 與重連

`/api/v1/events` 是新建的協定串流，與 ESPHome 既有 `/events` 不同。只定義一種 `event: snapshot`，data 是完整 Snapshot；id 格式為 `{boot_id}:{state_version}`。範例 data 請見 examples.json 的 snapshot 範例，不使用省略欄位的半份 JSON。

每次建立連線立即送一致性快照，之後才送版本更高的快照。無 replay buffer；即使提供 Last-Event-ID 也一律先送當前快照。這是明確的 resync，不保證收到每個中間事件。App 需要特定命令結果時使用 GET commands；不能只依賴 last_command。

每 10 秒送 `: heartbeat\n\n`，不增加版本。不推原始 RF 封包、帳密或逐行除錯日誌。每個客戶端最多保存一份待送的最新快照；慢客戶端不能無限堆積，必要時斷線讓其 resync。既有 ESPHome 網頁 SSE 也占 socket，實作需量測及保留普通 HTTP 控制容量。

App 同 boot 僅採用較新 state_version；相同版本可更新 uptime 估計，不覆蓋較新值。不同 boot 的舊 HTTP 回應不得直接覆蓋目前 session；發現 boot 改變就使舊 pending 結果標成 unknown，重取 info/state，再建立新串流。每次重連的非同步回呼帶本地 generation，忽略已作廢 session 的回應。

30 秒無串流資料視為串流失聯；GET 成功仍可表示橋接器在線，不推論燈具在線。重連採 1、2、4、8、15 秒上限及 jitter；401 停止自動重試並要求更新憑證。SSE 不可用時前景 GET state 建議每 2 秒一次；App 回前景先取得快照，不重播背景期間的控制。

## 9. 錯誤契約

Error envelope 固定含 `error.code/message/retryable`、nullable `boot_id` 與 nullable `control_revision`。認證失敗時後兩欄皆 null。retryable 表示可在條件改變後重試，不授權 App 自動重播控制命令。

| HTTP | code | 意義／處理 |
| --- | --- | --- |
| 400 | INVALID_REQUEST | JSON、型別、缺欄位、未知欄位、查詢參數無效 |
| 401 | UNAUTHORIZED | 未授權；停止重試並修正帳密 |
| 404 | COMMAND_NOT_FOUND / NOT_FOUND | 紀錄不在保留範圍／未知路徑；不代表從未執行 |
| 405 | METHOD_NOT_ALLOWED | 方法不符，附 Allow |
| 409 | BOOT_CHANGED | expected boot 不符；丟棄舊 pending 自動重試 |
| 409 | REVISION_CONFLICT | 取得快照後由新意圖決定是否提交，不自動覆蓋他人操作 |
| 409 | COMMAND_ID_REUSED | 同 ID 不同 request，客戶端錯誤 |
| 409 | DEADLINE_EXPIRED / DEADLINE_TOO_FAR | request 已過期或超過最大未來距離 |
| 409 | PAIRING_REQUIRED / PAIRING_IN_PROGRESS | 無可用配對／正在學習 |
| 413 | PAYLOAD_TOO_LARGE | 超過 1024 bytes |
| 415 | UNSUPPORTED_MEDIA_TYPE | 非 application/json 或不支援編碼 |
| 422 | INVALID_VALUE / UNSUPPORTED_FEATURE | 欄位範圍、步進或能力不符；整筆拒絕 |
| 429 | BUSY / RATE_LIMITED / RESULT_BUFFER_FULL / SUBSCRIBER_LIMIT | 有界資源滿；附 Retry-After 秒數，最少 1 |
| 503 | RADIO_UNAVAILABLE | 本機無線未就緒／已知故障 |

JSON 形狀合法但業務值超界走 422；Schema 將兩者都判為不合法，不能拿 Schema validator 的單一結果直接決定全部 HTTP status。

終結結果的 error.code：`TX_MAX_RETRIES`、`TX_FIFO_STUCK`、`TX_TIMEOUT`、`RADIO_UNAVAILABLE`、`PAIRING_REQUIRED`、`DEADLINE_EXPIRED`、`DEADLINE_DURING_TX`、`CONTROL_SUPERSEDED`。診斷字串只供人閱讀，App 不解析 message、Radio status 文案或 IRQ hex 來決定業務結果。

## 10. 實作與驗收順序

1. 先以本契約建立測試 fixture／假橋接器，驗證 schema、錯誤、並行與逾時；不大量開發 UI。
2. 韌體新增共享 dispatcher、狀態分離與有限結果表，再加入具認證的自訂 HTTP handler；現有 ESPHome API 不會自動提供本文端點。
3. 完成 polling 版本及命令查詢後，再加入 SSE；協定本身已定義 SSE，韌體以 info 能力標示是否啟用。
4. 用最小 Tauri Rust client 驗證 Windows、macOS、iOS；所有寫入入口通過相同仲裁測試，才開始大量 UI。
5. 通過 24 小時穩定性及實體燈具測試，才把本設計由「未實作」標為已支援。

契約檢查：先安裝 `python -m pip install -r protocol/v1/requirements-dev.txt`，再執行 `python tools/validate_app_protocol.py`。它驗證所有正向範例、非法欄位與跨欄位範例一致性；使用 `--cpp-fixtures` 亦可驗證實際編碼器的輸出。去重與命令生命週期另由 C++ dispatcher 測試涵蓋，HTTP 實機檢查使用 `tools/check_app_api.py`；SSE 尚未實作。CI 已加入契約與 C++ 檢查。

配對、韌體、App 版本分開管理。App 不寫入私人 RF 地址，不因橋接器無回覆自動重新配對。新協定不依賴 ESPHome 實體顯示名稱，日後 UI 名稱修改不應破壞 wire format。

參考標準：[ESPHome 既有 Web API](https://esphome.io/web-api/)、[SSE 格式](https://html.spec.whatwg.org/multipage/server-sent-events.html)、[JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)。上述標準不提供本文的命令去重與狀態語意；那是本專案要實作的契約。
