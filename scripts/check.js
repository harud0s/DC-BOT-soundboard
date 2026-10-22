import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { getCiphers } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Events, GatewayIntentBits, version } from 'discord.js';
import { generateDependencyReport } from '@discordjs/voice';
import { command } from '../src/commands.js';
import { intents } from '../src/main.js';

const require = createRequire(import.meta.url);
for (const directory of ['src', 'scripts', 'test']) {
  for (const file of readdirSync(directory).filter(file => file.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${file}`);
  }
}
command.toJSON();
if (!intents.includes(GatewayIntentBits.GuildVoiceStates)) throw new Error('Missing voice intent');
if (!getCiphers().includes('aes-256-gcm')) throw new Error('Missing native AES support');
if (Events.VoiceChannelEffectSend !== 'voiceChannelEffectSend') throw new Error('Unsupported SDK');
const sdkRoot = dirname(require.resolve('discord.js'));
const source = readFileSync(join(sdkRoot, 'client/websocket/WebSocketManager.js'), 'utf8');
if (!source.includes('this.client.emit(Events.Raw, data, shardId)')) throw new Error('Raw event signature changed; review adapter');
console.log(`Node ${process.version}; discord.js ${version}; syntax, slash payload, intents and raw SDK signature OK.`);
console.log(generateDependencyReport());
console.log('不收音、不播放音訊，因此無需 Opus 或 FFmpeg。此檢查未連線 Discord。');
