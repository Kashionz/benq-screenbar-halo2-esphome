# Handoff: Halo 2 Control — 透明壓克力 UI 重構

## Overview
重構 Halo 2 Control（Tauri 2 + React，`app/src/*.tsx`）的整體介面：
- 主視窗：單一控制畫面（掛燈預覽 + 燈光群組），裝置與診斷改為整頁推入。
- 系統匣（Windows）／選單列（macOS）：新增可調整燈光的快速控制面板。
- 桌面 1050×780 與 iPhone 390 寬兩種版面，淺色主題。

產品規則以 `APP_DESIGN_BRIEF.md` 為準，下列「行為變更」除外。

## About the Design Files
本資料夾內的檔案是 **HTML 設計參考**（可互動原型），不是要直接上線的程式碼。請在既有的 `app/` 專案（React + TypeScript + Tauri）中，依現有架構重新實作：
- 沿用 `bridge.ts` 的 commands 與型別、`ControlApp.tsx` 的輪詢／命令流程與 `generation` 防護。
- 樣式可改寫 `halo.css` 或改為 CSS modules，但數值請照本文件。
- `halo-model.js` 是**模擬**橋接器（假資料、setTimeout），只用來說明狀態與文案，不要搬進 App。

開啟方式：用瀏覽器開 `Overview.dc.html`（需與 `support.js`、`halo-model.js`、`Halo Main.dc.html`、`Halo Tray.dc.html` 在同一資料夾；需經本機 http server，例如 `npx serve`）。上方可切換 11 種狀態。

## Fidelity
**High-fidelity。** 顏色、字級、圓角、陰影、間距、文案皆為定稿，請依本文件與 HTML 原始碼精準實作。

## 行為變更（與 APP_DESIGN_BRIEF 不同之處）
1. **移除「啟用實驗性控制」開關**。mode / front_brightness / back_brightness / temperature_k 視為正式功能。需同步：協定 `features` 改回報 `verified`，或 App 端不再以 `experimental` 停用控制；`setState` 不再傳 `experimental` 旗標（請確認 bridge-core 端的對應行為）。「實驗性未啟用」狀態不再存在。
2. **電源改為單一按鈕**。仍送出**明確**的 `power(true|false)`，值取 `!desired.power`；`aria-label` / tooltip 為「開燈」或「關燈」。不可送 toggle。
3. **掛燈示意圖顯示預覽**：有草稿時，示意圖使用 `desired ⊕ draft` 的模式、亮度、色溫，左上標籤改為「預覽 · 尚未套用」；無草稿時為「目標示意」。電源部分永遠只看 `desired.power`。
4. **系統匣改為面板**（原生選單放不下滑桿）：見「Tray Flyout」。
5. 文案全面精簡（見「Copy」）。

## Screens / Views

### 1. 主視窗 — 已連線（`Halo Main.dc.html`，scenario `ready`）
**Root**：`height:100%`，flex column，`background:#e6e8ec`，字體 `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang TC', 'Noto Sans TC', sans-serif`（Windows 會落到 Segoe UI / 微軟正黑體，可接受；建議明確加入 `'Segoe UI Variable'`），`line-height:1.5`，`-webkit-font-smoothing:antialiased`，文字色 `#1d1d1f`。

**Header**（min-height 52，padding `8px 18px`，gap 12）
- 壓克力：`background:rgba(255,255,255,0.3)`，`backdrop-filter:blur(14px) saturate(160%)`，`border-bottom:1px solid rgba(255,255,255,0.9)`，`box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 .5px 0 rgba(40,50,70,.14), 0 8px 20px -10px rgba(30,40,60,.12)`。
- 標題「Halo 2 Control」15px/700（裝置頁時為「裝置與診斷」，左側加返回鈕「‹ 燈光」14px `#0a74e8`）。
- 連線徽章：padding `2px 10px`，radius 6，12px，6px 圓點。顏色見 Tokens › 狀態色；連線中／斷線時圓點 `pulse 1.2s ease-in-out infinite`（opacity 1→.3）。
- 右側「裝置與診斷 ›」：min-height 36，padding `2px 12px`，radius 99，`background:rgba(255,255,255,.6)` + blur(20px)，13px。

