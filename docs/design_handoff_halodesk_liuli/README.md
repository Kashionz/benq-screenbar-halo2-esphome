# Handoff: HaloDesk「琉璃」UI 重構

## Overview
重構 HaloDesk（Tauri 2 + React，`app/src/*.tsx`）的全部介面：主畫面、設定、首次連線、系統匣面板，桌面與 iPhone，淺色與深色主題。方向代號「琉璃」＝延續現有淺色壓克力語彙，強化掛燈示意圖、精簡元素、統一元件。

產品規則仍以 `docs/APP_DESIGN_BRIEF.md` 與 `app/README.md` 為準（即時送出、不自動重送、結果不明時鎖定、電源送明確值等），下列「行為變更」除外。

## About the Design Files
本資料夾的 `.dc.html` 是 **HTML 設計參考**（可互動原型），不是要直接上線的程式碼。請在既有 `app/` 專案（React + TypeScript + Tauri）中依現有架構重新實作：
- 沿用 `bridge.ts`、`ControlApp.tsx` 的輪詢／命令流程、`generation` 防護、`controlState.ts` 的 `lockReason`／`commandFeedback`／`tempColor`／`beamColor`／`beamLevels`。
- 樣式可改寫 `halo.css`／`tray.css`（CSS 變數），數值照本文件。
- 原型內的資料（情境、診斷事件、JSON、時間）皆為假資料。

開啟方式：以本機 http server（如 `npx serve`）開 `HaloDesk 琉璃 細化.dc.html`（總覽，22 個畫面），或直接開 `HaloDesk A 琉璃.dc.html`（單一畫面，右上 Tweaks 可切換 `theme / platform / screen / scenario`）。三個檔案需在同一資料夾（含 `support.js`）。

## Fidelity
**High-fidelity。** 顏色、字級、圓角、陰影、間距、文案皆為定稿。

## 行為變更（相對目前 app）
1. **情境上限 20 → 4。** 顯示「情境 · n/4」；滿 4 組時「＋ 新增」停用，tooltip「最多 4 組情境」。需同步修改 `bridge-core`／`app-support/presets.rs` 上限與文件。
2. **移除「目標」清單卡**（電源／模式／亮度與色溫／來源），也不再顯示「來源」。
3. **連線狀態移到視窗左下角**（頁尾），頂部列只剩置中標題與「設定」。
4. **頁尾移除** `LOCAL CONNECTION · NO CLOUD` 與「非 BenQ 官方軟體」，只保留「開發版 0.1.0」。
5. **命令狀態併入電源按鈕旁的說明行**（主畫面與系統匣皆同）；系統匣不再有獨立狀態列。
6. **刪除情境需確認彈窗**，刪除後 6 秒內可「復原」。
7. **設定頁改為左側分頁**（桌面）：裝置與連線／外觀／診斷紀錄；新增「外觀」主題選擇（淺色／深色／跟隨系統）。
8. **深色主題**（新增）。
9. **視窗預設 880×580**（原 1050×780）。建議最小 760×560。
10. 文案「橋接器」在 UI 上改稱「控制盒」（目前僅出現於「重新整理」說明）。

## Screens / Views

共通：字體 `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable', 'Segoe UI', 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif`；`line-height:1.5`；數值一律 `font-variant-numeric: tabular-nums`；全介面無漸層。

**壓克力卡（G）**：`border-radius:16px; background:var(--glass); backdrop-filter:blur(14px) saturate(160%); border:1px solid var(--edge); box-shadow:var(--shadow); overflow:hidden`。
**群組小標（L）**：`padding:0 14px 6px; font-size:12px; color:var(--ink3); letter-spacing:.2px`。
**列分隔**：`0.5px solid var(--sep)`。

