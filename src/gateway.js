import { Events } from 'discord.js';

// Raw is the sole accounting path. The SDK's high-level effect event omits s.
export function wireGateway(client, tracker, voice, store, { fatal = error => { throw error; } } = {}) {
  client.on(Events.Raw, (packet, shardId) => {
    try {
      if (packet.t === 'READY') tracker.ready(shardId, packet.d.session_id, packet.d.user.id);
      else if (packet.t === 'RESUMED') {
        voice.syncAll();
        tracker.resume(shardId);
      } else tracker.ingest(packet, shardId);
    } catch (error) { fatal(error); }
  });
  client.on(Events.ShardDisconnect, (_event, shardId) => tracker.disconnect(shardId));
  client.on(Events.ShardReconnecting, shardId => tracker.disconnect(shardId, 'gateway_reconnecting'));
  client.on(Events.ShardReady, () => voice.syncAll());
  client.on(Events.VoiceStateUpdate, (oldState, newState) => voice.voiceState(oldState, newState));
  client.on(Events.GuildUnavailable, guild => tracker.voice(guild.id, null, guild.shardId, false));
  client.on(Events.GuildAvailable, () => voice.syncAll());
  client.on(Events.GuildDelete, guild => voice.forget(guild.id));
  const saveName = sound => {
    if (sound.soundId != null && sound.name) store.upsertSound(String(sound.soundId), sound.name);
  };
  client.on(Events.GuildSoundboardSoundCreate, saveName);
  client.on(Events.GuildSoundboardSoundUpdate, (_oldSound, sound) => saveName(sound));
  client.on(Events.GuildSoundboardSoundsUpdate, sounds => { for (const sound of sounds.values()) saveName(sound); });
}