**Content**：可捲動，padding `20px 20px 24px`。Grid `repeat(auto-fit, minmax(min(100%,330px),1fr))`，gap 18（手機 16），`align-items:start`。
- 桌面：左欄（gap 14）＝預覽圖 → 目標 → 最近命令；右欄（gap 18）＝燈光群組。
- 手機（iOS）：兩欄攤平為單欄，順序＝**預覽圖 → 燈光群組 → 目標 → 最近命令**（原型以 `display:contents` + `order` 1/2/3/4 實作）。

**壓克力群組（所有卡片共用）**
```
border-radius:16px (預覽圖 20px);
background:rgba(255,255,255,0.34);
backdrop-filter:blur(14px) saturate(160%);
border:1px solid rgba(255,255,255,0.9);
box-shadow:
  inset 0 1px 0 rgba(255,255,255,.95),
  inset 0 -1px 0 rgba(255,255,255,.5),
  inset 1px 0 0 rgba(255,255,255,.6),
  inset -1px 0 0 rgba(255,255,255,.6),
  inset 0 0 0 4px rgba(255,255,255,.18),
  0 0 0 .5px rgba(40,50,70,.14),
  0 2px 3px rgba(30,40,60,.05),
  0 18px 36px -12px rgba(30,40,60,.16);
overflow:hidden;
```
群組上方小標：padding `0 14px 6px`，12px，`#8e8e93`，letter-spacing .2px。列分隔線：`0.5px solid rgba(60,60,67,0.14)`。**全介面不使用漸層**。

**A. 預覽圖**（高 200，手機 170；離線時 opacity .5）
側視示意，全部為絕對定位的純色形狀：
- 牆線：right 8%、top 0、bottom 18%，寬 2px；桌面線：bottom 18%，高 2px；色 `rgba(60,60,67,.2)`。
- 螢幕：left 63%、top 26%，6×44%，radius 3，`#1d1d1f`；支架 left 64% top 70% 2px×12%；底座 left 58% top 81% 12%×3px。
- 燈條：left 59%、top 21%，9%×6%，radius 4，`#1d1d1f`；開燈時 `box-shadow:0 0 14px <色溫色>`。
- 前燈光束：`clip-path: polygon(60% 27%, 64% 27%, 30% 82%, 6% 82%)`；後燈光束：`clip-path: polygon(64% 22%, 66% 26%, 92% 44%, 92% 2%)`。
  - 顏色（純色，alpha .55）依色溫分段線性插值：2700K `rgb(255,164,60)` → 4600K `rgb(255,214,140)` → 6500K `rgb(96,160,255)`。
  - 不透明度：該路亮著時 `0.3 + 0.7 × 亮度/100`，否則 0；`transition: opacity .4s`。
  - 「亮著」＝ `desired.power` 且模式包含該路（front / back / both）。模式、亮度、色溫取預覽值（desired ⊕ draft）。
- 標籤：左上「目標示意」／「預覽 · 尚未套用」11.5px `#6e6e73`，`white-space:nowrap`；前燈標籤（left 14% top 52%）「前 60%」、後燈標籤（left 74% top 10%）「後 35%」，12px，`background:rgba(255,255,255,.72)`，radius 4，padding `1px 6px`；右下「4000 K」11.5px。