### 1. 視窗外殼
- Root：flex column，`background:var(--bg)`，桌面 radius 12（示意用），iPhone 390×844 radius 48、頂部 50px 狀態列、底部 home indicator。
- **Header**：min-height 56，padding `8px 14px 8px 18px`，`background:var(--header)` + blur(14px) saturate(160%)，`border-bottom:1px solid var(--edge)`，`box-shadow:var(--headerShadow)`。內容為三欄 grid `1fr auto 1fr`：
  - 主畫面：左空、中「ScreenBar Halo 2」15/700 置中、右「設定」膠囊（min-height 34，padding `2px 14px`，radius 99，`background:var(--pill)` + blur(20px)，`box-shadow:0 0 0 .5px var(--sep)`，13px）。
  - 設定：左「‹ 燈光」膠囊（同上樣式，‹ 16px `--ink2`）、中「設定」15/700、右空。
  - 首次連線：中「HaloDesk」。
- **Main**：可捲動（捲軸隱藏），padding 桌面 `20px 20px 18px`／iPhone `16px 16px 28px`，flex column gap 14。
- **Footer**（main 最下方，`margin-top:auto; padding-top:8px`）：左＝6px 圓點＋狀態文字 12px（見下）；右＝「開發版 0.1.0」11px letter-spacing 1px `--ink3`。
  - 未連線：「未連線」，點 `#aeaeb2`。
  - 已連線：「已連線 · 同步 {HH:MM:SS}」，點 ok-dot，文字 `--ink2`。
  - 已斷線：「已斷線 · 重試中 · 最後同步 {HH:MM:SS}」，點與文字 warn，點 pulse。

### 2. 橫幅（Banner）
位於 main 頂端，僅下列狀態出現。radius 12，padding `10px 12px 10px 14px`，`border:1px solid var(--edge)`，背景／文字依 tone；8px 圓點（warn 時 pulse）；文字 13px「**標題**　說明」；右側按鈕 min-height 34、radius 8、`background:var(--segOn)`、13px、`box-shadow:0 0 0 .5px rgba(0,0,0,.12)`。

| 狀態 | tone | 標題 | 說明 | 按鈕 |
| --- | --- | --- | --- | --- |
| 已斷線 | warn | 已斷線，重試中 | 最後同步 {t}。不會重送先前的操作。 | 立即重試 |
| 結果不明 | warn | 上一筆結果不明 | 請先查詢「{action}」的結果。 | 查詢命令結果 |
| 無線模組未就緒 | warn | 無線模組未就緒 | 控制已暫停，模組就緒後即可操作。 | — |
| 重新開機 | info | 裝置已重新開機 | 已重新同步，先前的命令結果無法查詢。 | 知道了 |

### 3. 主畫面（桌面）
外層 `display:flex; flex-wrap:wrap; gap:18px; align-items:stretch; flex:1 0 auto`。
- **左欄** `flex:1.1 1 420px`，column gap 16：示意圖 → 情境。
- **右欄** `flex:1 1 330px`：燈光（撐滿欄高）。
- iPhone：換行成單欄，順序 示意圖 → 燈光 → 情境（情境在 iPhone 放右欄下方）。

**A. 掛燈示意圖**（`flex:1 0 auto; min-height:196px`（iPhone 250px）；radius 22；G 樣式；離線 opacity .5，transition .4s）
- 全部絕對定位純色形狀（場景在右 60%）：
  - 牆線 `right:4.8%; top:0; bottom:18%; width:2px; var(--line)`；桌線 `left:38%; right:0; bottom:18%; height:2px`。
  - 前光束 `clip-path: polygon(76% 27%, 78.4% 27%, 58% 82%, 43.6% 82%)`；後光束 `polygon(78.4% 22%, 79.6% 26%, 95.2% 44%, 95.2% 2%)`；顏色 `rgba(beamRGB(K), .55)`；opacity 亮時 `0.3 + 0.7 × 亮度/100`，否則 0；transition opacity .4s, background .3s。
  - 桌面受光線 `left:43.6%; width:14.4%; bottom:18%; height:3px; background:tempColor(K)`，opacity 同前燈；牆面受光線 `right:4.8%; top:2%; height:42%; width:3px`，opacity 同後燈。
  - 螢幕 `left:77.8%; top:26%; 6px × 44%; radius 3`；支架 `left:78.4%; top:70%; 2px × 12%`；底座 `left:74.8%; top:81%; 7.2% × 3px`；燈條 `left:74.6%; top:calc(24% - 5px); 7% × 10px; radius 5`，開燈時 `box-shadow: 0 0 18px tempColor, 0 0 4px tempColor`。顏色 `var(--lamp)`。
  - 標籤「前 60%」`left:47%; top:55%`、「後 35%」`left:84%; top:9%`：12px，`background:var(--tag)`，radius 5，padding `1px 7px`；該路未亮顯示「—」。右下「4000 K」12px `--ink2`。
