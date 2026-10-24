import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, MessageFlags, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { command, report, queryFilter, handleCommand, refreshSounds } from '../src/commands.js';
import { Store } from '../src/store.js';
import { Tracker } from '../src/tracker.js';
import { readConfig } from '../src/config.js';

test('command payload validates and bounds date filters', () => {
  const data = command.toJSON();
  assert.deepEqual(data.options.map(o => o.name), ['join', 'leave', 'sounds', 'users', 'status', 'refresh']);
  assert.equal(data.dm_permission, false);
  for (const name of ['sounds', 'users']) {
    const options = data.options.find(o => o.name === name).options;
    assert.deepEqual(options.map(o => o.name), ['channel', 'public', 'days', ...(name === 'users' ? ['user'] : [])]);
    assert.equal(options[1].type, 5);
    assert.equal(options[1].required, false);
    assert.equal(options.find(o => o.name === 'days').max_value, 365);
  }
  for (const sub of data.options.filter(o => !['sounds', 'users'].includes(o.name))) {
    assert.equal(sub.options.some(o => o.name === 'public'), false);
  }
});
test('empty reports describe missing observations instead of zero global use', t => {
  const store = new Store(); t.after(() => store.close());
  const filter = { guildId: '1', channelIds: ['2'], until: 1000 };
  for (const mode of ['sounds', 'users']) {
    const text = report(store, filter, mode);
    assert.equal(text, '已確認監測：0 個頻道，合計 0 秒。\n\n此查詢範圍內尚無觀測紀錄。');
  }
  const detailed = report(store, filter, 'status');
  assert.match(detailed, /未知，不代表零使用/); assert.match(detailed, /原始播放時間未知/);
});

test('sound rankings omit trailing unknown sounds while preserving earlier rows and stored statistics', t => {
  const store = new Store(); t.after(() => store.close());
  store.upsertSound('7', 'ba dum tss');
  store.upsertSound('8', 'ba dum tss');
  for (const [sequence, soundId] of ['6', '7', '8', '9', '90'].entries()) {
    store.record({ sessionKey: 'fixture', sequence, guildId: '1', channelId: '2', userId: '3',
      soundId, receivedAt: 100, timing: 'live' });
  }
  const filter = { guildId: '1', channelIds: ['2'], until: 1000 };
  const text = report(store, filter, 'sounds');
  assert.equal(text, '已確認監測：0 個頻道，合計 0 秒。\n\n1. 未知／外部／已刪除音效：1 次\n2. ba dum tss：1 次\n3. ba dum tss：1 次');
  assert.equal(store.stats(filter).total, 5);
  assert.equal(store.stats(filter).soundRows.length, 5);
  store.upsertSound('7', '');
  store.upsertSound('8', '');
  assert.equal(report(store, filter, 'sounds'), '已確認監測：0 個頻道，合計 0 秒。\n\n此查詢範圍內沒有可顯示的排行項目。');
  assert.match(report(store, filter, 'status'), /已記錄 5 次/);
});
test('queries exclude hidden voice channels', () => {
  const channel = (id, visible) => ({ id, type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => visible }) });
  const channels = new Map([['2', channel('2', true)], ['3', channel('3', false)]]);
  const interaction = { guildId: '1', guild: { channels: { cache: channels } }, member: {},
    options: { getChannel: () => null, getInteger: () => 1 } };
  assert.deepEqual(queryFilter(interaction, 90_000_000).channelIds, ['2']);
  assert.equal(queryFilter(interaction, 90_000_000).since, 3_600_000);
  interaction.options.getChannel = () => channels.get('3');
  assert.throws(() => queryFilter(interaction), /不能檢視/);
});

