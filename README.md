# Discord 原生 Soundboard 使用統計

日常操作可直接查看[常用指令](常用指令.md)。

使用者照常點 Discord 原生音效板。本程式以 Bot 帳號連入指定語音房，監聽官方 `VOICE_CHANNEL_EFFECT_SEND` 事件，儲存音效 ID、播放者 ID、伺服器 ID、頻道 ID、接收時間及即時／補送標記。沒有播放指令、錄音、音訊訂閱或 self-bot。

已完成本地程式及 31 項離線模擬測試。儲存庫不包含 Bot Token、本地設定或播放資料庫。部署時請自行設定 `.env`；完整 Discord 實機驗收仍依[驗收清單](docs/ACCEPTANCE.md)逐項確認。

## 本地啟動

需求：Node.js **24.17 以上的 24.x**、pnpm 11.25.0。下載後，在 PowerShell 執行：

目前這台電腦的專案路徑為 `C:\Howard_WorkSpace\Projects\DCbot\soundboard-tracker`，已在 `.tools/` 安裝專案專用 Node.js 24.22.1 與 pnpm 11.25.0。在此目錄執行 `& '.\.tools\node\node.exe' --env-file=.env src/main.js` 即可，詳細指令見[常用指令](常用指令.md)。此電腦的 Windows PowerShell 5.1 禁止 `.ps1`，直接呼叫執行檔無需修改執行原則；在 PowerShell 7 中亦可使用 `.\dev.ps1 start`。`dev.ps1` 優先使用本機工具、檢查版本，結束時還原原本 PATH；不修改系統安裝。

```powershell
git clone https://github.com/harud0s/DC-BOT-soundboard.git
cd DC-BOT-soundboard
pnpm install --frozen-lockfile
.\dev.ps1 test
.\dev.ps1 check
.\dev.ps1 demo
```

`demo` 完全離線且只用記憶體資料庫，不會混入正式資料。`check` 驗證語法、指令定義、intents、已安裝 SDK 的 raw 回呼簽名及語音依賴。

在其他電腦初次安裝時：先安裝 Node.js 24.x 及 pnpm 11.25.0，執行 `pnpm install --frozen-lockfile`，或 `.\dev.ps1 install`。已鎖定 `discord.js 14.27.0`、`@discordjs/voice 0.19.2` 及完整間接依賴。語音 SDK 已包含 DAVE 支援；本功能不編解碼音訊，因此不需要 FFmpeg／Opus。

`dev.ps1 install` 固定使用 npm 官方 registry、鎖定版本與 `--ignore-scripts`；已在停用套件安裝腳本的狀態下驗證 Windows x64 的 DAVE 預編譯套件可載入。可用 `.\dev.ps1 audit` 查詢目前已知的套件漏洞。

首次下載後，將 `.env.example` 複製成 `.env`（已有設定時不要覆蓋）。只在本機填入：

```dotenv
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=
DATABASE_PATH=./data/soundboard.sqlite
AUTO_REJOIN=true
```

- `DISCORD_TOKEN`：Developer Portal 的 Bot Token，不是使用者 Token。
- `DISCORD_APPLICATION_ID`：應用程式 ID。
- `DISCORD_GUILD_ID`：先使用測試伺服器 ID；用於註冊指令。
- `DATABASE_PATH`：相對路徑以啟動時目錄為基準；`dev.ps1` 固定切換到本專案。
- `AUTO_REJOIN=true`：重啟時回到每個伺服器最後選定的房間。`false` 則需重新 `/soundboard join`。執行期間的暫時斷線仍會重試；`leave` 會取消目標。

填好設定後，在自己的終端執行：

```powershell
.\dev.ps1 register
.\dev.ps1 start
```

也可用 `pnpm register`、`pnpm start`。註冊動作僅新增或更新指定伺服器的 `/soundboard`，不覆蓋同一應用的其他指令；啟動不會自動註冊。結束時按 Ctrl+C。空白 Token 會在任何 Discord 連線前結束並提示設定。