**B. 燈光群組**（由上而下）
1. 群組小標列：僅在停用時於右側顯示「已停用：{原因}」。
2. **電源列**（padding `12px 14px`，gap 14）
   - 圓形按鈕 56×56（Tray 44×44），圖示 24px（Tray 20px），SVG：`<path d="M12 3.2v7.6"/><path d="M7.1 6.1a7.6 7.6 0 1 0 9.8 0"/>`，stroke 1.9，round caps/joins，`stroke=currentColor`。
   - 開啟：`background:#0a74e8`，icon `#fff`，`box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 1px 2px rgba(10,80,180,.25)`。
   - 關閉：`background:rgba(255,255,255,.7)`，icon `#1d1d1f`，`box-shadow: inset 0 1px 0 #fff, 0 0 0 .5px rgba(40,50,70,.18), 0 1px 3px rgba(0,0,0,.08)`。
   - 右側文字：「開啟」／「關閉」17px/600；下行「按一下關燈／開燈」12px `#8e8e93`。
   - 停用：opacity .35，cursor not-allowed。
3. **模式列**（min-height 52，padding `6px 14px`）：左「模式」14px（有草稿時後接 6px 藍點 `#0a74e8`）；右分段控制：外框 padding 2，radius 9，`rgba(118,118,128,.12)`；項目 min-height 32，padding `2px 12px`，radius 6，13px；選中 `#fff` + `0 1px 2px #0002`；選中且為草稿時文字 `#0a74e8`；未選 `#6e6e73`。
4. **滑桿 ×3**（前燈 1–100%、後燈 1–100%、色溫 2700–6500 K step 25），每列 padding `12px 14px 10px`：
   - 標題列（center 對齊）：名稱 14px（草稿時後接 6px 藍點）；右側數值 14px tabular-nums，草稿 `#0a74e8`，否則 `#1d1d1f`。**不顯示原值／刪除線／「草稿」字樣**。
   - 軌道區高 28，margin-top 4：軌道 top 12、高 4、radius 2、`rgba(118,118,128,.2)`；填色（0→值）草稿 `#0a74e8`／否則 `#1d1d1f`（色溫也有填色）。
   - 目標標記（僅草稿時）：10px 圓，top 9，`background:#f4f5f7`，`box-shadow:0 0 0 1.5px rgba(60,60,67,.35)`，位於 desired 值位置，title「目前目標」。
   - 拖曳點 26px（Tray 22px），top 1：白色（色溫列為目前色溫色，見 `tempColor`：2700K `#ffc466` ↔ 6500K `#e0ecff` 線性）；陰影 `0 1px 2px rgba(0,0,0,.12), 0 3px 8px rgba(0,0,0,.14)`；草稿時加 `inset 0 0 0 2px #0a74e8`。`transition: box-shadow .2s`。
   - 原生 `<input type=range>` 疊在最上層 `opacity:0` 負責互動；實作時請改用可聚焦的自訂 slider 或保留原生 range 並補 `:focus-visible` 樣式（`outline:2px solid #0a74e8; outline-offset:2px`）。
5. **情境**（padding `10px 14px 12px`）：標題列「情境」14px + 右側「編輯／完成」13px `#0a74e8`。
   - 膠囊列（wrap，gap 6，margin-top 8）：min-height 32，padding `2px 14px`，radius 99，13px；一般 `rgba(118,118,128,.12)` / `#1d1d1f`；與目前預覽值完全相同者 `#fff` / `#0a74e8` + `0 0 0 1px rgba(10,116,232,.5), 0 1px 2px rgba(0,0,0,.08)`；`title` = 摘要。點擊＝帶入草稿（只帶與 desired 不同的欄位），**不顯示提示訊息**。
   - 無情境：「尚未保存情境」13px `#8e8e93`。
   - 編輯展開：radius 12，`rgba(118,118,128,.08)`；每列 min-height 44：名稱 13.5px + 摘要 11.5px `#6e6e73`「前後燈 · 前 70% · 後 30% · 4300 K」+「刪除」`#d9362b`；最後一列輸入框（placeholder「以目前設定新增情境」，maxlength 40）+「保存」`#0a74e8`。最多 20 組，不含電源。
