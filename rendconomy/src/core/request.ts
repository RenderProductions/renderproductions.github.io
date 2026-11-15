// The request being handled right now (a command, a button press, a typed answer). Game-event listeners
// run inside it, so they can reach the database and add lines to the reply ("Achievement unlocked")
// without every system passing a context around.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from './db';

export interface Request {
  db: Db;
  guildId: string | null;
  userId: string;
  now: number;
  /** Extra lines for the reply. */
  notes: string[];
  /** Work for after the request succeeds (DMs like receipts). Dropped if it fails. */
  after?: (() => void)[];
}

const store = new AsyncLocalStorage<Request>();

/** Runs fn as this request; once it succeeds, runs anything it queued with afterRequest. */
export function runInRequest<T>(req: Request, fn: () => T): T {
  const out = store.run(req, fn);
  const flush = () => { for (const f of req.after?.splice(0) ?? []) { try { f(); } catch (e) { console.error('[after]', e); } } };
  if (out instanceof Promise) return out.then((v) => { flush(); return v; }) as T;
  flush();
  return out;
}

/** Does fn once the current request succeeds, or right away outside a request. */
export function afterRequest(fn: () => void): void {
  const req = store.getStore();
  if (req) (req.after ??= []).push(fn); else fn();
}
export const currentRequest = (): Request | undefined => store.getStore();
