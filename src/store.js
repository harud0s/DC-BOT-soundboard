import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (this.db.prepare('PRAGMA user_version').get().user_version > 1) {
      this.db.close();
      throw new Error('資料庫版本比此程式新；停止啟動以保護資料。');
    }
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coverage (
        id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
        session_key TEXT NOT NULL, started_at_ms INTEGER NOT NULL,
        confirmed_at_ms INTEGER NOT NULL, ended_at_ms INTEGER, end_reason TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS coverage_one_active ON coverage(guild_id) WHERE ended_at_ms IS NULL;
      CREATE INDEX IF NOT EXISTS coverage_scope ON coverage(guild_id, channel_id, started_at_ms);
      CREATE TABLE IF NOT EXISTS sounds (
        sound_id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plays (
        id INTEGER PRIMARY KEY, session_key TEXT NOT NULL, sequence INTEGER NOT NULL,
        guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
        sound_id TEXT NOT NULL, received_at_ms INTEGER NOT NULL,
        timing TEXT NOT NULL CHECK(timing IN ('live','replay')),
        coverage_id INTEGER REFERENCES coverage(id),
        UNIQUE(session_key, sequence)
      );
      CREATE INDEX IF NOT EXISTS plays_scope ON plays(guild_id, channel_id, received_at_ms);
      CREATE INDEX IF NOT EXISTS plays_user ON plays(guild_id, user_id, received_at_ms);
      PRAGMA user_version = 1;
    `);
  }

  recover() {
    // Never extend a crashed process's coverage across the time it was offline.
    this.db.exec("UPDATE coverage SET ended_at_ms = confirmed_at_ms, end_reason = 'process_restart_uncertain_tail' WHERE ended_at_ms IS NULL");
  }
  setTarget(guildId, channelId) {
    if (channelId === null) this.db.prepare('DELETE FROM settings WHERE guild_id = ?').run(guildId);
    else this.db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id').run(guildId, channelId);
  }
  targets() { return this.db.prepare('SELECT * FROM settings').all(); }
  openCoverage(guildId, channelId, sessionKey, now) {
    return Number(this.db.prepare(`INSERT INTO coverage
      (guild_id,channel_id,session_key,started_at_ms,confirmed_at_ms) VALUES (?,?,?,?,?)`)
      .run(guildId, channelId, sessionKey, now, now).lastInsertRowid);
  }
  confirm(id, now) { this.db.prepare('UPDATE coverage SET confirmed_at_ms = MAX(confirmed_at_ms, ?) WHERE id = ? AND ended_at_ms IS NULL').run(now, id); }
  closeCoverage(id, now, reason) {
    this.db.prepare('UPDATE coverage SET ended_at_ms = MAX(started_at_ms, ?), end_reason = ? WHERE id = ? AND ended_at_ms IS NULL').run(now, reason, id);
  }
  upsertSound(id, name, now = Date.now()) {
    this.db.prepare('INSERT INTO sounds VALUES (?,?,?) ON CONFLICT(sound_id) DO UPDATE SET name = excluded.name, updated_at_ms = excluded.updated_at_ms').run(id, name, now);
  }
  record(event) {
    return this.db.prepare(`INSERT INTO plays
      (session_key,sequence,guild_id,channel_id,user_id,sound_id,received_at_ms,timing,coverage_id)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(session_key,sequence) DO NOTHING`)
      .run(event.sessionKey, event.sequence, event.guildId, event.channelId, event.userId,
        event.soundId, event.receivedAt, event.timing, event.coverageId ?? null).changes === 1;
  }
  scope({ guildId, channelIds, since = 0, until = Date.now() }) {
    return { sql: `p.guild_id = ? AND p.channel_id IN (${channelIds.map(() => '?').join(',') || 'NULL'})
      AND p.received_at_ms >= ? AND p.received_at_ms <= ?`, args: [guildId, ...channelIds, since, until] };
  }
  stats(filter, { userId = null } = {}) {
    const { sql, args } = this.scope(filter);
    const where = sql + (userId ? ' AND p.user_id = ?' : '');
    if (userId) args.push(userId);
    const summary = this.db.prepare(`SELECT COUNT(*) AS total, COUNT(DISTINCT p.user_id) AS users,
      COUNT(DISTINCT p.sound_id) AS sounds, COALESCE(SUM(p.timing = 'replay'),0) AS replay
      FROM plays p WHERE ${where}`).get(...args);
    const sounds = this.db.prepare(`SELECT p.sound_id, s.name, COUNT(*) AS count
      FROM plays p LEFT JOIN sounds s ON s.sound_id = p.sound_id WHERE ${where}
      GROUP BY p.sound_id ORDER BY count DESC, p.sound_id LIMIT 10`).all(...args);
    const users = this.db.prepare(`SELECT p.user_id, COUNT(*) AS count, COUNT(DISTINCT p.sound_id) AS sounds
      FROM plays p WHERE ${where} GROUP BY p.user_id ORDER BY count DESC, p.user_id LIMIT 10`).all(...args);
    return { ...summary, soundRows: sounds, userRows: users };
  }
  coverage(filter) {
    const { guildId, channelIds, since = 0, until = Date.now() } = filter;
    return this.db.prepare(`SELECT channel_id, COUNT(*) AS intervals,
      SUM(MAX(0, MIN(COALESCE(ended_at_ms, confirmed_at_ms), ?) - MAX(started_at_ms, ?))) AS milliseconds,
      SUM(ended_at_ms IS NULL) AS active
      FROM coverage WHERE guild_id = ? AND channel_id IN (${channelIds.map(() => '?').join(',') || 'NULL'})
      AND started_at_ms <= ? AND COALESCE(ended_at_ms, confirmed_at_ms) >= ?
      GROUP BY channel_id ORDER BY channel_id`).all(until, since, guildId, ...channelIds, until, since);
  }
  recentCoverage(filter) {
    const { guildId, channelIds, since = 0, until = Date.now() } = filter;
    return this.db.prepare(`SELECT * FROM coverage WHERE guild_id = ?
      AND channel_id IN (${channelIds.map(() => '?').join(',') || 'NULL'})
      AND started_at_ms <= ? AND COALESCE(ended_at_ms, confirmed_at_ms) >= ?
      ORDER BY started_at_ms DESC, id DESC LIMIT 5`).all(guildId, ...channelIds, until, since);
  }
  close() { this.db.close(); }
}