6. **套用列**（min-height 52，padding `8px 10px 8px 14px`）：
   - 文字 13px：有草稿「{n} 項變更尚未套用」`#1d1d1f`，背景 `rgba(10,116,232,.06)`；無草稿「按套用才會送出」`#8e8e93`；停用「已停用：{原因}」。
   - 「取消調整」：透明、`#0a74e8`、radius 99、min-height 34。
   - 「套用燈光設定」：`#0a74e8` / `#fff` / 600，radius 99，padding `2px 16px`，**無光暈**。
   - 無可套用時兩鈕 opacity .4。

**C. 目標清單**：小標「目標」（離線時「最後已知目標 · 21:13:52」）；4 列 min-height 44：電源（開啟/關閉，700）、模式、亮度與色溫「前 60% · 後 35% · 4000 K」、來源（本 App / 原廠控制器 / 橋接器網頁 / 開機還原）。

**D. 最近命令**：8px 狀態點 + 標題 14px/700（色依狀態）+ 說明 12.5px `#6e6e73`；結果不明時右側「查詢命令結果」按鈕（`#0a74e8`，min-height 34，radius 7）。下方分隔列：「原廠控制器：開燈 · 前後燈 · 60% / 35% · 4000 K」+ 右側「12 秒前」`#8e8e93`。

**E. 橫幅**（位於 content 頂部，僅在斷線／結果不明／處理中／重新開機時）：radius 10，padding `10px 12px 10px 14px`，8px 點 + 「**標題**　說明」13px + 右側動作鈕（min-height 34，radius 7，白底）。

### 2. 主視窗 — 裝置與診斷（整頁推入）
取代主內容（max-width 560，置中，gap 18）。群組：
- 橋接器：名稱 700 + `host:port` 12.5px；無線模組、配對、最後同步（min-height 44 列）。
- 動作：重新整理、中斷連線／更換裝置（`#0a74e8`）、忘記已保存連線（`#d9362b`），min-height 46。
- 診斷：小標「診斷 · 最近 5 筆：3 成功 · 1 結果不明 · 1 失敗」；事件列（7px 點 + 「關燈 · 結果不明」+ 時間 tabular）；「顯示原始資料」展開後每列加 mono 11.5px 的 `錯誤碼 · TX 7/12 · IRQ 20 · FIFO 3`，並顯示 JSON（device_id / boot_id / radio / last_command）；「匯出診斷 JSON」；「清除歷史紀錄」紅字。下方「保留最近 200 筆」。iPhone 匯出後加一行「到「檔案」→「我的 iPhone」→「Halo 2 Control」→「Halo2Control」取用。」
- **錯誤碼與 TX/IRQ/FIFO 只在這裡、且需展開原始資料才顯示。**

### 3. 主視窗 — 首次連線（scenarios first / searching / noresults / connecting）
max-width 520 置中，gap 18：
- 標題「連線橋接器」22px/700；副標「本機連線，不經雲端。」13px。
- （有保存時）「已保存」群組：`host:port`、「使用已保存帳密連線」、「忘記已保存連線」。
- 「區域網路」群組：「搜尋區域網路」列（搜尋中顯示「搜尋中…約 5 秒」+ 14px spinner，`spin .8s linear infinite`）；結果列（名稱 14px + `host:port` 12px，選取者右側「✓」）。訊息：找不到「找不到橋接器，可直接輸入 IP。」+ 平台提示（Windows「若曾拒絕防火牆提示，請到「Windows 安全性」允許。」/ macOS「請確認未開 VPN。」/ iOS「請在「設定」→「隱私權」→「區域網路」允許。」）；選取後「已填入，請輸入密碼。」並清空密碼。
- 「手動輸入」群組：主機、連接埠、帳號、密碼（左 label 96px、右對齊輸入）；「記住此連線與帳密」開關（40×24，on `#0a74e8`）。下方「密碼存於{Windows 認證管理員 / macOS 鑰匙圈 / iOS 鑰匙圈}」。
- 主要按鈕「連線」／「連線中…」：min-height 46，radius 14，`#0a74e8`，15px/600。
- 搜尋中時連線鈕 opacity .4；連線中時搜尋列 opacity .4、表單停用。