- 左 40% 資訊區（padding `18px 0 18px 20px`，上下 space-between）：
  - 左上「目標示意」11.5px `--ink2`。
  - 電源鈕 64×64 圓，icon 26px（SVG `M12 3.2v7.6` + `M7.1 6.1a7.6 7.6 0 1 0 9.8 0`，stroke 1.9 round）。開：`var(--accent)` / #fff / `var(--onShadow)`；關：`var(--offBg)` / `var(--offInk)` / `var(--offShadow)`。鎖定時 opacity .35（處理中例外：外觀不變、重複點擊無效）。`aria-label`／`title`＝「開燈」或「關燈」。
  - 「開啟／關閉」22/600，letter-spacing -.2px。
  - 「前後燈 · 4000 K」13px `--ink2`（關燈時「燈已關閉」）。
  - **命令狀態行** 12px，min-height 18：
    - 就緒：「按一下關燈／開燈」`--ink3`。
    - 處理中：10px spinner（1.5px 邊，`--track` / 頂 `--accent`，spin .8s）＋「**處理中** · 正在送出「關燈」」busy ink。
    - 已送出：「**指令已送出** · 請以實際燈光為準」ok ink（約 4 秒後回到就緒）。
    - 發送失敗：「**發送失敗** · 請稍後再試。」err ink。
    - 結果不明：「**結果不明** · 請先查詢，不要重送。」warn ink。

**B. 燈光卡**（右欄，撐滿高度）
- 小標列：「燈光」＋右側（鎖定時）「已停用：{原因}」`--ink2`。
- 內容鎖定時 opacity .4（transition .2s）。
- 模式分段：外 padding `12px 14px`；三等分 grid，外框 padding 2、radius 10、`var(--fill)`；項目 min-height 34、radius 8、13px；選中 `var(--segOn)` + `0 1px 2px rgba(0,0,0,.14)`、`--ink`；未選 transparent、`--ink2`。
- 滑桿 ×3（前燈 1–100%、後燈 1–100%、色溫 2700–6500 K step 25）：每列 `flex:1`、垂直置中、padding `10px 14px`、上分隔線。標題列 14px（名稱 / 數值）。軌道區高 28、margin-top 4：軌道 top 12、高 4、radius 2 `--track`；填色 `--ink`；拖曳點 26px、top 1、白（深色 `#f2f2f5`，色溫列為 tempColor）、`box-shadow:0 1px 2px rgba(0,0,0,.14), 0 3px 8px rgba(0,0,0,.16)`。互動用原生 range（opacity 0 覆蓋），focus-visible 顯示 `outline:2px solid accent`。拖曳即時送出（沿用現有 pump 邏輯）。

**C. 情境**（最多 4 組）
- 標題列（高 24，margin-bottom 6，padding `0 14px`，12px `--ink3`）：左「情境 · n/4」；右依序：
  - 一般：「＋ 新增」12.5px accent（滿 4 組或鎖定 opacity .4）｜0.5px×12px 分隔線｜「編輯」12.5px accent（編輯中為「完成」600）。
  - 刪除後 6 秒內：「＋ 新增」位置換成「已刪除「{名稱}」」12.5px `--ink2` ＋「復原」600 accent。
  - 所有按鈕 `white-space:nowrap`。
