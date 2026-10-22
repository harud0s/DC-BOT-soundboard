import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { joinVoiceChannel, entersState, VoiceConnectionStatus as Status } from '@discordjs/voice';

export class VoiceManager {
  constructor(client, tracker, store, { join = joinVoiceChannel, wait = entersState, log = console } = {}) {
    Object.assign(this, { client, tracker, store, join, wait, log });
    this.connections = new Map();
    this.desired = new Map();
    this.locks = new Map();
    this.stopping = false;
  }
  serialize(guildId, fn) {
    const next = (this.locks.get(guildId) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.locks.set(guildId, next);
    void next.finally(() => { if (this.locks.get(guildId) === next) this.locks.delete(guildId); }).catch(() => {});
    return next;
  }
  async connect(channel) {
    return this.serialize(channel.guild.id, async () => {
      if (this.stopping) throw new Error('Bot 正在關閉。');
      if (channel.type !== ChannelType.GuildVoice) throw new Error('目前僅支援一般語音頻道。');
      const me = channel.guild.members.me ?? await channel.guild.members.fetchMe();
      const permissions = channel.permissionsFor(me);
      if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) {
        throw new Error('Bot 缺少該語音頻道的「檢視頻道」或「連線」權限。');
      }
      const guildId = channel.guild.id;
      const previous = this.connections.get(guildId);
      if (previous?.channelId === channel.id && previous.connection.state.status === Status.Ready
        && channel.guild.members.me?.voice.channelId === channel.id) {
        this.sync(guildId);
        return;
      }
      this.desired.set(guildId, channel.id);
      this.store.setTarget(guildId, channel.id);
      let entry = previous;
      if (entry) {
        // Rejoin sends one move request. Destroy + join would send a leave
        // acknowledgement that can arrive late and cancel the new connection.
        this.tracker.close(guildId, 'channel_switch');
        this.tracker.voice(guildId, null, channel.guild.shardId, false);
        entry.channelId = channel.id;
        entry.requestedChannel = channel.id;
      } else {
        const connection = this.join({ guildId, channelId: channel.id,
          adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: true, selfMute: true });
        entry = { connection, channelId: channel.id, guild: channel.guild, hasJoined: false, recovering: false, waiters: new Set() };
        this.connections.set(guildId, entry);
        connection.on('stateChange', (_old, state) => {
          if (this.connections.get(guildId) !== entry) return;
          this.sync(guildId);
          if (state.status === Status.Disconnected) void this.recover(guildId, entry);
          if (state.status === Status.Destroyed) this.destroy(guildId, 'voice_destroyed');
        });
        connection.on('error', () => {
          if (this.connections.get(guildId) !== entry) return;
          this.log.warn('語音連線錯誤；中止這段監測並等候重試。');
          this.destroy(guildId, 'voice_error');
        });
      }
      const { connection } = entry;
      try {
        if (previous && !connection.rejoin({ channelId: channel.id, selfDeaf: true, selfMute: true })) throw new Error('rejoin failed');
        await this.wait(connection, Status.Ready, 20_000);
        if (this.connections.get(guildId) !== entry) throw new Error('語音連線已取消。');
        await this.confirmChannel(entry);
        if (this.connections.get(guildId) !== entry) throw new Error('語音連線已取消。');
        this.sync(guildId);
        entry.requestedChannel = null;
      } catch {
        if (this.connections.get(guildId) === entry) this.destroy(guildId, 'join_failed');
        throw new Error('語音連線未完成，尚未開始監測；保留目標並每 30 秒重試，可用 /soundboard leave 取消。');
      }
    });
  }
  confirmChannel(entry) {
    if (entry.connection.state.status === Status.Ready && entry.guild.members.me?.voice.channelId === entry.channelId) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = success => {
        clearTimeout(timer);
        entry.waiters.delete(finish);
        if (success) resolve(); else reject(new Error('voice acknowledgement missing'));
      };
      const timer = setTimeout(() => finish(false), 20_000);
      entry.waiters.add(finish);
    });
  }
  sync(guildId) {
    const entry = this.connections.get(guildId);
    if (!entry) return;
    const actualChannel = entry.guild.members.me?.voice.channelId;
    const ready = entry.guild.available !== false && entry.connection.state.status === Status.Ready
      && actualChannel === entry.channelId;
    if (ready) entry.hasJoined = true;
    this.tracker.voice(guildId, entry.channelId, entry.guild.shardId, ready);
    if (ready) for (const finish of entry.waiters) finish(true);
  }
  syncAll() { for (const guildId of this.connections.keys()) this.sync(guildId); }
  async recover(guildId, entry) {
    if (entry.recovering) return;
    entry.recovering = true;
    try {
      await Promise.any([
        this.wait(entry.connection, Status.Signalling, 5_000),
        this.wait(entry.connection, Status.Connecting, 5_000),
        this.wait(entry.connection, Status.Ready, 5_000),
      ]);
    } catch {
      if (this.connections.get(guildId) === entry) this.destroy(guildId, 'voice_disconnect');
    } finally { entry.recovering = false; }
  }
  voiceState(oldState, newState) {
    if (newState.id !== this.client.user?.id) return;
    const guildId = newState.guild.id;
    const entry = this.connections.get(guildId);
    if (!entry) return;
    if (newState.channelId === null && entry.hasJoined) {
      // Respect an administrator's disconnect instead of fighting it forever.
      this.desired.delete(guildId);
      this.store.setTarget(guildId, null);
      this.destroy(guildId, 'server_disconnect');
    } else if (newState.channelId && newState.channelId !== entry.channelId) {
      if (entry.requestedChannel) { this.sync(guildId); return; }
      entry.channelId = newState.channelId;
      this.desired.set(guildId, newState.channelId);
      this.store.setTarget(guildId, newState.channelId);
      this.sync(guildId);
    } else this.sync(guildId);
  }
  destroy(guildId, reason) {
    const entry = this.connections.get(guildId);
    if (!entry) return;
    this.connections.delete(guildId);
    this.tracker.close(guildId, reason);
    this.tracker.voice(guildId, null, entry.guild.shardId, false);
    for (const finish of entry.waiters) finish(false);
    if (entry.connection.state.status !== Status.Destroyed) entry.connection.destroy();
  }
  leave(guildId) {
    return this.serialize(guildId, async () => {
      this.desired.delete(guildId);
      this.store.setTarget(guildId, null);
      this.destroy(guildId, 'manual_leave');
    });
  }
  forget(guildId) {
    this.desired.delete(guildId);
    this.store.setTarget(guildId, null);
    this.destroy(guildId, 'guild_removed');
  }
  async restore() {
    for (const row of this.store.targets()) this.desired.set(row.guild_id, row.channel_id);
    await this.retry();
  }
  async retry() {
    if (this.stopping) return;
    for (const [guildId, channelId] of this.desired) {
      if (this.connections.has(guildId) || this.locks.has(guildId)) continue;
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild || guild.available === false) continue;
      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        this.forget(guildId);
        continue;
      }
      try { await this.connect(channel); } catch { this.log.warn('語音重試未完成；監測仍暫停。'); }
    }
  }
  stop() {
    this.stopping = true;
    for (const id of this.connections.keys()) this.destroy(id, 'shutdown');
  }
}
