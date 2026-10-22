import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ChannelType, Client, Events, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { VoiceConnectionStatus as Status } from '@discordjs/voice';
import { Store } from '../src/store.js';
import { Tracker } from '../src/tracker.js';
import { VoiceManager } from '../src/voice.js';
import { wireGateway } from '../src/gateway.js';
import { acquireLock } from '../src/lock.js';
import { intents } from '../src/main.js';

const filter = { guildId: '1', channelIds: ['2', '4'], until: 100_000 };
const packet = (s = 1, channelId = '2') => ({ op: 0, t: 'VOICE_CHANNEL_EFFECT_SEND', s,
  d: { guild_id: '1', channel_id: channelId, user_id: '3', sound_id: '50' } });

class FakeConnection extends EventEmitter {
  state = { status: Status.Signalling };
  transition(status) { const old = this.state; this.state = { status }; this.emit('stateChange', old, this.state); }
  destroy() { this.transition(Status.Destroyed); }
  rejoin(config) { this.onRejoin?.(config); return true; }
}
function setup(t, { failWait = false, noPermission = false } = {}) {
  const store = new Store();
  const tracker = new Tracker(store, { now: () => 1000 }); tracker.ready(0, 's', '99');
  const guild = { id: '1', shardId: 0, available: true, voiceAdapterCreator: () => {},
    members: { me: { voice: { channelId: null } } }, channels: { cache: new Map() } };
  const channel = id => ({ id, guild, type: ChannelType.GuildVoice,
    permissionsFor: () => new PermissionsBitField(noPermission ? 0n : PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect) });
  guild.channels.cache.set('2', channel('2')); guild.channels.cache.set('4', channel('4'));
  const client = { user: { id: '99' }, guilds: { cache: new Map([['1', guild]]) } };
  const calls = [];
  const voice = new VoiceManager(client, tracker, store, {
    join: args => {
      calls.push(args); guild.members.me.voice.channelId = args.channelId;
      const connection = new FakeConnection();
      connection.onRejoin = config => { guild.members.me.voice.channelId = config.channelId; };
      return connection;
    },
    wait: async (connection, status) => {
      if (failWait) throw new Error('timeout');
      connection.transition(status); return connection;
    }, log: { warn() {} },
  });
  t.after(() => { voice.stop(); store.close(); });
  return { store, tracker, voice, guild, calls, channel: guild.channels.cache.get('2') };
}

