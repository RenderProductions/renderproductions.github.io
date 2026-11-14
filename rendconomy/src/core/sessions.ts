// Sessions: anything waiting for a player's answer (a work task, later a blackjack hand...).
// They live in the database, so a restart never breaks a button. Each kind has one handler
// (registered in src/discord/sessions.ts) that owns the JSON state.
import { randomBytes } from 'node:crypto';
import type { Db } from './db';

export interface Session<S = unknown> {
  id: string;
  kind: string;
  guild_id: string | null;
  channel_id: string | null;
  user_id: string;
  message_id: string | null;
  state: S;
  created_at: number;
  expires_at: number;
}

interface Row { id: string; kind: string; guild_id: string | null; channel_id: string | null; user_id: string; message_id: string | null; state: string; created_at: number; expires_at: number }
const parse = <S>(r: Row | undefined): Session<S> | null => (r ? { ...r, state: JSON.parse(r.state) as S } : null);

export interface NewSession<S> { kind: string; guildId: string | null; channelId: string | null; userId: string; state: S; ttlMs: number; now?: number }

/** Starts a session, replacing any session of the same kind this player already had. */
export function create<S>(db: Db, s: NewSession<S>): Session<S> {
  const now = s.now ?? Date.now();
  const id = randomBytes(6).toString('base64url');
  db.tx(() => {
    db.run('DELETE FROM sessions WHERE user_id = ? AND kind = ? AND COALESCE(guild_id, \'\') = COALESCE(?, \'\')', s.userId, s.kind, s.guildId);
    db.run('INSERT INTO sessions (id, kind, guild_id, channel_id, user_id, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, s.kind, s.guildId, s.channelId, s.userId, JSON.stringify(s.state), now, now + s.ttlMs);
  });
  return get<S>(db, id, now)!;
}

/** A live session by id (null if it ended or expired). */
export function get<S>(db: Db, id: string, now = Date.now()): Session<S> | null {
  return parse<S>(db.get<Row>('SELECT * FROM sessions WHERE id = ? AND expires_at > ?', id, now));
}

/** This player's live session of a kind in a server. */
export function active<S>(db: Db, kind: string, guildId: string | null, userId: string, now = Date.now()): Session<S> | null {
  return parse<S>(db.get<Row>(
    "SELECT * FROM sessions WHERE kind = ? AND COALESCE(guild_id, '') = COALESCE(?, '') AND user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    kind, guildId, userId, now
  ));
}

/** Live sessions waiting in a channel for this player's typed answer. */
export function inChannel(db: Db, channelId: string, userId: string, now = Date.now()): Session[] {
  return db.all<Row>('SELECT * FROM sessions WHERE channel_id = ? AND user_id = ? AND expires_at > ? ORDER BY created_at DESC', channelId, userId, now)
    .map((r) => parse(r)!);
}

export function save<S>(db: Db, id: string, state: S, ttlMs?: number, now = Date.now()): void {
  if (ttlMs === undefined) db.run('UPDATE sessions SET state = ? WHERE id = ?', JSON.stringify(state), id);
  else db.run('UPDATE sessions SET state = ?, expires_at = ? WHERE id = ?', JSON.stringify(state), now + ttlMs, id);
}

export function attachMessage(db: Db, id: string, messageId: string, channelId: string): void {
  db.run('UPDATE sessions SET message_id = ?, channel_id = COALESCE(channel_id, ?) WHERE id = ?', messageId, channelId, id);
}

/**
 * Ends a session. Returns true only for the call that actually ended it, so if a button press and a
 * typed answer arrive together, exactly one of them is graded.
 */
export function end(db: Db, id: string): boolean {
  return db.run('DELETE FROM sessions WHERE id = ?', id).changes === 1;
}

export function prune(db: Db, now = Date.now()): number {
  return db.run('DELETE FROM sessions WHERE expires_at <= ?', now).changes;
}

/** Button ids: "s:<session>:<value>". Values are short (Discord allows 100 characters in total). */
export const buttonId = (sessionId: string, value: string): string => `s:${sessionId}:${value}`.slice(0, 100);
export function parseButtonId(customId: string): { sessionId: string; value: string } | null {
  const m = /^s:([A-Za-z0-9_-]+):(.*)$/.exec(customId);
  return m ? { sessionId: m[1]!, value: m[2]! } : null;
}
