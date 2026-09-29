# Apple Silicon Mac 與 iPhone 實機驗收

目前已確認使用者有 M 系列 Mac、Xcode 及 USB 連接的 iPhone。Windows 上的驗收不代表 Apple 端已通過。

## 1. 在 Mac 準備

Mac、iPhone 與橋接器需在同一個可互通的區域網路。先啟動 Xcode 完成首次元件安裝，在 Settings → Accounts 登入自己的 Apple 帳號；USB 連接 iPhone，由使用者完成信任與 Developer Mode 提示。帳號、簽章與裝置信任不放進 Git。

安裝 Node.js 24 與 Rust stable 後，在 Terminal 執行：

iOS 專案需使用能讀取 Xcode project format 77 的 Xcode 16 以上版本；CI 明確選用 Xcode 16.2。若 `xcodebuild -version` 仍為 15.x，先在 Xcode Settings → Locations 選擇新版 Command Line Tools，再繼續。

```sh
git clone https://github.com/Kashionz/benq-screenbar-halo2-esphome.git
cd benq-screenbar-halo2-esphome/app
xcodebuild -version
xcrun --sdk iphoneos --show-sdk-path
node --version
rustc --version
npm ci
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npm test
cargo test --locked -p halo2-bridge-core -p halo2-app-support
```

若已經 clone，先確認沒有未提交修改，再更新到要測試的提交；回報 `git rev-parse --short HEAD`，避免版本混淆。

## 2. macOS 本機建置

```sh
npm run tauri build -- --debug --bundles app
open "target/debug/bundle/macos/HaloDesk.app"
```

這是從原始碼在自己的 Mac 建置的測試版，尚未代表 Developer ID 簽章、公證或對外發行。登入橋接器 `192.168.0.99:8080`，使用橋接器既有網頁帳密。macOS 若詢問區域網路權限，允許此 App 連線。

## 3. iPhone 建置

在相同 `app` 目錄：

```sh
npm run tauri ios init
npm run tauri icon -- app-icon.svg --ios-color '#e9ebef'
npm run tauri ios dev -- --open
```

在 Xcode 選取 App target 的 Signing & Capabilities，選自己的 Team；選 USB 連接的 iPhone，再執行 Run。若命令列詢問 Team，選相同帳號。初始化後的 Xcode 個人簽章設定與本機檔案不應直接提交。

開發模式的前端由 Mac Vite 提供；本專案會依 `TAURI_DEV_HOST` 綁定位址。iPhone 若空白或連不到前端，先確認 Mac 的開發伺服器仍在執行、兩台裝置互通，再依 CLI 提示選擇位址。Release 的內嵌前端驗收應另行執行 `npm run tauri ios build -- --open`，並在 Xcode 使用對應的簽章設定。

## 4. 逐項記錄結果

每一臺裝置都需單獨記錄，不能以模擬器或 CI 建置取代：

| 項目 | macOS | iPhone |
| --- | --- | --- |
| 首次 LAN 權限、登入成功，拒絕權限時有錯誤提示 | 待驗收 | 待驗收 |
| 明確搜尋找到真實橋接器，選取只填位址且清除輸入密碼 | 待驗收 | 待驗收 |
| 無候選時仍可手動輸入 IP；搜尋不自動登入或送 RF | 待驗收 | 待驗收 |
| ON／OFF 各一次，實際燈光跟隨 | 待驗收 | 待驗收 |
| 前燈 30%／2700 K、前燈 80%／6500 K | 待驗收 | 待驗收 |
| 後燈 20%、後燈 80%、前後同開 | 待驗收 | 待驗收 |
| 滑桿不送命令、套用才送，原廠控制器同步 | 待驗收 | 待驗收 |
| 勾選記住、退出程序、重開後保存帳密連線 | 待驗收 | 待驗收 |
| 橋接器斷電 10 秒再插回，恢復而不重送 | 待驗收 | 待驗收 |
| 背景／鎖定 5 分鐘後回前景，更新且不重送 | 待驗收 | 待驗收 |
| 匯出診斷，可實際取得 JSON 檔案 | 待驗收 | 待驗收 |

回報格式：裝置／OS 版本、提交 SHA、測試項目、實際燈光結果、App 顯示訊息。若失敗，附診斷 JSON；不要附帳密、憑證或原始 secrets.yaml。

iOS 匯出寫入 App 文件目錄；已透過 iOS 專用 Info.plist 啟用文件取用。匯出後到「檔案」→「我的 iPhone」→「HaloDesk」→「HaloDesk」取出 JSON，確認可以開啟後才勾選通過。連線設定與內部歷史仍存放 Application Support，密碼存於 Keychain。此取用路徑仍待實機確認。

文件取用依據 [Apple 文件提供者設定](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/LaunchServicesKeys.html#//apple_ref/doc/uid/20001431-102364)。CI 僅驗證編譯與自動測試，Keychain 存取與 LAN 權限必須在實機驗收。

## 已取得的建置證據

2026-09-27：[Bonjour 修正版 CI 36317392509](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/runs/36317392509)，提交 `55a9636`，完整流程成功。包括 macOS App、iOS 真機／模擬器 Rust 檢查、完整模擬器 App、產生後的 `NSBonjourServices` 固定服務與 LAN／文件宣告。尚未在 Mac 或 iPhone 執行搜尋與權限實測。

2026-09-27：[Apple CI 36314887598](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/runs/36314887598) 選用 Xcode 16.2 後，完整 ARM iOS 模擬器 App 建置成功，產生的 Info.plist 通過 LAN 用途、文件共享與原地開啟宣告檢查。macOS bundle 與 iOS 兩個 Rust 目標也成功。模擬器 App 未在此工作流程啟動，仍不能替代實機驗收。

2026-09-27：[Apple CI 36313722538](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/runs/36313722538) 在 macos-14 成功執行前端測試、Rust 核心／儲存測試、macOS debug App bundle，以及 `aarch64-apple-ios-sim`、`aarch64-apple-ios` 的 App library 檢查。沒有執行 iPhone App，也沒有驗證真實 Keychain／區域網路權限。

官方參考：[Tauri 行動裝置開發](https://v2.tauri.app/develop/)、[iOS 簽章](https://v2.tauri.app/distribute/sign/ios/)、[macOS App bundle](https://v2.tauri.app/distribute/macos-application-bundle/)。

## 區域網路搜尋診斷

在未連線畫面按「搜尋區域網路橋接器」，約 5 秒後應顯示候選或空結果提示。候選未經認證，選取不會套用保存帳密；請明確登入。Mac／iPhone 均使用系統 Bonjour，權限提示需由使用者操作。

若 App 找不到，可在 Mac Terminal 執行 `dns-sd -B _halo2-bridge._tcp local.`，觀察約 10 秒後按 Control-C 結束。這只瀏覽服務，不傳帳密或控制掛燈。記錄是否出現 `screenbar-halo2`，以協助區分 App 與網路 multicast 問題；Windows 目前的 multicast 搜尋尚無結果，不能推定 Mac／iPhone 也相同。
