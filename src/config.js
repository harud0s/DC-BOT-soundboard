import { resolve } from 'node:path';

export function readConfig(env = process.env, { registration = false } = {}) {
  const token = env.DISCORD_TOKEN?.trim();
  if (!token) throw new Error('DISCORD_TOKEN 尚未設定；請填入 .env 的 Bot Token。可先執行 test、check、demo。');
  const applicationId = env.DISCORD_APPLICATION_ID?.trim();
  const guildId = env.DISCORD_GUILD_ID?.trim();
  if (registration && (!/^\d{17,20}$/.test(applicationId ?? '') || !/^\d{17,20}$/.test(guildId ?? ''))) {
    throw new Error('註冊指令需填入 DISCORD_APPLICATION_ID 與 DISCORD_GUILD_ID。');
  }
  const autoRejoin = env.AUTO_REJOIN?.trim() || 'true';
  if (!['true', 'false'].includes(autoRejoin)) throw new Error('AUTO_REJOIN 必須為 true 或 false。');
  return { token, applicationId, guildId, autoRejoin: autoRejoin === 'true',
    databasePath: resolve(env.DATABASE_PATH || './data/soundboard.sqlite') };
}