### 4. Tray Flyout（`Halo Tray.dc.html`，寬 340）
Windows：從系統匣圖示上方彈出（radius 10）；macOS：從選單列圖示下方彈出（radius 14）。
- 容器：`rgba(246,247,249,.62)` + `blur(24px) saturate(170%)`，1px 白框，`box-shadow: inset 0 1px 0 rgba(255,255,255,.95), inset 0 0 0 4px rgba(255,255,255,.16), 0 0 0 .5px rgba(40,50,70,.2), 0 24px 48px -12px rgba(30,40,60,.32)`。
- 頂部：「ScreenBar Halo 2」14px/600；下行 12px「● 已連線 · 目標開啟 · 前後燈」（單一 span，nowrap + ellipsis）；右側「開啟 Halo 2 Control」膠囊。
- 狀態列（僅非就緒時）：radius 12，7px 點 + 「**標題** 說明」12.5px；結果不明時右側「查詢」（開啟主視窗）。
- 內層卡：電源列（44px 按鈕）→ 模式分段（草稿模式文字旁 4px 藍點）→ 三列 inline 滑桿（名稱 40px 寬 + 軌道 + 數值 58px 右對齊）→ 有草稿時的套用列。
- 情境膠囊（僅快選，不能編輯）。
- 底部：「同步 21:14:08」11.5px `#8e8e93`（未連線「NO CLOUD」）+「結束」。
- 停用條件與主畫面相同；未連線時全部停用。
- 實作：Tauri 無邊框、置頂、`skipTaskbar` 的小視窗，定位於 tray icon 旁，失焦（blur）自動隱藏；與主視窗共用同一個 bridge session 與狀態（建議由 Rust 端 emit 狀態事件給兩個 webview）。iOS 無此功能。

## Interactions & Behavior
- **輪詢**：每 2 秒 `bridge.state()`；回前景立即同步；命令進行中不輪詢（沿用現有 `refreshing` / `commanding` 邏輯）。
- **草稿**：拖曳／點模式／點情境只改 `draft`；值等於 desired 時從 draft 移除該欄位。「套用燈光設定」只送 draft 欄位，成功（transmitted）後清空；「取消調整」清空。
- **命令**：送出時 `cmd = executing` → 全部控制停用、橫幅「處理中」。結果：transmitted「指令已送出」／failed「發送失敗」＋錯誤碼（僅診斷）／expired／superseded／其他＝「結果不明」。
- **結果不明**：停用所有控制；橫幅＋最近命令都提供「查詢命令結果」（`bridge.lookup()`）；不自動重送，重新連線不重播。
- **停用條件**（主畫面與 Tray 相同）：`online && radio_status==='ready' && pairing_status==='ready' && features.power==='verified' && !active_command && fault?.code!=='UNKNOWN_OUTCOME' && !busy`。原因字串優先序：已斷線 → 無線模組未就緒 → 處理中 → 結果不明，請先查詢。
- **斷線**：徽章「已斷線 · 重試中」；橫幅「已斷線，重試中」「最後同步 21:13:52。不會重送先前的操作。」＋「立即重試」；預覽圖 opacity .5；目標小標改「最後已知目標 · 時間」。
- **重新開機（boot_id 改變）**：清除舊結果；橫幅「橋接器已重新開機」「已重新同步，先前的命令結果無法查詢。」＋「知道了」。
- **原廠控制器**：`observed_remote` 顯示在最近命令卡下方，「約 N 秒前」由 `uptime_ms - received_at_uptime_ms` 計算。
- 動畫：開關 knob `left .15s`；光束 `opacity .4s`；拖曳點陰影 `.2s`；pulse 1.2s；spinner .8s。尊重 `prefers-reduced-motion`（關閉 transition / pulse）。

## State Management
沿用 `ControlApp.tsx`：`snapshot`、`connected`、`online`、`busy`、`fault`、`networkFault`、`result`、`saved`、`updated`。新增／調整：
- `draft: Partial<{mode, front_brightness, back_brightness, temperature_k}>`（提升到 App 層，讓預覽圖可讀）。
- `panel: 'main' | 'device'`（整頁推入）；`showRaw: boolean`；`presetsEditing: boolean`。
- 移除 `experimental` state。
- 預覽值 `preview = { ...snapshot.desired.values, ...draft }`。

