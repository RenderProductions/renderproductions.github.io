// The bot's status reacts to what's going on: big moments first (a huge win, a jackpot, a heist, a new
// millionaire), then whatever's happening right now (the world event, a crash or a boom, the day's biggest
// mover, a fat lottery pot, a Mansion party, December), then a line about the bot itself.
// It changes every 90 seconds, sooner for a fresh big moment, but never more than once every 20 seconds.
// The console's "status <text>" still overrides all of it.
import { partyOf } from '../birthday/birthday';
import { ActivityType, type Client } from 'discord.js';
import { economy } from '../config';
import type { Db } from '../core/db';
import { RESERVE, balance } from '../core/ledger';
import { compact, onMoment, takeMoment } from '../core/moments';
import { activeEvent, EVENTS } from '../events/world';
import { holidayDay, HOLIDAY } from '../holidays/holidays';
import { load as loadMarket } from '../market/market';
import { nightKey } from '../underground/underground';

/** Turns event text like "Shifts pay **1.5x**." into plain status text. */
const plain = (s: string): string => s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const fit = (s: string): string => (s.length <= 128 ? s : s.slice(0, 127).replace(/\s+\S*$/, '') + '…');

/** What's happening right now, best first. */
export function happenings(db: Db, now: number, servers: number): string[] {
  const out: string[] = [];
  const bday = partyOf(now);
  if (bday) out.push(bday.bash ? '🎉 Birthday Bash! Chat pay x1.5 and a bonus on dailies' : bday.kind === 'bot' ? `🎂 RendConomy is ${bday.age}! Happy Birthday Week · r!birthday` : `🎈 Render Vision's Big Birthday! · r!birthday`);
  const e = activeEvent(db, now);
  if (e?.id && EVENTS[e.id]) {
    const ev = EVENTS[e.id]!;
    out.push(fit(`${ev.emoji} ${ev.name}: ${plain(ev.desc(e.ticker))}`));
  }
  const m = loadMarket(db);
  const crash = m?.crash as { phase?: string } | null | undefined;
  if (crash?.phase === 'crash') out.push('📉 The market is crashing. Hold on to something');
  else if (crash?.phase) out.push('🩹 The market is crawling back from the crash');
  else if (m?.boost) out.push('🚀 The market is booming');
  const changes = (m?.changes ?? {}) as Record<string, number>;
  const mover = Object.entries(changes).filter(([, c]) => Number.isFinite(c)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  if (mover && Math.abs(mover[1]) >= 3) out.push(`${mover[1] > 0 ? '📈' : '📉'} ${mover[0]} is ${mover[1] > 0 ? 'up' : 'down'} ${Math.abs(mover[1]).toFixed(1)}% today`);
  else if (m?.market?.status && m.market.status !== 'open') out.push('🌙 The market is closed. Get some sleep');
  const pot = db.get<{ c: number }>("SELECT MAX(balance) AS c FROM accounts WHERE id LIKE 'lottery:%'")?.c ?? 0;
  if (pot >= 100_000) out.push(`🎟️ A lottery pot is up to ${compact(pot)}. Drawn Sunday`);
  const party = db.get<{ v: string }>("SELECT MAX(CAST(value AS INTEGER)) AS v FROM meta WHERE key LIKE 'estate.party:%'")?.v;
  if (party && Number(party) > now) out.push('🎉 There\'s a party at a Mansion. Chat pay is doubled there');
  if (nightKey(now)) out.push('👁️ Mr. Glaz is open for business. Somewhere condemned');
  const day = holidayDay(now);
  if (day >= 1 && day <= HOLIDAY.doors) out.push(`🎄 Advent door ${day} is open. /advent`);
  const reserve = balance(db, RESERVE);
  if (reserve < economy.reserveStart * 0.25) out.push('🏦 The Reserve is running low. Payouts are shrinking');
  else out.push(`🏦 The Reserve holds ${compact(reserve)}`);
  out.push(`👀 Watching ${servers} ${servers === 1 ? 'server' : 'servers'} · r!help`);
  return out;
}

let turn = 0;
/** The next status: a fresh big moment if there is one, otherwise the next thing that's happening. */
export function nextStatus(db: Db, now: number, servers: number): string {
  const custom = db.meta('status.custom');
  if (custom) return custom;
  const m = takeMoment(now);
  if (m) return m.text;
  const list = happenings(db, now, servers);
  return list[turn++ % list.length] ?? '📈 Watching the market';
}

export function startStatus(db: Db, client: Client): void {
  let last = 0, waiting: NodeJS.Timeout | null = null;
  const set = () => {
    waiting = null;
    last = Date.now();
    try {
      const text = nextStatus(db, last, client.guilds.cache.size);
      client.user?.setPresence({ activities: [{ name: 'Custom', state: fit(text), type: ActivityType.Custom }], status: 'online' });
    } catch (e) { console.error('[status]', e); }
  };
  // A big moment jumps the queue, as soon as the last change is 20 seconds old
  onMoment(() => {
    if (waiting) return;
    waiting = setTimeout(set, Math.max(0, 20_000 - (Date.now() - last)));
    waiting.unref();
  });
  set();
  setInterval(() => { if (!waiting) set(); }, 90_000).unref();
}
