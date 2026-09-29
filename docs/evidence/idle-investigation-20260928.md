# 閒置後短暫控制失效調查

## 症狀與範圍

使用者回報：App／網頁在閒置約半小時後無法正常控制，約一分鐘內恢復。
後續補充：失效時網頁仍正常，但顯示 TX FAILED／MAX_RT 或燈沒有反應。
因此本症狀優先調查 RF／ACK；歷史 HTTP 逾時保留為另一項問題，不能混為同一根因。
使用者另確認是「隔一會兒重新操作才成功」，不是失敗命令在沒有新操作時自行生效。
等待時間與新命令引起的初始化／FIFO 復原目前仍互相混雜，不能認定時間本身造成復原。
尚未確認同時段原廠遙控器的 RF 是否仍能被橋接器收到。
本紀錄是調查證據，不代表根因已定位或穩定性驗收通過。

## 原始碼與手冊核對

- `screenbar-halo2.yaml` 設定 Wi-Fi `power_save_mode: none`、RX 輪詢 50 ms。
  本機 ESPHome 2026.9.0 產生的組態亦未啟用 `CONFIG_PM_ENABLE`。
  尚未發現橋接程式中「閒置 30 分鐘後休眠，再等一分鐘恢復」的計時器。
- `sync_api_radio` 主要依 CRC seed、配對與學習狀態設定 `radio=ready`；
  `Halo2Api` 另會鎖定 `TX_FIFO_STUCK` 故障。`ready` 並非即時 RF／ACK 健康量測，
  不能據此排除 RF 故障。
- `ControlApp.tsx` 在可見時每兩秒查詢狀態，隱藏時停止定期查詢，回前景立即查詢。
  查詢失敗會標記 offline，後續成功查詢恢復 online。這能解釋介面隨網路恢復而解鎖，
  但沒有證明網路失效原因。
- `send_packet_engine` 在新命令前檢查 FIFO，必要時使用 RSTLL 復原；這是新命令觸發，
  不是等候一分鐘觸發。既有 MAX_RT 樣本中，部分失敗後 FIFO 清理仍未取得 TX_EMPTY。
