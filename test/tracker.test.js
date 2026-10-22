import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Tracker, normalizeId } from '../src/tracker.js';

const packet = (s = 1, data = {}) => ({ op: 0, t: 'VOICE_CHANNEL_EFFECT_SEND', s,
  d: { guild_id: '1', channel_id: '2', user_id: '3', sound_id: '100000000000000001', ...data } });
const filter = { guildId: '1', channelIds: ['2'], since: 0, until: 100_000 };
function fixture(t) {
  const store = new Store(); t.after(() => store.close());
  let now = 1000;
  const tracker = new Tracker(store, { now: () => now });
  tracker.ready(0, 'session-a', '999'); tracker.voice('1', '2', 0, true);
  return { store, tracker, time: n => { now = n; } };
}

test('only soundboard payloads count; numeric default sound ID 0 is valid', t => {
  const { store, tracker } = fixture(t);
  assert.equal(tracker.ingest({ ...packet(), t: 'OTHER' }, 0), 'ignored_event');
  assert.equal(tracker.ingest(packet(1, { sound_id: undefined }), 0), 'not_soundboard');
  assert.equal(tracker.ingest(packet(2, { sound_id: null }), 0), 'not_soundboard');
  assert.equal(tracker.ingest(packet(3, { sound_id: 0 }), 0), 'recorded');
  assert.equal(store.stats(filter).soundRows[0].sound_id, '0');
  assert.equal(store.stats(filter).total, 1);
});

test('malformed, rounded or absent IDs and missing sequence fail closed', t => {
  const { tracker } = fixture(t);
  for (const value of ['', false, {}, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '01', '1e20', '18446744073709551616']) {
    assert.equal(normalizeId(value), null);
    assert.equal(tracker.ingest(packet(1, { sound_id: value }), 0), 'invalid_payload');
  }
  assert.equal(tracker.ingest({ ...packet(), s: null }, 0), 'invalid_payload');
  assert.equal(tracker.ingest(packet(1, { user_id: null }), 0), 'invalid_payload');
});

test('replayed sequence is deduplicated without suppressing repeated clicks', t => {
  const { tracker, store } = fixture(t);
  assert.equal(tracker.ingest(packet(1), 0), 'recorded');
  assert.equal(tracker.ingest(packet(1), 0), 'duplicate');
  assert.equal(tracker.ingest(packet(2), 0), 'recorded');
  tracker.ready(0, 'new-session', '999');
  assert.equal(tracker.ingest(packet(1), 0), 'outside_scope');
  tracker.voice('1', '2', 0, true);
  assert.equal(tracker.ingest(packet(1), 0), 'recorded');
  assert.equal(store.stats(filter).total, 3);
});

test('same-name and renamed sounds remain grouped by ID', t => {
  const { tracker, store } = fixture(t);
  store.upsertSound('10', 'same', 1000); store.upsertSound('11', 'same', 1000);
  tracker.ingest(packet(1, { sound_id: '10' }), 0); tracker.ingest(packet(2, { sound_id: '11' }), 0);
  store.upsertSound('10', 'renamed', 2000); tracker.ingest(packet(3, { sound_id: '10' }), 0);
  assert.deepEqual(store.stats(filter).soundRows.map(r => [r.sound_id, r.name, r.count]), [['10', 'renamed', 2], ['11', 'same', 1]]);
});

test('unmonitored channels and unready connections do not count', t => {
  const { tracker, store } = fixture(t);
  assert.equal(tracker.ingest(packet(1, { channel_id: '9' }), 0), 'outside_scope');
  tracker.voice('1', '2', 0, false);
  assert.equal(tracker.ingest(packet(2), 0), 'outside_scope');
  assert.equal(tracker.ingest(packet(3), 99), 'unknown_session');
  assert.equal(store.stats(filter).total, 0);
});

test('disconnect creates a coverage gap; replay before RESUMED is marked', t => {
  const { tracker, store, time } = fixture(t);
  time(2000); tracker.ingest(packet(1), 0); tracker.disconnect(0);
  time(9000);
  assert.equal(tracker.ingest(packet(1), 0), 'duplicate');
  assert.equal(tracker.ingest(packet(2), 0), 'recorded');
  assert.equal(store.stats(filter).replay, 1);
  assert.equal(store.coverage(filter)[0].milliseconds, 1000);
  tracker.resume(0); time(10_000); tracker.ingest(packet(3), 0); tracker.checkpoint();
  assert.equal(store.coverage(filter)[0].milliseconds, 2000);
  assert.equal(store.coverage(filter)[0].intervals, 2);
  assert.equal(store.stats(filter).total, 3);
});

test('channel moves, guilds, users and receive-time windows are isolated', t => {
  const { tracker, store, time } = fixture(t);
  tracker.ingest(packet(), 0); time(2000); tracker.voice('1', '4', 0, true);
  assert.equal(tracker.ingest(packet(2), 0), 'outside_scope');
  tracker.ingest(packet(3, { channel_id: '4', user_id: '5' }), 0);
  tracker.voice('6', '7', 0, true); tracker.ingest(packet(4, { guild_id: '6', channel_id: '7' }), 0);
  assert.equal(store.stats(filter).total, 1);
  assert.equal(store.stats({ ...filter, channelIds: ['2', '4'] }).total, 2);
  assert.equal(store.stats({ ...filter, channelIds: [] }).total, 0);
  assert.equal(store.stats({ ...filter, channelIds: ['2', '4'] }, { userId: '5' }).total, 1);
  assert.equal(store.stats({ ...filter, since: 2000 }).total, 0);
});

test('disk persistence, targets, dedupe and conservative crash recovery', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dcbot-test-'));
  const path = join(dir, 'test.sqlite');
  let store = new Store(path); let now = 1000;
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const tracker = new Tracker(store, { now: () => now });
  tracker.ready(0, 'session-a', '999'); tracker.voice('1', '2', 0, true); store.setTarget('1', '2');
  now = 2000; tracker.ingest(packet(), 0); store.close();
  store = new Store(path); store.recover();
  assert.equal(store.stats(filter).total, 1);
  assert.equal(store.targets()[0].channel_id, '2');
  assert.equal(store.recentCoverage(filter)[0].ended_at_ms, 2000);
  assert.equal(store.recentCoverage(filter)[0].end_reason, 'process_restart_uncertain_tail');
  const restarted = new Tracker(store, { now: () => 50_000 });
  restarted.ready(0, 'session-a', '999'); restarted.voice('1', '2', 0, true);
  assert.equal(restarted.ingest(packet(), 0), 'duplicate');
  assert.equal(store.coverage(filter)[0].milliseconds, 1000);
});

test('database write failures are surfaced and do not increment totals', t => {
  const { tracker, store } = fixture(t);
  store.db.exec("CREATE TRIGGER fail_write BEFORE INSERT ON plays BEGIN SELECT RAISE(ABORT, 'disk simulation'); END");
  assert.throws(() => tracker.ingest(packet(), 0), /disk simulation/);
  assert.equal(store.stats(filter).total, 0);
});
