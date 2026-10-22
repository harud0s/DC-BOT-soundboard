import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function acquireLock(path) {
  mkdirSync(dirname(path), { recursive: true });
  // A separate SQLite file holds an OS-backed exclusive lock. The OS releases
  // it on a crash; no PID reuse or stale-file deletion race is involved.
  const lock = new DatabaseSync(path);
  try {
    lock.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;');
  } catch {
    lock.close();
    throw new Error('此資料庫已有執行中的 Bot，或執行鎖無法開啟；拒絕啟動第二份。');
  }
  return () => { lock.exec('ROLLBACK'); lock.close(); };
}
