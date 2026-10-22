import { createHash } from 'node:crypto';

export function normalizeId(value, { allowZero = false } = {}) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    value = String(value);
  }
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value)) return null;
  if (BigInt(value) > 18446744073709551615n || (!allowZero && value === '0')) return null;
  return value;
}

export class Tracker {
  constructor(store, { now = Date.now } = {}) {
    this.store = store;
    this.now = now;
    this.shards = new Map();
    this.voices = new Map();
    this.active = new Map();
    this.known = new Map();
  }
  ready(shardId, sessionId, botId) {
    if (!sessionId || !botId) throw new Error('Gateway READY 缺少工作階段資料。');
    this.disconnect(shardId, 'new_gateway_session');
    for (const voice of this.voices.values()) if (voice.shardId === shardId) voice.ready = false;
    const key = createHash('sha256').update(JSON.stringify([botId, shardId, sessionId])).digest('hex');
    this.shards.set(shardId, { key, online: true });
    this.known.set(shardId, new Map());
    this.reconcileAll();
  }
  disconnect(shardId, reason = 'gateway_disconnect') {
    const shard = this.shards.get(shardId);
    if (shard) shard.online = false;
    for (const [guildId, v] of this.voices) if (v.shardId === shardId) this.close(guildId, reason);
  }
  resume(shardId) {
    const shard = this.shards.get(shardId);
    if (shard) shard.online = true;
    this.reconcileAll();
  }
  voice(guildId, channelId, shardId, ready) {
    this.voices.set(guildId, { channelId, shardId, ready });
    this.reconcile(guildId);
  }
  reconcileAll() { for (const guildId of this.voices.keys()) this.reconcile(guildId); }
  reconcile(guildId) {
    const voice = this.voices.get(guildId);
    const shard = this.shards.get(voice?.shardId);
    const current = this.active.get(guildId);
    const canMonitor = voice?.ready && voice.channelId && shard?.online;
    if (current && (!canMonitor || current.channelId !== voice.channelId || current.sessionKey !== shard.key)) {
      this.close(guildId, 'voice_or_gateway_changed');
    }
    if (canMonitor && !this.active.has(guildId)) {
      const id = this.store.openCoverage(guildId, voice.channelId, shard.key, this.now());
      const scope = { id, channelId: voice.channelId, sessionKey: shard.key };
      this.active.set(guildId, scope);
      this.known.get(voice.shardId).set(`${guildId}:${voice.channelId}`, scope);
    }
  }
  close(guildId, reason) {
    const current = this.active.get(guildId);
    if (current) {
      this.store.closeCoverage(current.id, this.now(), reason);
      this.active.delete(guildId);
    }
  }
  checkpoint() { for (const current of this.active.values()) this.store.confirm(current.id, this.now()); }
  stop() { for (const id of this.active.keys()) this.close(id, 'shutdown'); }

  ingest(packet, shardId) {
    if (packet?.op !== 0 || packet.t !== 'VOICE_CHANNEL_EFFECT_SEND') return 'ignored_event';
    const data = packet.d;
    if (data?.sound_id === undefined || data.sound_id === null) return 'not_soundboard';
    const soundId = normalizeId(data.sound_id, { allowZero: true });
    const guildId = normalizeId(data.guild_id);
    const channelId = normalizeId(data.channel_id);
    const userId = normalizeId(data.user_id);
    if (!soundId || !guildId || !channelId || !userId || !Number.isSafeInteger(packet.s) || packet.s < 0) return 'invalid_payload';
    const shard = this.shards.get(shardId);
    if (!shard) return 'unknown_session';
    // RESUMED arrives after replay. Preserve observed replay events, but never
    // claim that their receive timestamp is their original playback timestamp.
    const scope = shard.online ? this.active.get(guildId) : this.known.get(shardId)?.get(`${guildId}:${channelId}`);
    if (!scope || scope.channelId !== channelId || scope.sessionKey !== shard.key) return 'outside_scope';
    const now = this.now();
    const inserted = this.store.record({ sessionKey: shard.key, sequence: packet.s,
      guildId, channelId, userId, soundId, receivedAt: now,
      timing: shard.online ? 'live' : 'replay', coverageId: scope.id });
    if (shard.online) this.store.confirm(scope.id, now);
    return inserted ? 'recorded' : 'duplicate';
  }
}
