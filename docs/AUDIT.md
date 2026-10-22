# 查核紀錄

查核日期：2026-10-22（Asia/Taipei）。前次對話未被視為任何部署／驗證證據。

## 現有專案

`C:\howard project\DCBOT` 初始為空目錄，沒有程式、套件資訊、Git 工作樹或 AGENTS.md；已建立 `soundboard-tracker`。沒有既有語音進出機制可沿用，改以獨立 `VoiceManager` 實作，便於之後接回其他 Bot。

## 參考儲存庫及授權

已用 GitHub API 查詢 [SudoCasey/Soundboard_Usage_Tracker](https://github.com/SudoCasey/Soundboard_Usage_Tracker)，固定查核 commit：

`580c5ef150ee5a8777cc862aba0dadd93ac09a79`

GitHub 回傳 `license: null`；該 commit 完整檔案樹未有 LICENSE／COPYING，package.json 未宣告 license。僅憑公開可讀不能確認有程式碼再利用授權。因此本專案依官方 API 自行撰寫，未搬入該庫原始碼；不將其稱為 MIT 或其他開源授權。

已讀取該 commit 的實際 [index.js](https://github.com/SudoCasey/Soundboard_Usage_Tracker/blob/580c5ef150ee5a8777cc862aba0dadd93ac09a79/index.js)、[database.js](https://github.com/SudoCasey/Soundboard_Usage_Tracker/blob/580c5ef150ee5a8777cc862aba0dadd93ac09a79/database.js)、[package.json](https://github.com/SudoCasey/Soundboard_Usage_Tracker/blob/580c5ef150ee5a8777cc862aba0dadd93ac09a79/package.json)：

- Node／discord.js 14.14.1、voice 0.16.1、PostgreSQL；有斜線／文字指令及自動加入離開。
- raw listener 處理效果時未先排除無 sound_id 的事件。
- 資料庫保存 guild/sound 的累計及最後時間，沒有逐筆 user/channel 歷史；記憶體部分以名稱分組。
- 未以 session/sequence 去重，也未保存覆蓋區間；斷線直接銷毀語音連線。
- 開啟多個特權 intents，並將大量原始事件及文字訊息寫入日誌。

以上僅為程式碼查核結果，未執行或部署參考專案。

## 官方事件及 SDK

| 查核項目 | 結論與實作 |
| --- | --- |
| [VOICE_CHANNEL_EFFECT_SEND](https://docs.discord.com/developers/events/gateway-events#voice-channel-effect-send) | 只送給已連入房間的用戶端；可能為 emoji 或 Soundboard。sound_id 可選、型別為 snowflake 或 integer。只記有有效 sound_id 的事件；以 ID 分組。 |
| [Gateway intents](https://docs.discord.com/developers/events/gateway#list-of-intents) | 效果及語音狀態在 GUILD_VOICE_STATES 下；Guilds 提供頻道／伺服器快取，GuildExpressions 用於名稱異動；本功能無需特權 intents。 |
| [Gateway Resume](https://docs.discord.com/developers/events/gateway#resuming) | Resume 成功時重播事件，RESUMED 在補送結束後到達；以原 session/sequence 去重，補送標記時間不確定。 |
| [語音連線](https://docs.discord.com/developers/topics/voice-connections) | 由 SDK 完成語音握手及重連，待 Ready 與自身語音狀態一致才開啟覆蓋。滿房、UDP／NAT、DAVE 仍須實測。 |
| [discord.js Client](https://discord.js.org/docs/packages/discord.js/14.27.0/Client:Class) | 安裝版 14.27.0 有 `voiceChannelEffectSend`。已直接讀取 `src/client/websocket/handlers/VOICE_CHANNEL_EFFECT_SEND.js` 與 `src/structures/VoiceChannelEffect.js`。 |
| 安裝版 raw 簽名 | `WebSocketManager.js` 確認 raw 回呼為 packet、shardId。高階事件不帶序號，所以統計只接 raw，一次落盤，不同時接高階事件。檢查腳本會偵測此簽名是否改變。 |
| 依賴 | npm registry 確認 discord.js 14.27.0、voice 0.19.2；兩個直接依賴宣告 Apache-2.0。pnpm-lock.yaml 鎖定解析版本與完整性。已安裝 DAVE 0.1.12，Node 原生 AES 可用。 |

官方文件與 SDK 確認的是支援條件；本次沒有 Token，無法驗證實際 Discord 帳號、伺服器權限或傳輸結果。詳見 ACCEPTANCE.md。
