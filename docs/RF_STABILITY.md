# 有界 RF 穩定性測試

`tools/check_rf_stability.py` 使用協定參考用戶端，重複發送目前的電源目標，不改模式、亮度或色溫。它會實際發送 RF；請在可以觀察燈具時執行。

```powershell
python tools/check_rf_stability.py --host 192.168.0.99:8080 --send-rf --count 20 --interval 30 --report rf-report.jsonl
```

帳密由互動提示或 `HALO2_USERNAME`／`HALO2_PASSWORD` 環境變數取得。不要把帳密放入命令列或提交報告中的私人裝置識別資料。

- 必須提供 `--send-rf`；報告使用獨占建立，既有檔案不覆寫。
- 最短間隔 30 秒，最多 2881 次，排程間隔總和最多 24 小時；網路與發送執行時間另計。
- 每筆命令只 POST 一次，accepted／executing 透過唯讀查詢追蹤。送出前先寫入命令 ID，便於結果不明時查核。
- 任一失敗、未知結果、裝置重啟、外部控制、非 ready 狀態均停止；不自動恢復或重送。
- `complete=true` 代表本次橋接器發送測試完成；燈具沒有獨立確認，不能代替實體觀察或原生 App UI 驗收。

## 2026-09-27 首次執行

預定 20 次、間隔 30 秒，第一筆即停止，成功 0 次。命令 `e800cf6d-0847-473e-8eee-30d3eb9cf511` 回報 `TX_MAX_RETRIES`：planned=1、attempted=1、transmitted=0、IRQ=`1E`、FIFO=`01`、MODE=2。命令追蹤耗時 271 ms，整個測試 383 ms，結束原因 `TX_NOT_TRANSMITTED`，`complete=false`。

原始報告保留在本機 ignored `.esphome/rf-soak-20260927.jsonl`。測試沒有自動重送。這項結果重現間歇性 RF 發送故障，不能列為長時間穩定性通過；根因尚未確認。
