# 本地驗證結果

日期：2026-10-22（Asia/Taipei）；環境：Windows、Node.js 24.19.0、pnpm 11.25.0。

## 已執行

- `node --test`：**28 項通過，0 失敗**。無 Token、無 Discord API 呼叫。
- `node scripts/check.js`：所有本專案 JavaScript 語法、斜線指令定義、語音 intent、SDK raw 參數、原生 AES 及 DAVE 依賴檢查通過。
- `dev.ps1 demo`：模擬 2 次即時播放、1 次重複傳送、1 次斷線補送；結果為 **3 次播放、1 次 replay、2 秒已確認覆蓋**，30 秒斷線不納入覆蓋。只使用記憶體資料庫。
- 空白 `.env` 啟動：以 exit 1 明確提示缺少 DISCORD_TOKEN，登入前即結束。

## 測試涵蓋

| 類別 | 驗證 |
| --- | --- |
| 篩選及 ID | 非效果事件、無 sound_id、null、預設音效數字 0、非法／失去精度 ID、缺序號 |
| 正確計數 | 同 session 同序號重複、連續合法點擊、新 session 重用序號、重名／改名 |
| 持久化 | 真正磁碟 SQLite 關閉重開、逐筆紀錄與目標、跨重開去重、崩潰覆蓋尾端恢復 |
| 範圍 | 未加入房間、未 Ready、不同 guild/channel/user、接收時間篩選、無可見頻道 |
| 重連 | READY、ShardReconnecting、補送、RESUMED、單一 raw 計數路徑、缺口不延伸 |
| 語音管理 | 加入／離開／換房、延後換房確認、靜音拒聽、逾時、權限不足、踢除、重試、恢復目標及指令序列化 |
| 資料故障 | SQLite 觸發寫入失敗時拋錯，不增加記憶體假統計 |
| 執行鎖 | 同資料庫拒絕第二份；真正子程序被強制結束後，作業系統釋放鎖，可重新啟動 |
| 指令 | payload 可序列化、days 範圍、public 為 sounds 與 users 的第二個選項、兩者預設／明確 false 維持私人回覆、明確 true 才公開、其他指令維持私人回覆、管理權限、私人頻道隔離、空紀錄提示、停用 mention、名稱查詢部分失敗 |
| 音效顯示 | sounds 隱藏 ID 但同名音效仍分列；refresh 私人清單保留 ID 0 與完整 Snowflake、不混入其他伺服器的快取、部分／全部讀取失敗明確提示、過長清單以完整文字附件回覆 |

整合測試使用已安裝 discord.js 的真實 Client 事件發射器與 SQLite，語音傳輸使用可控制的替身；不宣稱已完成 Discord Gateway、UDP、DAVE 握手或原生點擊實測。實機待驗項目見 [ACCEPTANCE.md](ACCEPTANCE.md)。

## 本機移轉驗證：2026-10-22

工作目錄：`C:\Howard_WorkSpace\Projects\DCbot\soundboard-tracker`。使用專案內 Node.js 24.22.1、pnpm 11.25.0；系統原有 Node.js 24.14.0 保持原樣。Node 下載包核對官方 SHA-256，pnpm 下載包核對 npm registry 的 SHA-512 integrity。

- `dev.ps1 install`：依原始鎖定檔安裝成功，停用套件安裝腳本；`package.json` 與 `pnpm-lock.yaml` 未更動。
- `dev.ps1 test`：28 項通過，0 失敗。
- `dev.ps1 check`：語法、SDK、原生 AES 與 DAVE 0.1.12 通過。
- `dev.ps1 demo`：3 次播放、2 秒已確認覆蓋；只使用記憶體資料庫。
- `dev.ps1 audit`：npm 官方服務回報沒有已知漏洞；此結果僅代表查核當時的已知漏洞資料。
- `.env` 必填欄位與格式通過，無額外或重複環境變數；未輸出任何設定值。資料庫路徑位於專案內，目前尚無舊資料庫。
- Discord 官方 API 唯讀驗證：Bot Token 有效、Application ID 相符、可存取指定伺服器、`/soundboard` 已存在。未重新註冊指令，也未啟動 Gateway 或加入語音房。
- 專案資料夾移除 Everyone、Users、Authenticated Users 存取規則，保留擁有者、管理員、系統與 Codex 工作環境權限；`.env`、原始碼權限已確認繼承此限制。
- Windows PowerShell 5.1 的執行原則禁止 `.ps1`；維持原則不變，日常指令改為直接執行專案內 `node.exe`。`dev.ps1` 已在 PowerShell 7 驗證。

正式啟動及 Discord 原生音效板實機測試由使用者在自己的 PowerShell 與 Discord 進行；請先停止其他電腦上使用相同 Token 的程序。
