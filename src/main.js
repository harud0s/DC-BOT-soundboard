import { Client, Events, GatewayIntentBits } from 'discord.js';
import { readConfig } from './config.js';
import { Store } from './store.js';
import { Tracker } from './tracker.js';
import { VoiceManager } from './voice.js';
import { acquireLock } from './lock.js';
import { wireGateway } from './gateway.js';
import { handleCommand, refreshSounds } from './commands.js';

export const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildExpressions];

export async function start(config) {
  const release = acquireLock(`${config.databasePath}.lockfile`);
  let store;
  try { store = new Store(config.databasePath); store.recover(); } catch (error) { release(); throw error; }
  const client = new Client({ intents, allowedMentions: { parse: [] } });
  const tracker = new Tracker(store);
  const voice = new VoiceManager(client, tracker, store);
  let closing = false;
  let checkpointTimer, retryTimer;
  const shutdown = async (code = 0) => {
    if (closing) return;
    closing = true;
    clearInterval(checkpointTimer);
    clearInterval(retryTimer);
    try { voice.stop(); tracker.stop(); } catch { code = 1; }
    try { await client.destroy(); } finally {
      try { store.close(); } finally { release(); process.exitCode = code; }
    }
  };
  const fatal = () => {
    console.error('本地資料寫入或事件處理失敗，停止監測以避免顯示錯誤的完整性。');
    void shutdown(1);
  };
  wireGateway(client, tracker, voice, store, { fatal });
  client.on(Events.InteractionCreate, interaction => {
    void handleCommand(interaction, { client, voice, tracker, store }).catch(() => console.warn('指令回覆未送達。'));
  });
  client.once(Events.ClientReady, async () => {
    console.log('Bot 已連線。每個伺服器僅監測一個語音房；使用 /soundboard status 查看範圍。');
    try {
      if (config.autoRejoin) await voice.restore();
      for (const guild of client.guilds.cache.values()) await refreshSounds(client, guild, store);
    } catch { fatal(); }
  });
  client.on(Events.Error, () => console.warn('Discord 用戶端連線錯誤；SDK 將依情況重連。'));
  client.on(Events.ShardError, (_error, id) => {
    tracker.disconnect(id, 'gateway_error');
    console.warn('Gateway 連線錯誤；監測暫停。');
  });
  checkpointTimer = setInterval(() => {
    if (closing) return;
    try { voice.syncAll(); tracker.checkpoint(); } catch { fatal(); }
  }, 5_000);
  retryTimer = setInterval(() => { if (!closing) void voice.retry().catch(fatal); }, 30_000);
  checkpointTimer.unref();
  retryTimer.unref();
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  try { await client.login(config.token); } catch {
    await shutdown(1);
    throw new Error('Discord 登入失敗；請檢查 Bot Token、網路及 intents 設定。');
  }
  return { client, tracker, voice, store, shutdown };
}

if (import.meta.main) {
  try { await start(readConfig()); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
