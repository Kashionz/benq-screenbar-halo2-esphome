# App protocol v1 開發版

這一階段實作 ESP32 的共享命令處理器、HTTP polling API 與命令列驗證工具。Tauri App UI、Rust 通訊核心、SSE、mDNS 探索與三平臺驗收仍是後續工作。

## 連線

- 原有 ESPHome 網頁：`http://screenbar-halo2/`，port 80。
- 新版 App API：`http://screenbar-halo2:8080/api/v1`；也可使用橋接器的 IP。
- 兩者使用 `secrets.yaml` 的同一組 `web_username`／`web_password`。
- 此版本是可信任區域網路內的 HTTP Basic Auth，沒有 TLS。原生客戶端直接連線；API 不提供跨來源瀏覽器存取。
- 必須一併部署 `components/halo2_api/`，不能只複製原有四個檔案。

API 使用獨立 ESP-IDF HTTP server，避免 ESPHome 原有 handler 在認證與 body 驗證前回傳不符合契約的錯誤。server 最多三個客戶端 socket，request/response 上限分別是 1024/8192 bytes；回應後關閉連線，拒絕的 body 不會被當作下一個請求。ESPHome 與 API 共存所需的總 socket 上限設定為 24。

| 端點 | 實作 |
| --- | --- |
| `GET /info` | 持久化 device_id、每次開機更新的 boot_id、協定與資源限制 |
| `GET /state` | 一致性快照、desired 與 observed_remote 分離 |
| `POST /commands` | 有認證的原子登錄、版本檢查、去重與節流 |
| `GET /commands/{id}?boot_id={boot}` | 查詢同一 boot 的命令紀錄 |
| `GET /events` | 尚未提供；info 宣告 `state_events=false`、`max_event_subscribers=0`，認證後回 404 |

## 命令執行

`components/halo2_api/dispatcher.h` 不依賴 ESPHome，可用桌面 C++ 編譯器測試。ESP32 adapter 以 mutex 序列化 HTTP 登錄、遠端觀察與主迴圈狀態變更。網路 I/O 及 RF 發射不占用這個 mutex。

- 同時最多一筆命令，每 500 ms 最多接受一筆新命令。
- 結果表固定 64 筆，終結後至少保留 30 秒；最後一筆結果可額外保留直到被取代。
- 去重比較解析後的完整 request；JSON key 排序或空白不影響結果。
- 命令只由 ESPHome 主迴圈發射。設定欄位用 `0x03`，有 power 欄位再送 `0x02`。
- 遠端操作覆蓋 pending 目標時，尚未開始的命令會終結為 superseded。
- 發射失敗保留 desired 及診斷，不自動重送、回滾或宣稱實體燈具已確認。
- packet engine 等待 TX_DS／MAX_RT 最多 250 ms。發射前啟用並等待 XCLK，清除 FIFO 後短暫輪詢狀態；若仍未清空，最多執行一次 RC1.RSTLL 內部邏輯重置並重建 packet 設定。恢復後才送出本次命令，不重播先前失敗的命令。仍無法清空時回報 not_attempted，並鎖定 radio_status=fault，直到重新開機或明確建立新的維護情境。
- UUID 身分與 RF 配對使用不同 preference key；命令紀錄只保存在 RAM。

## 舊介面相容性

Power、前後燈開關、亮度、色溫、感應、模式及 Resend 都使用同一個處理器。網頁與 HA 也可能收到 BUSY／RATE_LIMITED；UI 顯示處理器採用的目標，不能再繞過仲裁直接發射。

前／後燈的舊開關會轉成 mode；開啟其中一個燈的開關同時明確要求 power=true，關閉最後一個燈則轉成 power=false 並保留模式。App 的 mode／亮度 patch 本身不隱含 power=true。舊的 Lamp state JSON 仍保留供現有 HA 使用；它是目標快取，新 App 應讀取新版 Snapshot。

RF 除錯按鈕在 maintenance lease 內執行，有 active 命令時拒絕。`Test power sync (02 + 04)` 改成同一個 lease 內各送一包，移除會跨越其他操作的六次延遲重播。八位 PCF 的舊 direct TX 路徑保留；其結果沒有 packet-engine IRQ 診斷，JSON 對應欄位為 null。

## 最小測試客戶端

`tools/halo2_client.py` 是 Python 標準函式庫參考／驗證工具，並非 Tauri App。密碼在提示中輸入，或由測試環境的 `HALO2_PASSWORD` 提供；不放在命令列參數或 URL。

```powershell
python tools/halo2_client.py --host 192.168.0.99 info
python tools/halo2_client.py --host 192.168.0.99 state
python tools/halo2_client.py --host 192.168.0.99 set '{"power":true}'
python tools/halo2_client.py --host 192.168.0.99 set '{"power":false}'
```

客戶端預設只允許 verified 能力；其他已列為 experimental 的欄位需要 `--experimental`。POST 網路逾時顯示結果不明及 command_id/boot_id，不重新產生另一筆控制命令；可用 `lookup <command_id> <boot_id>` 查詢。結果 `transmitted` 仍須由人觀察燈具效果。

## 檢查

```powershell
python -m unittest discover -s tests -p "test_*.py"
python -m pip install -r protocol/v1/requirements-dev.txt
python tools/validate_app_protocol.py
esphome compile screenbar-halo2.yaml
python tools/check_app_api.py --host 192.168.0.99
```

最後一個命令只測讀取與應被拒絕的 request。加上 `--exercise-power` 才會發出兩次相反的 power 設定，以最初目標結尾；測試失敗時不自動發出補償命令。

CI 另外編譯／執行 `tests/test_dispatcher.cpp`、`tests/test_app_codec.cpp`，並將真正 C++ encoder 的 JSON 輸出送進 Schema validator。硬體驗證與未完成項目以 [PROJECT_STATUS.md](PROJECT_STATUS.md) 為準；不得將單元測試通過當成 24 小時穩定性或跨平臺實測通過。