- 曾懷疑 RX 的 CE=1 會在切換 PTX 時留下自動發送條件；
  [BC5602 v1.20](https://www.holtek.com/webapi/116711/BC5602v120.pdf) 第 14 頁明載
  Light Sleep 命令會清除 CE。現有初始化先送 Light Sleep，因此不能僅以程式稍後才寫 CE=0
  判定它會自動重播殘留封包。SPI 命令是否實際生效仍須硬體證據。
- 本機使用的 ESPHome Wi-Fi 原始碼會每五分鐘進行一次 post-connect roaming 檢查，
  最多三次；RSSI 高於 −49 dBm 時略過掃描。這不是每 30 分鐘反覆執行的固定計時器。
  Wi-Fi 連線逾時門檻是 46 秒，但門檻與症狀時間相近不能證明曾發生重連。
- [BenQ 原廠說明](https://www.benq.com.cn/zh-cn/support/downloads-faq/faq/product/explanation/wtg-faq-0100.html)
  描述原廠控制器約 15 秒的省電休眠。這不是橋接器的休眠規則，也不足以解釋本次現象。

## 本輪實驗設計

1. 使用 App 保存的 Windows 憑證，核對裝置身分並讀取一份狀態。
2. 診斷程序不向裝置發送任何請求，等待 1800 秒。
3. 讀取第一份狀態，隨後每五秒取樣，共 13 筆；保留失敗階段與耗時。
4. 若查詢失敗，對 port 80、6053、8080 做 TCP 連線對照。
5. 最後讀取兩份既有 RAM RF 快照，沒有 RF 發送。
6. 使用者已另授權唯讀測試完成後的一次 OFF 診斷；此命令不重送，結果不明只查原命令。

基準查詢已成功。一次本機連線表檢查未看到到橋接器的 TCP 連線；
單次檢查不能證明整段期間沒有其他 App／主機流量。

Windows 封包監視器因缺乏管理員權限無法啟用，本輪沒有封包擷取證據。
沙箱內曾無法存取 Windows 憑證及 LAN，獲准在沙箱外執行後基準查詢成功；
前述本機權限錯誤不計為裝置故障。

本機探測器、未去識別報告及診斷過程留在 git-ignored `.esphome/`。

## 新增初始化前的診斷（尚未刷入）

既有 `fifo_steps[0]` 是 `setup_exact_pico` 執行後的讀值，不能還原晶片在閒置結束時的原始狀態。
本機補上 `pre_init_valid`、`pre_init_mode_valid`、`pre_init`，在初始化、清除 FIFO 及 TX strobe 前採樣。
陣列順序為 CFG、RC1、IRQ、FIFO、CE、RFCH、bank-0 STA1；只在原本 bank=0 時讀 STA1，
不為診斷切換 bank。`pre_init_mode_valid=false` 時，最後一格的零不能解讀為 Deep Sleep。
讀值依序取得，並非同一時刻的硬體鎖存。
手冊另指出 Deep Sleep 下 CSN 下降沿本身會啟動喚醒，因此此快照是「初始化前的 SPI 讀回」，
不是完全無侵入的睡眠狀態量測；不能僅憑它的 Light Sleep 讀值排除先前曾進入 Deep Sleep。

這些 SPI 讀取不發送 RF，不改動頻道、ACK、重試參數或既有復原條件，但會增加初始化前的少量時間，
後續實機比較必須記錄這項差異。新欄位僅擴充 port 80 的 RAM 診斷 JSON，不改變 App protocol v1。

C++ 快照保留、dispatcher、codec、地址學習測試（本機 MSVC）、28 項 Python 測試、
六項協定驗證及五份 C++ encoder fixtures 的 schema 核對均通過，
擴充後的 JSON 緩衝區上限為 1024 bytes。獨立假憑證組態的 ESPHome 2026.9.0 編譯成功，
映像約 922 KB、靜態 DRAM 使用 61,944 bytes。此映像僅供編譯驗證，不可直接部署到既有網路；
另以既有正式組態完成 ESPHome 2026.9.0 編譯，映像 921,779 bytes、靜態 DRAM 61,944 bytes；
OTA 映像 SHA-256 為 `9b96e482c26b8a7ccaa9ed0976250c3c5ae86a5811618b1b76abfaef24a9ec62`。
編譯完成時尚未刷入；其後經使用者授權完成 OTA，結果見下節。尚未驗證新欄位的實機發送資料，不宣稱修復。

## 實機結果：新命令觸發 FIFO 復原

30 分鐘不主動查詢後，13 筆 GET 全部成功，延遲 326–436 ms，開機識別與控制 revision 均未變。
沒有重現 HTTP 失效。末尾讀出的 last packet 與 last failure 均為同一筆歷史 OFF：
seq=320、MAX_RT、IRQ=`1E`、FIFO=`01`，初始／清理後／入列後 FIFO=`11/11/01`，
RT2=`00/10`、發送耗時 11,724 µs、失敗後清理仍為 `01`。
ACK 設定=`01/04/3F`、位址匹配，該筆沒有走發送前邏輯復原。

唯讀測試完成後，依本次明確授權送出一筆新 OFF：

| 觀察 | 結果 |
| --- | --- |
| 命令終態 | transmitted，planned/attempted/transmitted=`1/1/1` |
| 新快照 | seq=321，IRQ=`2E`、FIFO=`11`、RT2=`00/00` |
| FIFO 初始／清理後／入列後 | `01/11/01` |
| 發送前邏輯復原 | `logic_recovery=true` |
| 發送耗時 | 4,372 µs |
| ACK 設定／位址匹配 | `01/04/3F`／true |
| 與上一筆 packet 快照間隔 | 3,467.924 秒，約 57 分 48 秒 |
| 失敗快照保留 | 成功後 last failure 仍為 seq=320 |
| 使用者觀察 | 原本亮著，這筆命令後確實熄滅 |

兩個時間點分別測到失敗清理後 FIFO=`01`，以及約 58 分鐘後下一筆初始化後的 FIFO=`01`；
中間沒有新的 packet-engine 序號。這支持殘留 FIFO 在下一筆命令中經既有 RSTLL 復原清除，
但並非對中間整段時間的連續暫存器量測。不能將恢復描述為「等一分鐘便自動修復」。

這次確認了新命令觸發復原並實際成功控制掛燈的過程，尚未證明 seq=320 最初 MAX_RT 的原因。
該筆發送前 FIFO 為空，不能把它發送後的殘留倒推為首次失敗原因。
本輪測試沒有新增重送、補償命令或調整 RF 參數，測試當時尚未刷入新增診斷版。
原始報告留在 ignored `.esphome/idle-readonly-20260928-211637.jsonl` 與
`.esphome/idle-single-off-20260928-214754.jsonl`。

## 初始化前診斷版部署

使用者另行明確授權刷入後，已上傳上述 SHA-256 的正式組態 OTA 映像；ESPHome 回報 OTA successful。
刷入前唯讀保存 seq=321 成功與 seq=320 失敗快照。刷入後核對為同一裝置、開機識別已改變，
uptime 約 13 秒、radio/pairing 均為 ready、pairing_persisted=true；兩份快照均為 available=false。
部署及驗證沒有送出掛燈控制命令。新 pre_init 欄位仍待下一次操作產生實機資料，MAX_RT 根因未定。
原始部署記錄與前後唯讀快照保存在 ignored `.esphome/idle-diagnostic-upload.log` 與
`.esphome/idle-deploy-*.json`。

## 新版首次閒置操作：掛燈生效但 MAX_RT

使用者回報放置一段時間後操作正常，並在核對快照後明確確認「第一筆就正常有反應」。
唯讀取得同次開機的兩筆快照如下；開機時間不等同精確的無 RF 活動時間。

| 欄位 | 首筆 seq=1 | 下一筆 seq=2 |
| --- | --- | --- |
| uptime_ms | 3,340,418 | 3,369,616 |
| CMD / CONTROL | 2 / 17 | 3 / 17 |
| 終態 | MAX_RT | TX_DS |
| 發送前 pre_init（十六進位） | 00/30/0E/11/01/05/15 | 00/30/1E/11/01/05/15 |
| 初始化後／清理後／入列後 FIFO | 11/11/01 | 01/11/01 |
| logic_recovery | false | true |
| 終態 IRQ / FIFO | 1E / 01 | 2E / 11 |
| RT2 前／後 | 00/10 | 00/00 |
| 發送耗時 | 13,761 µs | 4,634 µs |

兩筆相隔 29.198 秒，pre_init_valid 與 pre_init_mode_valid 均為 true，
ACK 設定均為 01/04/3F，address_match=true。新初始化前欄位已在實機成功及失敗快照中取得。

這筆人眼確認把首筆問題縮小到成功確認路徑：掛燈已反應，但橋接器取得 MAX_RT；
尚不能區分掛燈未送 ACK、ACK 在空中遺失、橋接器未收到或未正確辨識 ACK。
不能將 MAX_RT 全部改判成功，歷史上也有人眼確認未生效的案例。
首筆初始化前與發送前 FIFO 均為 11，不能歸因於舊 TX FIFO 殘留。
第二筆初始化前 FIFO 也是 11，初始化後卻為 01，才觸發既有復原；
這也限制先前「殘留 FIFO 持續到下一筆」的推論，必須進一步檢查初始化與模式切換的影響。
這次沒有新增自動重送或調整 RF 參數；不能宣稱閒置問題已修復。

### 新快照的暫存器解讀

依 [BC5602 v1.20 手冊](https://www.holtek.com/webapi/116711/BC5602v120.pdf) 第 8、10、16 頁，
兩筆初始化前 RC1=30 表示 XCLK_EN 與 XCLK_RDY 均為 1；STA1=15 的低三位為 5，
表示當下在 RX 模式。這不是初始化後才讀到的模式，降低了「第一筆失敗時晶片仍未醒／時鐘未就緒」
的解釋力，但不代表整段閒置期間皆維持同一狀態。

STATUS 的 bit 4 與 bit 0 分別固定代表 TX_EMPTY 與 RX_EMPTY；手冊沒有將這兩個位元定義為
隨 PRX/PTX 模式交換，因此不能把第二筆 11→01 單純解釋成讀到另一個 FIFO。
第 28 頁描述 PRX 的 TX FIFO 用於 ACK payload，但不足以證明此次模式切換中的內部行為。
目前能定位的區間是 setup_exact_pico：它會停止 RX、切換 PRM_RX、重新寫入位址及封包／ACK 設定，
尚未寫入本筆 payload。需要該區間更細的硬體觀察或空中 ACK 證據，才能判斷狀態變化的原因。

### 歷史快照交叉核對

離線核對 17 份指定的快照／閒置／部署報告，以完整快照內容去重得到 9 筆：
有 logic_recovery 的 4 筆皆 TX_DS；未復原的 5 筆中 1 筆 TX_DS、4 筆 MAX_RT。
這只是被保存的快照集合，並非完整命令母體，不能估算成功率或推定復原具有因果效果。
更重要的是，本文件同目錄 RF_STABILITY.md「每筆發送前重置邏輯的對照實驗」已記錄：
即使每次 payload 前都 RSTLL，仍在第二筆／另一組第四筆 MAX_RT，該實驗已撤回。
因此不可因本次復原後成功，就重新提出每筆強制重置作為已知修復。
下一個有區辨力的證據是獨立觀測失敗當下是否有掛燈 ACK，以及 ACK 的時序／封包內容，
配合橋接器保存的 MAX_RT 快照；單靠相同暫存器繼續成功／失敗抽樣無法區分 ACK 未發與漏收。

### 現有硬體的下一步診斷

使用者沒有額外 RF 接收設備。先針對已觀察到的初始化期間 FIFO 變化新增 `init_fifo_valid`
及 `init_fifo`，依序讀取八個階段的 STATUS：停止 RX 並等待既有 1 ms、選 PRX 並處理 PWRON、
寫入頻道／速率／位址、選 PTX、DPL1、DPL2、CRC、ACK／重試設定完成。
只記錄新命令第一次初始化；後續既有 RSTLL 復原的初始化不覆蓋這份資料。
未指定診斷輸出陣列的其他呼叫不增加這八次讀取，正常控制則會增加初始化時間。
新增內容不改變暫存器寫入順序或數值、不新增 RF strobe 或重送，不能視為修復。
此實驗可定位 FIFO 變化的步驟，但不能獨立判明空中是否曾出現 ACK。
本機 C++ 快照保留／未採樣欄位清空／最大值輸出測試及 28 項 Python 測試通過。
分段診斷版在以下建置驗證完成時尚未部署，與僅有 pre_init 的上一版區分。
ESPHome 2026.9.0 正式組態編譯成功：映像 922,111 bytes、靜態 DRAM 61,960 bytes，
OTA SHA-256=`c745031cd3fe9ace7782eae84cd94b60e35f6133a0598e33d2008a39ca7f9aa2`；
已核對映像包含 init_fifo_valid 欄位。建置日誌留在 `.esphome/idle-init-stages-compile.log`。

使用者明確同意刷入分段診斷版後，OTA 回報成功。刷入前已保存上述 seq=1／2 快照；
刷入後唯讀確認同一裝置、開機識別改變、uptime 約 11 秒，radio/pairing ready、
pairing_persisted=true，兩份快照均 available=false。沒有額外送出控制命令。
上傳日誌在 `.esphome/idle-init-stages-upload.log`，前後快照在 `.esphome/idle-deploy-*.json`。
分段欄位仍待使用者操作後的實機資料驗證，尚未確定 FIFO 變化點或 MAX_RT 根因。

## 2026-09-29 分段診斷版正常操作樣本

使用者確認「掛燈都有成功正常反應」。唯讀取得部署後同次開機的 seq=3，
last failure 為 available=false，表示這次開機截至讀取時尚無 packet-engine 失敗紀錄。
最新一筆 uptime=2,907,348 ms（約 48 分 27 秒）、CMD=3、CONTROL=17，
TX_DS、IRQ=2E、終態 FIFO=11、RT2=00/00、耗時 3,936 µs；logic_recovery=false。
pre_init=00/30/0E/11/01/05/15，init_fifo_valid=true，八個 init_fifo 採樣全部為 11。
ACK 設定=01/04/3F、address_match=true。

這證明八階段診斷欄位可在實機讀取，且最新一筆不需復原即可正常完成。
本輪沒有重現初始化期間的 11→01 變化或 MAX_RT；不能據此判定故障已修復，
因新增 SPI 讀取改變初始化時序，而且目前只有三筆 packet-engine 操作，
前兩筆的完整快照未保留。最新一筆的開機時間不能視為每筆操作前的閒置時間。
原始資料保存在 ignored `.esphome/idle-deploy-after-*.json`；沒有額外送出控制命令。

後續使用者再次確認「目前操作看起來都正常」。同次開機快照已增至 seq=5，
last failure 仍為 available=false；最新一筆 uptime=4,014,395 ms（約 66 分 54 秒）、
CMD=2、CONTROL=17、TX_DS、IRQ=2E、FIFO=11、RT2=00/00、耗時 4,309 µs。
未觸發邏輯復原，八個初始化 FIFO 採樣仍全部為 11，pre_init 與上一筆保存樣本相同。
目前累計五筆操作未記錄失敗，與使用者觀察一致；仍非故障根因或長期穩定性的證明。

使用者再回報「剛剛又操作了幾次，看起來都正常」後，唯讀快照增至 seq=8，
同次開機 last failure 仍為 available=false。最新一筆 uptime=5,236,290 ms
（約 87 分 16 秒）、CMD=3、CONTROL=17、TX_DS、IRQ=2E、FIFO=11、RT2=00/00、
耗時 4,558 µs，未觸發邏輯復原；pre_init 不變，八個 init_fifo 仍全部為 11。
累計八筆操作無 packet-engine 失敗紀錄，並有使用者正常反應回報。
開機超過一小時不等同完成連續一小時閒置測試；目前仍無分段診斷版的故障樣本。

## 2026-09-29 分段診斷版捕捉 MAX_RT

使用者其後回報操作時燈有成功變化，但有時狀態顯示失敗。唯讀取得同次開機
last failure seq=20 與 last packet seq=28；這份回報是整體觀察，未逐筆對應每個命令。

| 欄位 | 保留的失敗 seq=20 | 最新成功 seq=28 |
| --- | --- | --- |
| uptime_ms | 11,121,364 | 11,148,214 |
| CMD / CONTROL | 3 / 17 | 2 / 17 |
| 終態 IRQ / FIFO | 1E / 01（MAX_RT） | 2E / 11（TX_DS） |
| RT2 前／後 | 00/10 | 00/00 |
| 發送耗時 | 12,503 µs | 4,081 µs |
| logic_recovery | false | false |
| pre_init（十六進位） | 00/30/0E/11/01/05/15 | 相同 |
| init_fifo 八階段 | 全為 11 | 全為 11 |
| FIFO 初始化後／清理後／入列後 | 11/11/01 | 相同 |
| ACK 設定／位址匹配 | 01/04/3F／true | 相同 |

失敗後清理 FIFO 仍為 01、RC1=30。最後成功快照距失敗快照 26.850 秒，
中間有其他新命令，不能視為單純等待後自動恢復。seq=21–28 未覆蓋 last failure，
表示這八筆在 packet-engine 成功；無完整歷史不能由 seq=20 推算前二十筆的失敗總數。

這是分段版首次保存的失敗證據：八個初始化採樣均正常，發送前也沒有舊 TX FIFO 殘留，
因此先前觀察到的初始化 11→01 變化不是發生 MAX_RT 的必要條件。
新增分段採樣並未消除故障，先前八筆正常不代表已修復。
失敗前 IRQ=0E、終態 IRQ=1E 與 RT2=10 表示本輪硬體回報重試耗盡，並非 UI 自行誤報或
沿用發送前的 MAX_RT 旗標；但這不證明燈未收到命令。
後續仍需區分燈未回 ACK、ACK 遺失與橋接器接收／辨識問題；目前暫存器證據不足以定案。
原始資料保存在 ignored `.esphome/idle-deploy-after-*.json`，本次僅唯讀取證。

## 2026-09-29「已斷線，重試中」回報

使用者其後回報數次操作中一次出現斷線重試訊息。唯讀 API 目前正常回應，
uptime=32,206,213 ms，與前次觀察 boot_id 相同，未發現橋接器重啟；radio/pairing ready。
最新 packet seq=36，uptime=32,148,729 ms，CMD=3、CONTROL=1，TX_DS、IRQ=2E、
FIFO=11、RT2=01/00、耗時 3,789 µs，未觸發復原，八階段 init_fifo 均為 11。
last failure 仍為先前 seq=20，未記錄新的 packet-engine 失敗。

現行 ControlApp.tsx 的 refresh() 在狀態查詢發生非 BUSY 錯誤時即 setOnline(false)，
成功讀回狀態後才恢復 online；可見頁面每 2 秒查詢，切回前景亦查詢。
因此此訊息本身只能表示 App 未取得有效狀態，不能直接判定 ESP32 Wi-Fi 斷線或 RF 失敗。
bridge-core 設定連線逾時 2 秒、整體 HTTP 請求逾時 4 秒，傳送失敗與回應中斷皆可能成為 NETWORK；
其他非 BUSY 錯誤也可能觸發同一離線顯示，仍須當次錯誤碼佐證。
本機 Windows diagnostics.json 最後修改為 2026-09-28 21:02:59，未涵蓋本次事件，
不能拿其舊錯誤替本次定因。已詢問操作平台、是否剛從背景返回及恢復時間，待使用者補充。

使用者補充是在 Windows App，前面已操作數次才出現離線訊息，並非已知的前景恢復觸發。
已確認執行中的 halodesk.exe 來自本機 app/target/debug，於 2026-09-29 02:11 啟動，
可執行檔建置時間為當日 00:14；專案 identifier 仍為 io.github.kashionz.halo2。
App 專用 Roaming／Local 目錄內只找到上述未更新的 diagnostics.json；檔案能讀取、
格式為事件陣列，現有使用者 ACL 列有 FullControl，但這些不足以證明執行中程序能成功寫入。
未更動或清除歷史診斷、未重啟 App、未修改連線或 RF 行為。
已請使用者提供 App 診斷頁的最新連線錯誤時間／錯誤碼，或儲存錯誤提示，
以區分當次 HTTP 故障與診斷記錄無法更新的另一個問題；尚未證明兩者有共同原因。

使用者看到診斷頁「連線 · 失敗，08:07:11」，證明 App 頁面有比上述磁碟檔更新的事件。
因此舊檔未更新不能直接定性為執行中 App 的記錄故障；資料來源仍待核對。
目前尚未取得該事件的 error_code，已請使用者從同一頁匯出診斷 JSON 並提供本機路徑，
以讀取事件前後文，避免將 NETWORK、PROTOCOL_ERROR 等不同原因混為一談。

### Windows 匯出紀錄確認

使用者提供 App 匯出檔後，原始資料保存至 ignored
`.esphome/windows-disconnect-20260929-export.json`。匯出包含最近 200 個事件：
49 個 error 事件皆為 NETWORK，所有非空 boot_id 一致。依 command_id 去重後有
28 筆命令（23 transmitted、5 failed）；命令回傳與狀態觀察可能各記一列，不能直接以列數當命令數。
200 筆為保留上限，重複相同非命令事件亦可能被合併，不能據此計算整段使用的失敗率。

本次使用者指出的兩個時間點如下（本機時間 UTC+8）：

| 事件 | 下一筆 ready | 間隔 | 前後 control_revision |
| --- | --- | --- | --- |
| 08:03:10.975 NETWORK | 08:03:17.169 | 6.194 秒 | 43→43 |
| 08:07:11.136 NETWORK | 08:07:13.782 | 2.646 秒 | 45→45 |

兩個 error 都沒有 command_id／TX 結果；前後可見命令為 transmitted。
結合 App 狀態輪詢程式與穩定的橋接器 boot_id，證據指向 HTTP 狀態查詢的短暫傳輸故障，
而非這兩次由 MAX_RT 或橋接器重新開機造成離線。一次查詢錯誤即將 online 設 false，
下一次成功讀回則恢復，因此短暫查詢失敗足以呈現使用者看到的斷線／重試提示。
上述時間差是已記錄錯誤到恢復的間隔，不包含請求報錯前等待，也不是完整網路中斷時間。
匯出僅保存 NETWORK，未保留 connect/send/body、timeout 或底層錯誤類別，
目前不能進一步判定 TCP 建連、連線重用、回應讀取或 Wi-Fi 哪一層造成。
此紀錄也不支持只將其歸因於剛切回前景，因無新控制 revision 時也反覆出現 NETWORK。

### 相同 Rust HTTP 設定的唯讀重現

新增 `app/bridge-core/examples/transport_probe.rs`，只 GET `/api/v1/state`，沿用 App 的
reqwest、no_proxy、禁止 redirect、2 秒 connect timeout／4 秒總 timeout 及連線池設定。
上限 120 筆，成功後等待 2 秒再查，首次錯誤停止；這與 UI 固定 interval 的排程並非完全相同。
錯誤只輸出固定分類、階段及底層 io::ErrorKind，不輸出端點、帳密或原始錯誤文字。
程式已通過編譯、cargo fmt 檢查與該 example 的 clippy -D warnings。
憑證由既有 Windows 憑證庫取得，只經子程序環境傳入，未讀取 secrets.yaml。

2026-09-29 08:15 開始的探測前 33 筆成功，device/boot 與 revision=48 均未改變。
第 34 筆回報 phase=send_or_headers、elapsed_ms=2011、timeout=true、connect=true、
request=true、body=false、io_kind=TimedOut。這定位到建立連線階段逾時，尚未取得 HTTP 回應；
可以在沒有新控制 revision 的唯讀流量中重現，不需要 RF/MAX_RT 同時發生。
這是獨立重現樣本，不能倒推 08:07:11 的原始 NETWORK 必然是同一底層錯誤。

後續短檢查 TCP 8080／80／8080 均成功（312／12／6 ms），狀態 GET 45 ms 成功，
radio ready、revision 仍為 48、uptime=32,999,085 ms。這是事後恢復檢查，
不能證明逾時當下其他連接埠也可達。
目前仍須分辨建立連線逾時是主機解析、TCP 建連／伺服器連線資源或網路丟包，
不能只因 server max_open_sockets=3、recv_wait_timeout=2 就認定其為根因。
原始報告留在 ignored `.esphome/rust-transport-20260929-081541.jsonl` 及
`.esphome/transport-followup-*.jsonl`；探測與後續檢查均未送出 RF。

### 第二輪：數字 IP 與立即雙埠檢查

唯讀核對保存的探測端點為數字 IP、port=8080，故上述探測的建連逾時不涉及 DNS／mDNS。
工具新增時間戳與首次錯誤後立即、並行各一次的 TCP 80／8080 連線檢查；
不重送原 GET，也沒有 POST 或 RF，更新後已重新編譯並通過格式與 clippy 檢查。
第二輪 `.esphome/rust-transport-20260929-081900.jsonl` 也在前 33 筆成功後，
第 34 筆 connect timeout，耗時 2,012 ms，io_kind=TimedOut，revision 始終為 48。
錯誤記錄後 16 ms，兩個埠的獨立 TCP 檢查均成功，各耗時 15 ms。
這限制了「持續整機／網路失聯」的解釋，但不能證明原先 2 秒內每個時刻可達，
也不能用新 socket 成功否定先前那個 socket 的逾時。

兩輪相同筆數值得追查連線建立／回收條件，但不足以定義固定第 34 筆故障。
實際 build 設定為 MAX_SOCKETS=24、MAX_ACTIVE_TCP=16、TCP_ACCEPTMBOX_SIZE=6，
TCP_MSL=60000 ms、FIN_WAIT_TIMEOUT=20000 ms；8080 HTTP server max_open_sockets=3、
LRU purge 開啟、recv/send wait=2 秒。一次主機 TCP 快照僅見一條 8080 TIME_WAIT，
並非裝置內部或整段期間的 socket 統計，不能據此排除資源問題或宣布資源耗盡。

### 查詢間隔對照與連線關閉事實

探測新增 `--one-second`，只將查詢成功後等待時間從 2 秒改成 1 秒，
並記錄回應的 Connection: close 標頭；App 與韌體設定未改動。
`.esphome/rust-transport-20260929-082220.jsonl` 的 120 筆全成功，
第一至最後一筆相隔 123.719 秒，最慢 745 ms，所有回應皆 Connection: close。
核對 halo2_api.cpp，respond() 確實對每次回應設定此標頭並要求關閉 session，
故不能將先前錯誤解釋為重用過期 keep-alive 連線，也不能把本輪成功歸因於保持連線。
這是較密集的新連線對照，單次通過仍不足以證明 1 秒間隔解決問題。

電腦通往橋接器的介面是 RZ616 Wi-Fi 6E，Windows 無線省電設定 AC 為最高效能、
DC 為中度省電；僅查閱，未更改。WLAN-AutoConfig/Operational 日誌已啟用，
07:55–08:10 查無事件，沒有本機 Wi-Fi 重連事件可對應 08:03／08:07 的 NETWORK；
不代表這段時間沒有無線丟包或 AP／橋接器端問題。

切回原先 2 秒間隔的反向對照 `.esphome/rust-transport-20260929-082446.jsonl`
亦完成 120 筆，第一至最後一筆 243.166 秒，最慢 330 ms，全部 Connection: close。
因此先前兩次第 34 筆逾時不是穩定可重現的筆數上限，也沒有足夠證據認定
改用 1 秒間隔能修復問題；不據此修改 App 輪詢頻率或韌體 timeout。
再次只讀 `pktmon status` 回報無法與驅動程式通訊／存取被拒，未啟動封包擷取。
這是 Windows 權限限制，並非工具自動審核拒絕；當前仍缺少故障時 TCP 握手封包，
無法區分 SYN 未到橋接器、SYN-ACK 未回到電腦或其他短暫堆疊／資源問題。

### 2026-09-29 管理員擷取驗證

使用者以 gsudo 確認 PktMon 未執行且無篩選器後，透過 gsudo 成功取得管理員權限。
本機腳本先核對這兩項前置條件，僅為橋接器 IP／TCP 8080 建立 SYN 篩選，
每包截取 64 bytes、16 MB 循環檔，搭配最多 120 筆 GET 探測，子程序另設 280 秒上限；
finally 停止擷取並清除這個在空篩選器狀態下建立的篩選。未發送 RF。

`.esphome/rust-transport-20260929-085302.jsonl` 的 120 筆全部成功，最慢 441 ms。
然而 NIC 層的 ETL 轉為 pcapng 後封包數為 0，不能當成沒有丟包或沒有握手的證據。
另以幾次已知成功的 TCP 連線做兩個數秒短測：
一是所有元件、同一 SYN 篩選；二是所有元件、同一主機／埠的 TCP 篩選，
僅截取前 40 bytes（不收 HTTP 內容）。兩者轉檔仍均為 0 封包，
即使測試 TCP 連線及 GET 均成功。尚未確定是擷取堆疊、篩選或 PktMon 相容性問題。
權限已不再是這輪阻礙，但擷取方法尚未通過「可看見已知成功連線」的驗證。

三輪均已停止並清理；最後 gsudo pktmon status 回報未執行，filter list 回報無。
原始 ETL／pcapng／工具日誌留在 ignored `.esphome/handshake-20260929-085301`、
`handshake-20260929-085814`、`handshake-20260929-085923`。
本機 pcapng 解析器已用人工建構的成功握手及重複 SYN 未回覆樣本驗證配對與時間，
但本輪實機檔案為空，未產生可用的握手結論。