test('rankings return the top 30 and keep long results within one public or private reply', async t => {
  const store = new Store(); t.after(() => store.close());
  let sequence = 0;
  for (let i = 1; i <= 31; i++) {
    const soundId = String(i);
    store.upsertSound(soundId, `音效${i}`);
    for (let play = 0; play < i; play++) {
      store.record({ sessionKey: 'ranking', sequence: sequence++, guildId: '1', channelId: '2', userId: soundId,
        soundId, receivedAt: 100, timing: 'live' });
    }
  }
  const context = { store, tracker: new Tracker(store), now: () => 1000 };
  const query = (publicChoice, sub = 'sounds') => {
    const result = interaction(sub, false, publicChoice);
    result.guild.channels.cache.set('2', { id: '2', type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) });
    return result;
  };
  const short = query(null);
  await handleCommand(short, context);
  assert.match(short.replies[1].content, /\n1\. 音效31：31 次\n/);
  assert.match(short.replies[1].content, /\n30\. 音效2：2 次$/);
  assert.equal(short.replies[1].embeds, undefined);
  const filter = { guildId: '1', channelIds: ['2'], until: 1000 };
  assert.equal(store.stats(filter).sounds, 31);
  assert.equal(store.stats(filter).users, 31);
  assert.equal(store.stats(filter).userRows.length, 30);
  for (const publicChoice of [null, true]) {
    const users = query(publicChoice, 'users');
    await handleCommand(users, context);
    assert.equal(users.replies[0].flags, publicChoice ? undefined : MessageFlags.Ephemeral);
    assert.match(users.replies[1].content, /\n1\. \*\*<@31>\*\*：31 次／1 個音效\n/);
    assert.match(users.replies[1].content, /\n30\. \*\*<@2>\*\*：2 次／1 個音效$/);
    assert.deepEqual(users.replies[1].allowedMentions, { parse: [] });
  }
  const individual = query(null, 'users');
  individual.options.getUser = () => ({ id: '1' });
  await handleCommand(individual, context);
  assert.equal(individual.replies[1].content, '已確認監測：0 個頻道，合計 0 秒。\n\n1. **<@1>**：1 次／1 個音效');

  for (let i = 1; i <= 31; i++) store.upsertSound(String(i), `${'長'.repeat(65)}${i}`);
  const expected = report(store, filter, 'sounds');
  assert.ok(expected.length > 2000);
  for (const publicChoice of [null, true]) {
    const long = query(publicChoice);
    await handleCommand(long, context);
    assert.equal(long.replies.length, 2);
    assert.equal(long.replies[0].flags, publicChoice ? undefined : MessageFlags.Ephemeral);
    const reply = long.replies[1];
    assert.equal(reply.content, '');
    assert.equal(reply.embeds.length, 1);
    assert.equal(reply.embeds[0].description, expected);
    assert.ok(reply.embeds[0].description.length <= 4096);
    assert.deepEqual(reply.allowedMentions, { parse: [] });
  }
});
test('config requires token and validates registration and restore flag', () => {
  assert.throws(() => readConfig({}), /DISCORD_TOKEN/);
  assert.throws(() => readConfig({ DISCORD_TOKEN: 'fixture' }, { registration: true }), /DISCORD_APPLICATION_ID/);
  assert.throws(() => readConfig({ DISCORD_TOKEN: 'fixture', AUTO_REJOIN: 'typo' }), /AUTO_REJOIN/);
  assert.equal(readConfig({ DISCORD_TOKEN: 'fixture', AUTO_REJOIN: 'false' }).autoRejoin, false);
});
function interaction(sub, admin = false, publicChoice = null) {
  const replies = [];
  return { replies, isChatInputCommand: () => true, commandName: 'soundboard', inCachedGuild: () => true,
    guildId: '1', guild: { channels: { cache: new Map() }, members: { fetch: async ({ user }) => ({ id: user }) } }, member: { voice: {} },
    memberPermissions: new PermissionsBitField(admin ? PermissionFlagsBits.ManageGuild : 0n),
    options: { getSubcommand: () => sub, getChannel: () => null, getInteger: () => null, getUser: () => null,
      getBoolean: () => publicChoice },
    deferReply: async opts => replies.push(opts), editReply: async opts => replies.push(opts) };
}