## Discord 設定

1. 建立 Bot，邀請時選 `bot` 與 `applications.commands` scopes。
2. Bot 在目標語音房需有 **View Channel、Connect**；確保頻道權限覆寫允許它連入。滿房、伺服器封鎖、網路／UDP 防火牆仍可能阻止加入。不要為了本功能開 Administrator。
3. 本程式設定 `Guilds`、`GuildVoiceStates`、`GuildExpressions` intents。前兩者供頻道／語音狀態及效果事件；第三個更新音效名稱。**不需要開啟 Message Content、Guild Members 或 Presence 特權 intents。**
4. 使用者需能在指定文字頻道使用應用程式指令。控制監測的使用者需有「管理伺服器」權限；查詢不需要此權限。
5. Bot 採 `selfMute=true`、`selfDeaf=true`，只讀 Gateway 效果中繼資料。真實環境中此模式能否收到預期事件，仍須依[驗收清單](docs/ACCEPTANCE.md)確認。

## 指令

| 指令 | 功能 |
| --- | --- |
| `/soundboard join` | 加入操作者目前所在的一般語音房，確認連線就緒後監測；需要管理伺服器權限 |
| `/soundboard leave` | 離開、取消自動重連，保留歷史；需要管理伺服器權限 |
| `/soundboard sounds [channel] [public] [days] [show_unknown]` | 只顯示已確認監測的頻道數、累計秒數及音效播放次數前 30 名，不顯示音效 ID；內容較長時以卡片顯示；第二個選項 public 決定是否公開；show_unknown 決定是否顯示無名稱音效 |
| `/soundboard users [channel] [public] [days] [user]` | 只顯示監測摘要與使用者前 30 名（播放次數／音效種類數）；內容較長時以卡片顯示；第二個選項 public 決定是否公開，指定 user 時只列該使用者 |
| `/soundboard status [channel] [days]` | 完整顯示查詢範圍、統計摘要、監測限制、目前／目標房間及最近 5 段監測區間 |
| `/soundboard refresh` | 更新預設及本伺服器音效名稱，列出本次成功讀取的音效名稱與 ID；清單過長時附文字檔，需要管理伺服器權限 |

查詢省略 `channel` 時，只彙總操作者目前可檢視的一般語音頻道；省略 `days` 為所有已存紀錄，否則範圍為最近 1–365 天。回覆預設僅操作者可見；`sounds` 或 `users` 選擇 `public:true` 時，會把查詢結果公開到執行指令的頻道，供可檢視該頻道的成員查看。`public:false` 或省略則維持私人回覆，其他子指令也維持私人回覆。所有回覆皆停用實際 mention 通知。已刪除或已失去檢視權限的房間仍保有資料，但不出現在一般查詢中。

`sounds` 的 `show_unknown` 以是否有快取名稱判斷「未知／外部／已刪除音效」：選 `true` 時包含未知音效，最多顯示整體前 30 名；選 `false` 時先排除全部無名稱音效，再取有名稱音效的前 30 名。省略時維持原本行為，只隱藏末尾連續無名稱的項目。此選項不影響 `public`、原始紀錄或總統計；如果已有紀錄但全部被隱藏，顯示「沒有可顯示的排行項目」。新增此選項後需重新註冊指令並重啟 Bot。

`users` 從排行榜末尾向 Discord 確認成員，僅在 API 明確回覆成員／使用者不存在時隱藏。遇到仍在伺服器的成員便停止裁切；權限、限流或暫時網路錯誤均保留該列。排行中段的未知使用者與原始統計仍保留。

## 統計與監測限制

