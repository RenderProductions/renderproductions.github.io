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
}

const store = new AsyncLocalStorage<Request>();

export const runInRequest = <T>(req: Request, fn: () => T): T => store.run(req, fn);
export const currentRequest = (): Request | undefined => store.getStore();
