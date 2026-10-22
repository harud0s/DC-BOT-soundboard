import { REST, Routes } from 'discord.js';
import { readConfig } from './config.js';
import { command } from './commands.js';

export async function register(config) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  // POST upserts only this command; do not replace other commands in the app.
  await rest.post(Routes.applicationGuildCommands(config.applicationId, config.guildId), { body: command.toJSON() });
}

if (import.meta.main) {
  try {
    await register(readConfig(process.env, { registration: true }));
    console.log('已在指定測試伺服器註冊 /soundboard。');
  } catch (error) {
    console.error(/[\u3400-\u9fff]/u.test(error.message) ? error.message : '指令註冊失敗；請核對 Token、Application ID、Guild ID 與邀請設定。');
    process.exitCode = 1;
  }
}