- **每個伺服器同一時間只監測一個一般語音房。** `join` 換房後，舊房停止監測。支援多個伺服器各一房，不支援 Stage 或私訊通話。
- Discord 僅將效果事件送給連入該語音房的 Bot。未加入的房間、尚未就緒、離線或重連缺口都屬於「未知」，不推算為零使用；也沒有歷史播放紀錄 API 可回填。
- 不含 `sound_id` 或其值為 null 的事件直接排除。支援數字型預設音效 ID（包含 0），Snowflake 全程以字串儲存；不接受失去精度的數字。名稱只是顯示用，重名／改名不會混算。`sounds` 隱藏 ID；同名但不同 ID 仍分列，無名稱時以「未知／外部／已刪除音效」顯示並依 `show_unknown` 決定是否隱藏，原始紀錄與統計仍保留。`refresh` 可查看本次成功讀取的預設及本伺服器音效 ID，不保證列出已刪除或外部音效。
- 時間欄位是 **Bot 收到事件的 UTC 毫秒時間**，不是 Discord 保證的播放時間。事件沒有原始時間戳；重連補送標記 `replay`。日期篩選按接收時間，因此補送可能歸入較晚的日期。實際播放聲音是否可聽見、是否被使用者靜音，不能由此事件判定。
- 去重鍵為 Bot ID、shard、Gateway session 的 SHA-256 加事件序號 `s`，SQLite 唯一鍵持久化防止同一事件重送加算。不同序號的連續點擊仍各算一次。新 session 的序號不會與舊 session 混淆。
- 斷線後若 SDK 成功 Resume，接受先前監測範圍的補送，但不把空白期間宣稱為完整覆蓋。若無法 Resume 或程序重啟，不承諾補回遺失事件；本程式不持久化 Gateway 登入／Resume 憑證。
- 覆蓋紀錄以 Gateway 線上、語音 Ready、Bot 頻道狀態一致為條件。每 5 秒及收到事件時更新確認點。異常退出後，舊區段結束於最後確認點；正常退出、離房、斷線會結束區段。這是本機觀測到的連線區間，網路斷線偵測延遲與系統時鐘誤差仍可能存在，並非事件絕不遺漏的保證。
- 語音暫時斷線先讓 SDK 恢復，失敗後重建連線，每 30 秒重試。管理員踢除 Bot 時清除目標，避免不斷自動加入。手動移動 Bot 後以新的語音狀態更新範圍。
- 同一資料庫有程序獨占鎖，程序被強制關閉後由作業系統釋放。**同一 Bot Token 仍只應啟動一份程式**，不要用不同資料庫同時啟動多份；Discord 不提供跨 session 的播放事件 UUID，不能保證跨獨立部署去重。

## 資料及維護

`data/soundboard.sqlite` 使用 SQLite WAL、FULL 同步及索引。資料表：`plays`（逐筆紀錄）、`coverage`（監測區段）、`settings`（每個伺服器的目標房間）、`sounds`（名稱快取）。`*.lockfile` 是專用 SQLite 執行鎖，無須在重啟前刪除。

正式資料只包含 ID、音效名稱及時間，不保存語音、聊天內容或原始 Gateway 封包。資料目前保留直到管理者自行清理；請向伺服器成員說明統計用途，限制本機資料夾的存取。備份時先 Ctrl+C 正常停止，再備份整個 `data` 目錄；不要只複製執行中的主 `.sqlite` 而漏掉 WAL。`.env`、資料庫、依賴及鎖檔已列入 `.gitignore`。

目前目錄原本為空，沒有可整合的舊語音加入／離開程式。此子專案為獨立實作：`main.js` 組裝、`gateway.js` 接 SDK 事件、`voice.js` 管理語音連線、`tracker.js` 處理監測與計數、`store.js` 持久化、`commands.js` 提供指令。未複製參考儲存庫程式碼。

詳見[查核紀錄與來源](docs/AUDIT.md)、[Discord 實機驗收清單](docs/ACCEPTANCE.md)、[本地驗證結果](docs/TESTING.md)。