- 卡：G 樣式，padding 10。磚格 grid 桌面 4 欄／iPhone 2 欄，gap 8（外加 padding 3 / margin -3 以免選取框被裁）。不足 4 組時剩餘位置留白。
- 磚：高 84，radius 12，padding `10px 12px`，column gap 6：20px 色塊（radius 6，tempColor(K)，`inset 0 0 0 .5px rgba(0,0,0,.12)`）→ 名稱 14/600（ellipsis）→ 「4300 K · 70/30%」11px `--ink2`。`title`＝「前後燈 · 前 70% · 後 30% · 4300 K」。
  - 一般：`var(--fill)`；與目前值完全相同：`var(--segOn)` + `0 0 0 1.5px var(--accent)`，名稱 accent。
  - 點擊：立即套用（一筆命令，不含電源）。
  - 編輯模式：磚加 `outline:1px dashed var(--track); outline-offset:-1px`，點擊不套用；右上 24px 圓形「−」（`var(--segOn)`、`--danger`、17px/600、`0 0 0 .5px var(--sep), 0 1px 3px rgba(0,0,0,.14)`）→ 開啟刪除彈窗。
- **新增面板**：覆蓋整個情境 section（absolute inset 0，z 3，radius 16，`var(--sheet)` + blur(20px) saturate(170%)，padding `12px 14px`，三列 space-between）：
  1. 「新增情境」13.5/600 ＋ 右「以目前的燈光設定保存」12px `--ink3`。
  2. 22px 色塊（目前色溫）＋名稱輸入（高 34、radius 9、`var(--fill)`、14px、placeholder「名稱」、maxlength 40）。
  3. 摘要「前後燈 · 前 60% · 後 35% · 4000 K」11.5px `--ink2` ＋「取消」(transparent accent) ＋「保存」(accent/#fff/600，名稱為空時 opacity .4 不可按)。
  - 保存只寫本機，不送 RF；新情境加在最後。Esc＝取消。
- **刪除彈窗**：全視窗 scrim（淺 `rgba(30,34,42,.28)`／深 `rgba(0,0,0,.5)`），點 scrim 取消，Esc 取消。對話框 max-width 340、radius 20、`var(--sheet)` + blur(24px) saturate(170%)、`border:1px solid var(--edge)`、`box-shadow:0 28px 64px -14px rgba(0,0,0,.38), 0 0 0 .5px rgba(0,0,0,.12)`、padding 18、gap 16：
  1. 「刪除這個情境？」16/700。
  2. 預覽列（radius 12、`var(--fill)`、padding `10px 12px`）：28px 色塊＋名稱 14/600＋摘要 11.5px（皆 ellipsis）。
  3. 右對齊按鈕：「取消」(`--fill`/`--ink`) 、「刪除」(`--danger`/#fff/600)，min-height 36、radius 99、padding `2px 18px`、13.5px。
  - 確認後刪除，標題列顯示復原 6 秒；最後一組刪除後自動退出編輯模式。

### 4. 設定（桌面：左分頁）
外層 flex gap 22，撐滿 main。
- **左導覽** 196px，column gap 2：項目 min-height 40、padding `0 12px`、radius 10、14px；選中 G 背景＋shadow、600；右側 meta 12px `--ink3`（裝置與連線＝「就緒／未就緒」(未就緒為 danger)、外觀＝「淺色／深色」、診斷紀錄＝「5 筆」）。
- **右內容**：可捲動、gap 18、padding `0 8px 36px` / margin `0 -8px`（避免陰影被裁）。
- iPhone：無導覽，三個分頁內容依序堆疊，各有 L 小標。

**裝置與連線**
1. 裝置卡（G）：頂列 padding 16、gap 14：44px 圖示格（radius 12 `--fill`，內 24×6 燈條 `--ink`，`box-shadow:0 0 10px tempColor`）＋「ScreenBar Halo 2」17/700＋位址 12.5px mono `--ink2` ＋右側狀態膠囊（padding `3px 10px`、radius 99、tone 背景/文字、6px 點）。下方三欄格（上分隔、欄間分隔，padding `10px 16px`）：標籤 12px `--ink2` / 值 15/600：無線模組（就緒｜未就緒 danger）、配對（已保存）、最後同步。
2. 「連線」群組（L + G），每列 min-height 60、padding `10px 14px`：左標題 14px＋說明 12px `--ink2`，右膠囊按鈕（min-height 32、padding `2px 14px`、radius 99、`--fill`、13px）：
   - 重新整理｜立即向控制盒讀取最新狀態。｜「重新整理」accent
   - 更換裝置｜中斷目前連線，回到連線畫面。｜「中斷連線」accent
   - 已保存的連線｜密碼存於 {Windows 認證管理員｜macOS 鑰匙圈｜iOS 鑰匙圈}。｜「忘記」danger

**外觀**
- L「主題」＋三欄卡（gap 12）：每張 padding `8px 8px 10px`、radius 16、`--glass`、`box-shadow:var(--shadow)`（選中加 `0 0 0 2px accent`）。預覽區高 78、radius 10：背景（淺 `#e6e8ec`／深 `#111317`／跟隨系統左右各半），內含頂列 10px 圓角條與兩塊卡片（淺 `#fff`、深 `#2a2c31`、系統 `rgba(128,130,138,.45)`）。下方 16px 單選圓（選中 `inset 0 0 0 5px accent`，否則 `inset 0 0 0 1.5px --track`）＋名稱 13.5px（選中 600）。
- 選擇立即生效並保存於本機；「跟隨系統」依 `prefers-color-scheme`。系統匣同步主題。

**診斷紀錄**
1. 三欄統計卡（G，padding `12px 14px`）：7px 點＋標籤 12px（成功／結果不明／失敗）＋數字 24/600。
2. 工具列：左「最近 {n} 筆 · 保留最近 200 筆」12px `--ink3`；右「原始資料」＋34×20 開關（on accent，knob 16px）。
3. 事件卡（G）：每列 min-height 48、padding `6px 14px`：7px 點（tone）＋「命令 · 已送出」13.5px（狀態 `--ink2`）＋時間 12px `--ink3`。原始資料開啟時每列下加 mono 11.5px `UNKNOWN_OUTCOME · TX 7/12 · IRQ 20 · FIFO 3`，列表下加 JSON 區塊（`--fill` 底、mono 11.5px、line-height 1.6、pre-wrap；device_id / boot_id / radio / last_command）。
4. 卡底列：「匯出檔不含帳號、IP 與密碼。」12px `--ink2` ＋「匯出 JSON」(accent) ＋「清除紀錄」(danger) 膠囊。匯出後顯示路徑；iPhone 另加「到「檔案」→「我的 iPhone」→「HaloDesk」→「HaloDesk」取用。」
- 錯誤碼與 TX/IRQ/FIFO 只在原始資料開啟時出現。

### 5. 首次連線
桌面：`max-width:780px; margin:auto; grid 2 欄 gap 14px 24px`；標題列跨兩欄；左＝區域網路；右＝登入＋連線按鈕。iPhone：單欄 max-width 460。
- 標題「連接掛燈」24/700 + 「本機連線，不經雲端。」13px `--ink2`。
- **區域網路**（L + G）：
  - 搜尋列 min-height 60：「搜尋區域網路」14px ＋「約 5 秒，選取後只會填入位址。」12px ＋ 右「搜尋」膠囊。搜尋中改為「搜尋中…約 5 秒」＋14px spinner，連線鈕 opacity .4。
  - 結果列 min-height 56、padding `8px 14px`：32px 圖示格＋名稱 14/600＋`host:port` 12px mono；選取者 `background:var(--accentWash)` 並右側 20px accent 圓「✓」。
  - 下方說明：選取後「已填入，請輸入密碼。」（並清空密碼）；找不到「找不到裝置，可直接輸入 IP。」＋平台提示（`platform.ts` 的 `DISCOVERY_HINT`）。
- **登入**（L + G）：欄位列 min-height 48、左標籤 72px `--ink2`、右對齊輸入 14px：主機、連接埠、帳號（placeholder「必填」）、密碼（placeholder「必填」）。最後一列 min-height 60：「記住此連線與帳密」＋「密碼存於 {CREDENTIAL_STORE}。」12px ＋ 40×24 開關。
- 「連線」按鈕：min-height 46、radius 99、accent/#fff、15/600、`box-shadow:var(--onShadow)`；連線中「連線中…」＋白色 spinner。
- 有已保存連線時，於區域網路上方加「已保存」群組：`host:port`、「使用已保存帳密連線」、「忘記已保存連線」(danger)（樣式沿用連線群組列）。

### 6. 系統匣面板（寬 340）
- 容器：radius 12（macOS 不透明矩形見現有 `tray.css`）、`var(--tray)` + blur(24px) saturate(170%)、`border:1px solid var(--edge)`、`box-shadow:var(--trayShadow)`、line-height 1.45。
- 頂列 padding `14px 14px 10px 16px`：「ScreenBar Halo 2」14/600（ellipsis）＋「開啟 HaloDesk」膠囊（min-height 30、`--fill`、12.5px）。
- 內卡（margin `0 12px`、radius 12、`--glass`、`box-shadow:var(--innerShadow)`）：
  - 電源列 padding `10px 10px 10px 12px`、gap 12：44px 電源鈕（icon 20）＋「開啟／關閉」14/600＋**狀態行** 11.5px：就緒「按一下關燈」`--ink3`；處理中 9px spinner＋「**處理中** · 正在送出「關燈」」；已送出／發送失敗同主畫面；結果不明「**結果不明**，請先查詢」warn＋右側「查詢」膠囊（開啟主視窗）；鎖定「已斷線／無線模組未就緒」warn。
  - 模式分段（margin `0 10px 8px`，項目 min-height 28、12.5px）。
  - 三列 inline 滑桿（padding `6px 12px`、上分隔）：名稱 34px 12.5px `--ink2`｜軌道 26 高（拖曳點 22）｜數值 54px 右對齊 12.5px。
- 情境：padding `10px 12px 2px`，4 欄 grid gap 6：磚 min-height 52、radius 10、置中 14px 色塊＋名稱 12/600；選中同主畫面。不可編輯。
- 頁尾（margin-top 8、padding `8px 12px 10px 16px`、上分隔）：左＝連線狀態（同主視窗頁尾格式）；右「結束」。
- 鎖定時控制區 opacity .4；未連線全部停用。

## Interactions & Behavior
- 輪詢、即時送出、500 ms 節流、結果不明處理、背景丟棄未送值等皆沿用現有 `ControlApp.tsx`。
- 停用條件與原因字串沿用 `lockReason`（已斷線 → 無線模組未就緒 → 處理中 → 結果不明，請先查詢）。
- 已送出提示顯示約 4 秒（沿用 `flash`）。
- 動畫：分段／磚 `.15s`；卡片 opacity `.2s`；光束 opacity `.4s`、色 `.3s`；燈條光暈 `.3s`；電源 background/box-shadow `.2s`；開關 knob `left .15s`；pulse 1.2s；spinner .8s linear。
- `prefers-reduced-motion: reduce`：關閉所有 transition／animation。
- 鍵盤：所有按鈕 focus-visible `outline:2px solid #0a74e8; outline-offset:2px`；Esc 關閉刪除彈窗／新增面板；系統匣 Esc 隱藏（現有）。
- 響應式：桌面兩欄以 flex-wrap 自動換行（左 basis 420、右 basis 330）；寬度不足時變單欄（順序同 iPhone）。

## State Management（新增／調整）
- `presets: Preset[]`（≤ 4）、`presetsEditing: boolean`、`adding: boolean`、`draftName: string`、`confirmIndex: number | null`、`undo: { preset, index } | null`（6 秒 timer）。
- `settingsTab: 'device' | 'look' | 'diag'`、`showRaw: boolean`。
- `theme: 'light' | 'dark' | 'system'`（本機保存；主視窗發佈給系統匣）。
- 移除 `TargetList` 相關 state 與「來源」計算的 UI 用途。

## Design Tokens
主題以 CSS 變數實作，數值如下（light / dark）。

| Token | Light | Dark |
| --- | --- | --- |
| --bg | #e6e8ec | #111317 |
| --ink | #1d1d1f | #f2f2f5 |
| --ink2 | #6e6e73 | #a3a3ab |
| --ink3 | #8e8e93 | #7d7d86 |
| --glass | rgba(255,255,255,.4) | rgba(255,255,255,.055) |
| --edge | rgba(255,255,255,.9) | rgba(255,255,255,.09) |
| --header | rgba(255,255,255,.3) | rgba(24,26,31,.6) |
| --pill | rgba(255,255,255,.6) | rgba(255,255,255,.1) |
| --sep | rgba(60,60,67,.14) | rgba(255,255,255,.08) |
| --fill | rgba(118,118,128,.12) | rgba(118,118,128,.24) |
| --track | rgba(118,118,128,.2) | rgba(118,118,128,.36) |
| --accent | #0a74e8 | #3b8cf6 |
| --accentWash | rgba(10,116,232,.06) | rgba(59,140,246,.12) |
| --danger | #d9362b | #ff6259 |
| --segOn | #ffffff | #56575d |
| --lamp | #1d1d1f | #c9c9ce |
| --line | rgba(60,60,67,.2) | rgba(255,255,255,.14) |
| --tag | rgba(255,255,255,.75) | rgba(40,42,48,.8) |
| --sheet | rgba(250,250,252,.9) | rgba(38,40,46,.92) |
| --scrim | rgba(30,34,42,.28) | rgba(0,0,0,.5) |
| --tray | rgba(246,247,249,.62) | rgba(36,38,44,.72) |
| --offBg | rgba(255,255,255,.7) | rgba(255,255,255,.12) |
| --offInk | #1d1d1f | #f2f2f5 |

Shadows：
- `--shadow` light：`inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(255,255,255,.5), inset 1px 0 0 rgba(255,255,255,.6), inset -1px 0 0 rgba(255,255,255,.6), inset 0 0 0 4px rgba(255,255,255,.18), 0 0 0 .5px rgba(40,50,70,.14), 0 2px 3px rgba(30,40,60,.05), 0 18px 36px -12px rgba(30,40,60,.16)`；dark：`inset 0 1px 0 rgba(255,255,255,.07), 0 0 0 .5px rgba(0,0,0,.5), 0 18px 36px -12px rgba(0,0,0,.55)`
- `--innerShadow` light：`inset 0 1px 0 rgba(255,255,255,.9), 0 0 0 .5px rgba(40,50,70,.1)`；dark：`inset 0 1px 0 rgba(255,255,255,.06), 0 0 0 .5px rgba(0,0,0,.4)`
- `--headerShadow` light：`inset 0 1px 0 rgba(255,255,255,.9), 0 .5px 0 rgba(40,50,70,.14), 0 8px 20px -10px rgba(30,40,60,.12)`；dark：`inset 0 -.5px 0 rgba(255,255,255,.06), 0 8px 20px -10px rgba(0,0,0,.5)`
- `--trayShadow` light：`inset 0 1px 0 rgba(255,255,255,.95), inset 0 0 0 4px rgba(255,255,255,.16), 0 0 0 .5px rgba(40,50,70,.2), 0 24px 48px -12px rgba(30,40,60,.32)`；dark：`inset 0 1px 0 rgba(255,255,255,.08), 0 0 0 .5px rgba(0,0,0,.6), 0 24px 48px -12px rgba(0,0,0,.6)`
- `--onShadow` light：`inset 0 1px 0 rgba(255,255,255,.25), 0 1px 2px rgba(10,80,180,.25), 0 6px 16px -6px rgba(10,116,232,.5)`；dark：`inset 0 1px 0 rgba(255,255,255,.2), 0 6px 18px -6px rgba(59,140,246,.6)`
- `--offShadow` light：`inset 0 1px 0 #fff, 0 0 0 .5px rgba(40,50,70,.18), 0 1px 3px rgba(0,0,0,.08)`；dark：`inset 0 1px 0 rgba(255,255,255,.1), 0 0 0 .5px rgba(0,0,0,.5)`

狀態色（bg / ink / dot）：

| tone | Light | Dark |
| --- | --- | --- |
| ok | rgba(52,168,83,.12) / #1f7a3a / #34a853 | rgba(52,199,89,.16) / #6ad588 / #34c759 |
| warn | rgba(255,170,0,.14) / #8a5a00 / #f0a000 | rgba(255,176,0,.15) / #ffc861 / #ffb000 |
| err | rgba(217,54,43,.1) / #b3261e / #d9362b | rgba(255,69,58,.16) / #ff8a80 / #ff453a |
| info | rgba(255,255,255,.55) / #1d1d1f / #8e8e93 | rgba(255,255,255,.08) / #f2f2f5 / #8e8e93 |
| busy | 同 info 底 / #0a74e8 / #0a74e8 | 同 info 底 / #6aa8ff / #3b8cf6 |

色溫色：沿用 `controlState.ts` 的 `tempColor`（2700K #ffc466 ↔ 6500K #e0ecff）與 `beamColor`（2700K rgb(255,164,60) → 4600K rgb(255,214,140) → 6500K rgb(96,160,255)，alpha .55）。

圓角：卡 16、示意圖 22、彈窗 20、情境磚 12（系統匣 10）、分段 10/8、橫幅 12、輸入 9、膠囊／按鈕 99、電源 50%。
字級：24（頁標題）/ 22（電源狀態）/ 17（裝置名）/ 16（彈窗標題）/ 15（header、主按鈕）/ 14（列文字、磚名）/ 13–13.5（按鈕、次要）/ 12–12.5（說明、小標、頁尾）/ 11–11.5（示意標籤、磚摘要、mono）。字重 400 / 600 / 700。

## Assets
無點陣圖。電源圖示為上述兩段 SVG path（沿用 `LightControls.tsx` 的 `PowerIcon`）。其餘圖形皆為 CSS 純色形狀。系統字體，不載入網路字型。

### App icon（新，3a「琉璃」）
- `icons/app-icon.svg`（1024×1024）：取代 `app/app-icon.svg`。淺灰底 #e9ebef、20px 白色內框、#1d1d1f 燈條與螢幕、暖色背光／前光 #ffc673（opacity .38 / .5）、燈條下緣光線 #ffb347。無漸層。
- `icons/app-icon-small.svg`：16–32px 用（Windows 系統匣、favicon）。去掉背光、加粗燈條與螢幕、前光 opacity .6。
- 重新產生各平台圖示：`npm run tauri icon -- icons/app-icon.svg --ios-color '#e9ebef'`；再以 `app-icon-small.svg` 輸出 16/32px 覆蓋 `32x32.png` 與 tray 圖示（`src-tauri/src/tray.rs` 使用的圖示）。
- README 內「圖示來源為 app-icon.svg、--ios-color '#294a3e'」一段需同步更新。

## Files
- `HaloDesk A 琉璃.dc.html` — 所有畫面的單一原型（props：`theme` light|dark、`platform` desktop|iphone、`screen` main|settings|connect|tray、`scenario` ready|executing|transmitted|failed|unknown|offline|radio|boot）。邏輯類別內含 tokens、狀態文案表（`SC`）、情境互動。
- `HaloDesk 琉璃 細化.dc.html` — 總覽畫布（22 個畫面）。
- `support.js` — 原型執行環境，不需實作。
- `icons/app-icon.svg`、`icons/app-icon-small.svg` — 新 App icon。