test('user rankings hide only confirmed missing trailing members and retain rows on lookup failure', async t => {
  const store = new Store(); t.after(() => store.close());
  for (let i = 1; i <= 4; i++) {
    store.record({ sessionKey: 'members', sequence: i, guildId: '1', channelId: '2', userId: String(i),
      soundId: '7', receivedAt: 100, timing: 'live' });
  }
  const context = { store, tracker: new Tracker(store), now: () => 1000 };
  const query = (publicChoice = null) => {
    const result = interaction('users', false, publicChoice);
    result.guild.channels.cache.set('2', { id: '2', type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) });
    return result;
  };
  for (const publicChoice of [null, true]) {
    const users = query(publicChoice);
    const fetched = [];
    users.guild.members.cache = new Map();
    users.guild.members.fetch = async options => {
      assert.deepEqual(options, { user: options.user, force: true, cache: false });
      fetched.push(options.user);
      if (options.user !== '2') throw Object.assign(new Error('missing'), { code: options.user === '3' ? 10013 : 10007 });
      return { id: '2' };
    };
    await handleCommand(users, context);
    assert.deepEqual(fetched, ['4', '3', '2']);
    assert.equal(users.replies[0].flags, publicChoice ? undefined : MessageFlags.Ephemeral);
    assert.equal(users.replies[1].content, '已確認監測：0 個頻道，合計 0 秒。\n\n1. **<@1>**：1 次／1 個音效\n2. **<@2>**：1 次／1 個音效');
    assert.deepEqual(users.replies[1].allowedMentions, { parse: [] });
  }
  for (const error of [new Error('network timeout'), { code: 50013 }, { status: 429 }, { status: 503 }]) {
    const users = query();
    users.guild.members.fetch = async ({ user }) => {
      if (user === '4') throw { code: 10007 };
      throw error;
    };
    await handleCommand(users, context);
    assert.match(users.replies[1].content, /\n3\. \*\*<@3>\*\*：1 次／1 個音效$/);
    assert.doesNotMatch(users.replies[1].content, /<@4>/);
  }
  for (const selectedUser of [null, { id: '4' }]) {
    const users = query();
    users.options.getUser = () => selectedUser;
    users.guild.members.fetch = async () => { throw { code: 10007 }; };
    await handleCommand(users, context);
    assert.equal(users.replies[1].content, '已確認監測：0 個頻道，合計 0 秒。\n\n此查詢範圍內沒有可顯示的排行項目。');
  }
  const stats = store.stats({ guildId: '1', channelIds: ['2'], until: 1000 });
  assert.equal(stats.total, 4);
  assert.equal(stats.users, 4);
  assert.equal(stats.userRows.length, 4);
});

test('join/leave require management permission; queries remain available', async t => {
  const store = new Store(); t.after(() => store.close()); const tracker = new Tracker(store);
  let left = false;
  const context = { store, tracker, voice: { leave: async () => { left = true; } } };
  const denied = interaction('leave'); await handleCommand(denied, context);
  assert.equal(left, false); assert.match(denied.replies[1].content, /管理伺服器/);
  await handleCommand(interaction('leave', true), context); assert.equal(left, true);
  const query = interaction('sounds'); await handleCommand(query, context);
  assert.match(query.replies[1].content, /尚無觀測紀錄/);
  assert.deepEqual(query.replies[1].allowedMentions, { parse: [] });
});
test('metadata fetch failure preserves ID-based operation', async t => {
  const store = new Store(); t.after(() => store.close());
  const client = { fetchDefaultSoundboardSounds: async () => new Map([['1', { soundId: '1', name: 'default' }]]) };
  const guild = { soundboardSounds: { fetch: async () => { throw new Error('403'); } } };
  assert.deepEqual(await refreshSounds(client, guild, store), {
    count: 1, failures: 1, sounds: [{ sound_id: '1', name: 'default' }],
  });
  assert.equal(store.db.prepare('SELECT name FROM sounds').get().name, 'default');
});