## Design Tokens
**顏色**
- 背景 `#e6e8ec`；文字 `#1d1d1f`；次要 `#6e6e73`；三級 `#8e8e93`；停用灰 `#aeaeb2`
- 強調（主要按鈕／草稿／電源開啟）`#0a74e8`；草稿底 `rgba(10,116,232,.06)`
- 危險 `#d9362b`
- 填充灰 `rgba(118,118,128,.12)`；軌道 `rgba(118,118,128,.2)`；分隔 `rgba(60,60,67,.14)`
- 狀態色（bg / ink / dot）：
  - ok `rgba(52,168,83,.12)` / `#1f7a3a` / `#34a853`
  - warn `rgba(255,170,0,.14)` / `#8a5a00` / `#f0a000`
  - err `rgba(217,54,43,.1)` / `#b3261e` / `#d9362b`
  - info/busy `rgba(255,255,255,.55)` / `#1d1d1f` / `#8e8e93`（busy 點 `#0a74e8`）
  - idle `rgba(118,118,128,.12)` / `#6e6e73` / `#aeaeb2`
**圓角**：群組 16、預覽 20、Tray 10/14、大按鈕 12–14、小按鈕 7、分段 9/6、膠囊 99、電源 50%。
**字級**：22（頁標題）/ 17（電源狀態）/ 15（header、主要按鈕）/ 14（列文字）/ 13–13.5（按鈕、次要）/ 12–12.5（說明、小標）/ 11.5（示意標籤、mono）。字重 400 / 600 / 700。數值用 `font-variant-numeric: tabular-nums`。
**間距**：群組間 18（手機 16）、左欄 14；列 min-height 44–52；列左右 padding 14；content padding 20。

## Copy（定稿，精簡版）
- 連線徽章：未連線／連線中／已連線／已斷線 · 重試中
- 命令：就緒；處理中「正在送出「開燈」」；指令已送出「掛燈不回報狀態，請以實際燈光為準。」；發送失敗「請稍後再試。」；結果不明「請先查詢，不要重送。」
  - 注意：原簡報的「橋接器已完成發送；掛燈未提供獨立狀態確認。」已依使用者指示精簡為上述文字。
- 橫幅標題：已斷線，重試中／上一筆結果不明（說明「請先查詢「關燈」的結果。」）／處理中／橋接器已重新開機
- 停用：「已停用：{已斷線｜無線模組未就緒｜處理中｜結果不明，請先查詢}」
- 頁尾：`LOCAL CONNECTION · NO CLOUD`　`非 BenQ 官方軟體 · 開發版 0.1.0`
- 技術代碼（錯誤碼、IRQ、FIFO、TX）只出現在診斷的原始資料中。

## Assets
無點陣圖。電源圖示為上述兩段 SVG path。App icon 沿用 `app/app-icon.svg`。字體使用系統字體，無需載入網路字型。

## Files
- `Overview.dc.html` — 總覽：桌面＋iPhone 互動原型、Tray 面板、11 種狀態縮圖（點縮圖切換）。
- `Halo Main.dc.html` — 主視窗（props：`scenario`、`platform = windows | macos | ios`）。
- `Halo Tray.dc.html` — 系統匣／選單列面板（props：`scenario`、`os = windows | macos`）。
- `halo-model.js` — 模擬資料、狀態種子、文案與互動（僅參考邏輯與文案）。
- `support.js` — 原型執行環境（開啟 .dc.html 用，不需實作）。
- `APP_DESIGN_BRIEF.md` — 原始產品事實與限制。

Scenarios：`first`、`searching`、`noresults`、`connecting`、`ready`、`executing`、`transmitted`、`failed`、`unknown`、`reconnect`、`boot`。
