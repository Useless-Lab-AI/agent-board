import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Vector } from '../shared/types.js';
export interface Metadata {
  id: string;
  ordinal: number;
  baseline: Vector;
  read: Vector | null;
  archived: Vector | null;
  observed: Vector;
  progress: Vector;
  discovered: number;
}
export interface FileMetadata {
  key: string;
  identity: string;
  generation: string;
  size: number;
  anchor: string;
}
export class SessionStore {
  private db: DatabaseSync;
  readonly secret: string;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'board.sqlite'));
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, baseline TEXT NOT NULL, read_cursor TEXT, archive_cursor TEXT, observed TEXT NOT NULL, discovered INTEGER NOT NULL);',
    );
    if (
      !(this.db.prepare('PRAGMA table_info(metadata)').all() as { name: string }[]).some(
        (c) => c.name === 'progress',
      )
    )
      this.db.exec("ALTER TABLE metadata ADD COLUMN progress TEXT NOT NULL DEFAULT '{}'");
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS source_metadata (key TEXT PRIMARY KEY, identity TEXT NOT NULL, generation TEXT NOT NULL, size INTEGER NOT NULL, anchor TEXT NOT NULL)',
    );
    const existing = this.db
      .prepare('SELECT value FROM settings WHERE key=?')
      .get('cursor-secret') as { value: string } | undefined;
    this.secret = existing?.value ?? randomBytes(32).toString('hex');
    if (!existing)
      this.db.prepare('INSERT INTO settings VALUES (?,?)').run('cursor-secret', this.secret);
  }
  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }
  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
  get(id: string): Metadata | undefined {
    const row = this.db.prepare('SELECT * FROM metadata WHERE id=?').get(id) as
      | Record<string, string | number | null>
      | undefined;
    if (!row) return;
    return {
      id,
      ordinal: Number(row.ordinal),
      baseline: JSON.parse(String(row.baseline)),
      read: row.read_cursor ? JSON.parse(String(row.read_cursor)) : null,
      archived: row.archive_cursor ? JSON.parse(String(row.archive_cursor)) : null,
      observed: JSON.parse(String(row.observed)),
      progress: JSON.parse(String(row.progress)),
      discovered: Number(row.discovered),
    };
  }
  ensure(id: string, baseline: Vector): Metadata {
    const found = this.get(id);
    if (found) return found;
    const { n } = this.db
      .prepare('SELECT COALESCE(MAX(ordinal),-1)+1 AS n FROM metadata')
      .get() as { n: number };
    this.db
      .prepare(
        'INSERT INTO metadata (id,ordinal,baseline,read_cursor,archive_cursor,observed,discovered) VALUES (?,?,?,?,?,?,?)',
      )
      .run(id, n, JSON.stringify(baseline), null, null, JSON.stringify(baseline), Date.now());
    return this.get(id)!;
  }
  save(meta: Metadata) {
    this.db
      .prepare(
        'UPDATE metadata SET read_cursor=?,archive_cursor=?,observed=?,progress=? WHERE id=?',
      )
      .run(
        meta.read ? JSON.stringify(meta.read) : null,
        meta.archived ? JSON.stringify(meta.archived) : null,
        JSON.stringify(meta.observed),
        JSON.stringify(meta.progress),
        meta.id,
      );
  }
  close() {
    this.db.close();
  }
  file(key: string) {
    return this.db.prepare('SELECT * FROM source_metadata WHERE key=?').get(key) as
      | FileMetadata
      | undefined;
  }
  saveFile(file: FileMetadata) {
    this.db
      .prepare(
        'INSERT INTO source_metadata VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET identity=excluded.identity,generation=excluded.generation,size=excluded.size,anchor=excluded.anchor',
      )
      .run(file.key, file.identity, file.generation, file.size, file.anchor);
  }
}
export function advanced(current: Vector, previous: Vector) {
  return Object.entries(current).some(
    ([key, p]) =>
      p.offset > 0 &&
      (!previous[key] ||
        previous[key].generation !== p.generation ||
        p.offset > previous[key].offset),
  );
}
export function mergePosition(previous: Vector, current: Vector): Vector {
  const merged = { ...previous };
  for (const [key, p] of Object.entries(current))
    if (!merged[key] || merged[key].generation !== p.generation || p.offset > merged[key].offset)
      merged[key] = p;
  return merged;
}
