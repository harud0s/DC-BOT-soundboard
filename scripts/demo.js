import { Store } from '../src/store.js';
import { Tracker } from '../src/tracker.js';
import { report } from '../src/commands.js';

const store = new Store();
let now = Date.now();
const tracker = new Tracker(store, { now: () => now });
tracker.ready(0, 'offline-demo', '999'); tracker.voice('1', '2', 0, true);
store.upsertSound('50', '範例音效');
const event = s => ({ op: 0, t: 'VOICE_CHANNEL_EFFECT_SEND', s,
  d: { guild_id: '1', channel_id: '2', user_id: '3', sound_id: '50' } });
now += 1000; tracker.ingest(event(1), 0); tracker.ingest(event(1), 0); tracker.ingest(event(2), 0);
tracker.disconnect(0); now += 30_000; tracker.ingest(event(3), 0); tracker.resume(0);
now += 1000; tracker.checkpoint();
console.log('離線示範：2 次即時點擊 + 1 次補送；重複封包不加算。資料只存在記憶體。\n');
console.log(report(store, { guildId: '1', channelIds: ['2'], until: now }, 'sounds'));
tracker.stop(); store.close();