test('voice join confirms readiness, mutes/deafens and moves between rooms', async t => {
  const { voice, tracker, store, calls, channel, guild } = setup(t);
  await voice.connect(channel);
  assert.equal(tracker.active.get('1').channelId, '2');
  assert.equal(calls[0].selfMute, true); assert.equal(calls[0].selfDeaf, true);
  await voice.connect(channel); assert.equal(calls.length, 1);
  tracker.ingest(packet(1), 0);
  const originalConnection = voice.connections.get('1').connection;
  await voice.connect(guild.channels.cache.get('4'));
  assert.equal(voice.connections.get('1').connection, originalConnection);
  assert.equal(calls.length, 1); // No destroy/recreate and no intermediate leave.
  assert.equal(tracker.ingest(packet(2), 0), 'outside_scope');
  tracker.ingest(packet(3, '4'), 0);
  assert.equal(store.stats(filter).total, 2);
  await voice.leave('1');
  assert.equal(tracker.active.size, 0); assert.equal(store.targets().length, 0);
});
test('join timeout and missing permissions never open coverage', async t => {
  const a = setup(t, { failWait: true });
  await assert.rejects(a.voice.connect(a.channel), /語音連線未完成/);
  assert.equal(a.tracker.active.size, 0); assert.equal(a.voice.desired.get('1'), '2');
  const b = setup(t, { noPermission: true });
  await assert.rejects(b.voice.connect(b.channel), /缺少/);
  assert.equal(b.calls.length, 0); assert.equal(b.store.targets().length, 0);
});
test('room move waits for new channel acknowledgement even if SDK stays Ready', async t => {
  const { voice, tracker, channel, guild } = setup(t);
  await voice.connect(channel);
  voice.connections.get('1').connection.onRejoin = () => {}; // Delay Discord's acknowledgement.
  const moving = voice.connect(guild.channels.cache.get('4'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tracker.active.size, 0);
  voice.voiceState({ channelId: '2' }, { id: '99', guild, channelId: '2' });
  assert.equal(voice.desired.get('1'), '4');
  guild.members.me.voice.channelId = '4';
  voice.voiceState({ channelId: '2' }, { id: '99', guild, channelId: '4' });
  await moving;
  assert.equal(tracker.active.get('1').channelId, '4');
});
test('server kick stops auto-rejoin and preserves history', async t => {
  const { voice, tracker, store, channel, guild } = setup(t);
  await voice.connect(channel); tracker.ingest(packet(), 0);
  guild.members.me.voice.channelId = null;
  voice.voiceState({ channelId: '2' }, { id: '99', guild, channelId: null });
  assert.equal(voice.connections.size, 0); assert.equal(voice.desired.size, 0);
  assert.equal(store.targets().length, 0); assert.equal(store.stats(filter).total, 1);
});
test('restore joins persisted target and serialized join/leave finishes stopped', async t => {
  const { store, voice, channel } = setup(t);
  store.setTarget('1', '2'); await voice.restore();
  assert.equal(voice.connections.size, 1);
  await Promise.all([voice.connect(channel), voice.leave('1')]);
  assert.equal(voice.connections.size, 0); assert.equal(store.targets().length, 0);
});
test('voice connection error closes coverage and retry restores target', async t => {
  const { voice, tracker, channel } = setup(t);
  await voice.connect(channel);
  voice.connections.get('1').connection.emit('error', new Error('network'));
  assert.equal(tracker.active.size, 0); assert.equal(voice.connections.size, 0);
  await voice.retry(); assert.equal(tracker.active.size, 1);
});
test('real SDK event emitter integrates raw dispatch, replay, dedupe and metadata', async t => {
  const store = new Store(); t.after(() => store.close());
  const tracker = new Tracker(store, { now: () => 1000 });
  const client = new Client({ intents }); t.after(() => client.destroy());
  const voice = { syncAll() {}, voiceState() {}, forget() {} };
  wireGateway(client, tracker, voice, store);
  client.emit(Events.Raw, { op: 0, t: 'READY', d: { session_id: 'a', user: { id: '99' } } }, 0);
  tracker.voice('1', '2', 0, true);
  client.emit(Events.Raw, packet(), 0);
  client.emit(Events.VoiceChannelEffectSend, { soundId: '50' });
  assert.equal(store.stats(filter).total, 1);
  client.emit(Events.ShardReconnecting, 0);
  client.emit(Events.Raw, packet(), 0); client.emit(Events.Raw, packet(2), 0);
  client.emit(Events.Raw, { op: 0, t: 'RESUMED', d: {} }, 0);
  client.emit(Events.Raw, packet(3), 0);
  assert.equal(store.stats(filter).total, 3); assert.equal(store.stats(filter).replay, 1);
  client.emit(Events.GuildSoundboardSoundUpdate, {}, { soundId: '50', name: 'renamed' });
  assert.equal(store.stats(filter).soundRows[0].name, 'renamed');
});
test('one running process per database lock', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dcbot-lock-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'db.lockfile'); const release = acquireLock(path);
  assert.throws(() => acquireLock(path), /已有執行中的 Bot/); release();
  acquireLock(path)();
});

test('process crash releases OS lock without deleting a stale file', { timeout: 10_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dcbot-crash-'));
  const path = join(dir, 'db.lockfile');
  const moduleUrl = new URL('../src/lock.js', import.meta.url).href;
  const code = `import { acquireLock } from ${JSON.stringify(moduleUrl)}; acquireLock(${JSON.stringify(path)}); console.log('locked'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); rmSync(dir, { recursive: true, force: true }); });
  await once(child.stdout, 'data');
  assert.throws(() => acquireLock(path), /已有執行中的 Bot/);
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  acquireLock(path)();
});
