# Discord 實機驗收清單

以下項目尚未逐項記錄正式驗收結果，**沒有完整驗收通過宣告**。離線測試只能證明模擬事件、資料庫與程式分支符合預期，不能替代 Discord 傳輸／權限驗證。Bot Token 僅放在本地 `.env`，不提交至儲存庫。

## 準備

- 建立專用 Bot 及測試伺服器；至少兩間一般語音房 A/B、兩個測試使用者、兩個音效。
- 依 README 填寫本地 `.env`、邀請 Bot、執行 register 及 start。
- 確認沒有開 Message Content／Members／Presence 特權 intents。
- 測試者仍使用 Discord 原生 Soundboard，不透過 Bot 發聲。

## 驗收情境

| 狀態 | 操作 | 預期 |
| --- | --- | --- |
| 待測 | 管理者在 A 執行 join，檢查 status | Ready 後標示 A 監測中；Bot 自我靜音及拒聽 |
| 待測 | 使用者 1 點音效 X 三次，使用者 2 點一次 | sounds 顯示 X 共 4 次；users 分別為 3、1，且個人統計一致 |
| 待測 | 傳送純 emoji 語音效果 | Soundboard 次數不變 |
| 待測 | 播放預設音效及外部伺服器音效 | 有 sound_id 即可計數；sounds 不顯示 ID，無法解析名稱時顯示「未知／外部／已刪除音效」 |
| 待測 | 同名音效、改名音效、刪除曾用音效 | 不同 ID 分開；改名沿用次數；歷史仍保留 |
| 待測 | Bot 在 A，另一人在 B 點音效 | B 不加入播放次數；status 及統計持續提示未知範圍 |
| 待測 | 管理者移到 B 再執行 join | A 結束一段覆蓋；B Ready 後開始；A 後續播放不計入 |
| 待測 | 暫時中斷網路再恢復 | 缺口不被填成監測；SDK 若 Resume 成功，補送只加算一次且標記 replay |
| 待測 | 無法 Resume 的長斷線 | 新 session 不衝突；不承諾找回失落事件，畫面保留不完整範圍說明 |
| 待測 | Ctrl+C 後重新 start | 歷史及目標保留，AUTO_REJOIN=true 時回房；停機期間不計成覆蓋 |
| 待測 | 強制結束程序後重啟 | 執行鎖自動釋放；未關閉區段收束至最後確認點，舊總數保留 |
| 待測 | 管理員踢除／移動 Bot | 踢除取消自動加入；移動後以新語音狀態調整範圍 |
| 待測 | leave 後等待及重新啟動 | 不自動加入，歷史仍可查 |
| 待測 | 滿房、撤銷 Connect、阻擋 UDP 或 DAVE 失敗 | 不顯示監測成功；逾時／連線中期間不新增覆蓋 |
| 待測 | 一般使用者嘗試 join/leave/refresh | 被管理權限檢查拒絕；查詢仍可使用 |
| 待測 | 使用者無法檢視私人房間 | 查詢結果不洩漏該房間的播放與使用者統計 |
| 待測 | dates、個人查詢、不同伺服器 | 僅顯示指定範圍，days 依接收時間，伺服器彼此隔離 |
| 待測 | 重新註冊後執行 sounds，省略 public 或選 false | 回覆只有操作者可見 |
| 待測 | 執行 `/soundboard sounds public:true` | 排行榜顯示在目前文字頻道，另一位可檢視頻道的成員也能看到；不觸發 mention 通知 |
| 待測 | 重新註冊後執行 users，省略 public 或選 false | public 是第二個選項；回覆只有操作者可見 |
| 待測 | 執行 `/soundboard users public:true`，再加上 user 篩選 | 使用者排行或個人統計顯示在目前文字頻道，另一位可檢視頻道的成員也能看到；不觸發 @ 通知 |
| 待測 | 執行 sounds，再由管理者執行 refresh | sounds 項目僅顯示音效名稱與次數；refresh 更新名稱後列出本次成功讀取的預設及本伺服器音效名稱與 ID，僅操作者可見 |
| 待測 | 音效很多時執行 refresh | 回覆提示下載完整文字附件，清單未截斷 |

驗收時可另以唯讀 SQLite 工具檢查 `plays` 的 guild_id、channel_id、user_id、sound_id、received_at_ms、timing，以及 `coverage` 的起訖。不要將 Token 或包含語音連線憑證的原始 Gateway 封包貼到日誌／聊天。

完成後在此檔補記日期、實測環境及各項結果；在全部必要情境通過前，狀態仍為「本地實作完成，Discord 實測待驗收」。