test('refresh privately lists fetched names and IDs, excluding unrelated cached sounds', async t => {
  const store = new Store(); t.after(() => store.close());
  store.upsertSound('99', 'another guild');
  const client = { fetchDefaultSoundboardSounds: async () => new Map([['0', { soundId: 0, name: 'same' }]]) };
  const guildSounds = { fetch: async () => new Map([['123456789012345678', { soundId: '123456789012345678', name: 'same' }]]) };
  const context = { store, client };
  const denied = interaction('refresh');
  await handleCommand(denied, context);
  assert.match(denied.replies[1].content, /管理伺服器/);
  const query = interaction('refresh', true, true);
  query.guild.soundboardSounds = guildSounds;
  await handleCommand(query, context);
  assert.equal(query.replies[0].flags, MessageFlags.Ephemeral);
  assert.equal(query.replies[1].content, '已更新 2 筆音效名稱。\n\n1. same（ID 0）\n2. same（ID 123456789012345678）');
  assert.deepEqual(query.replies[1].allowedMentions, { parse: [] });
  assert.equal(query.replies[1].files, undefined);

  query.guild.soundboardSounds.fetch = async () => { throw new Error('403'); };
  const partial = interaction('refresh', true); partial.guild.soundboardSounds = query.guild.soundboardSounds;
  await handleCommand(partial, context);
  assert.match(partial.replies[1].content, /未全部成功/);
  assert.match(partial.replies[1].content, /ID 0/);
  assert.doesNotMatch(partial.replies[1].content, /123456789012345678/);

  client.fetchDefaultSoundboardSounds = async () => { throw new Error('503'); };
  const failed = interaction('refresh', true); failed.guild.soundboardSounds = query.guild.soundboardSounds;
  await handleCommand(failed, context);
  assert.match(failed.replies[1].content, /未全部成功/);
  assert.match(failed.replies[1].content, /本次沒有可列出的音效/);
});

test('refresh preserves a long ID list in an attachment within the reply limit', async t => {
  const store = new Store(); t.after(() => store.close());
  const sounds = Array.from({ length: 100 }, (_, i) => ({ soundId: String(123456789012345678n + BigInt(i)), name: `音效 ${i}` }));
  const client = { fetchDefaultSoundboardSounds: async () => new Map() };
  const query = interaction('refresh', true);
  query.guild.soundboardSounds = { fetch: async () => new Map(sounds.map(sound => [sound.soundId, sound])) };
  await handleCommand(query, { store, client });
  const reply = query.replies[1];
  assert.ok(reply.content.length <= 2000);
  assert.match(reply.content, /100 筆/);
  assert.equal(reply.files.length, 1);
  assert.equal(reply.files[0].name, 'soundboard-sounds.txt');
  const attachment = reply.files[0].attachment.toString('utf8');
  for (const sound of sounds) assert.ok(attachment.includes(`${sound.name}（ID ${sound.soundId}）`));
  assert.equal(query.replies[0].flags, MessageFlags.Ephemeral);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});

test('only explicit public sounds and users queries are visible to the channel', async t => {
  const store = new Store(); t.after(() => store.close());
  const context = { store, tracker: new Tracker(store), voice: { desired: new Map() } };
  for (const [sub, choice, expectedFlags] of [
    ['sounds', null, MessageFlags.Ephemeral],
    ['sounds', false, MessageFlags.Ephemeral],
    ['sounds', true, undefined],
    ['users', null, MessageFlags.Ephemeral],
    ['users', false, MessageFlags.Ephemeral],
    ['users', true, undefined],
    ['status', true, MessageFlags.Ephemeral],
  ]) {
    const query = interaction(sub, false, choice);
    await handleCommand(query, context);
    assert.equal(query.replies[0].flags, expectedFlags, `${sub}: ${choice}`);
    assert.match(query.replies[1].content, /已確認監測/);
    assert.deepEqual(query.replies[1].allowedMentions, { parse: [] });
  }
});
