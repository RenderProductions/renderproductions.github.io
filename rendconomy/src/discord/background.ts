// Things the bot does on its own while connected: shift reminder DMs, the Trading Floor relay, the
// little web API for the site, and a status that reacts to the market.
import { consoleFromDm } from './console';
import { chessFinish, chessStatus } from '../games/chess';
import { rftAchieve, rftCashout, rftStatus } from '../games/rft';
import { wikiSnapshot } from '../site/wikivote';
import { me } from '../commands/shared';
import { change, listCompanies, treasury } from '../companies/companies';
import { profilesSnapshot, type Directory } from '../site/publish';
import { emoji, emojiOr } from './emoji';
import http from 'node:http';
import type { Client } from 'discord.js';
import { ActivityType } from 'discord.js';
import { find } from '../commands';
import type { BotConfig } from '../config';
import type { Db } from '../core/db';
import type { Rng } from '../core/rng';
import { MINUTE } from '../core/time';
import { format } from '../core/money';
import { load as loadMarket } from '../market/market';
import { netWorth } from '../social/worth';
import { didYouMean, execute, parsePrefix, press } from './router';
import * as sessions from '../core/sessions';
import type { ReplyObject } from '../commands/types';
import { CROPS, FARMING, plotsOf, simulate, weatherLog } from '../farming/farming';
import { count } from '../shop/inventory';
import { RESERVE, balance } from '../core/ledger';
import { activeEvent, EVENTS } from '../events/world';
import { addInbox } from '../social/inbox';
import { holidayTick, isHoliday, season } from '../holidays/holidays';
import { anyItem } from '../shop/items';
import { settleServer } from '../commands/property';
import { roleStats } from '../site/roles';
import { KINDS, SIZE, lotAt, lotsOf, tileName, trainsOf } from '../estate/estate';
import { current as currentLandmark, finished as finishedLandmarks } from '../estate/landmarks';
import { nextOpen, nightCloses, tonight } from '../underground/underground';
import { cryptoRng } from '../core/rng';
import { handSettings, runShift } from '../farming/farmhand';
import { collectTerms } from '../loans/collect';
import { countElections } from '../city/city';
import { settleTourneys } from '../fishing/docks';
import { weekOf } from '../city/state';
import { restock } from '../shop/shop';
import { wishNotices } from '../shop/street';
import { sweepStores } from '../shop/stores';
import { itemName } from '../commands/connections';

/** Main Street: the delivery truck comes to every server on time (even when nobody's shopping), wishlists hear
 *  about restocks (Good Friends first), and stores whose Corner Shop is gone hand their stock back. */
export function startStreet(db: Db, client: Client, prefix: string, rng: Rng): void {
  const tick = () => {
    const now = Date.now();
    for (const { guild_id: g } of db.all<{ guild_id: string }>('SELECT DISTINCT guild_id FROM players')) {
      try {
        restock(db, rng, g, now);
        db.tx(() => sweepStores(db, g, now, itemName));
        const notes = db.tx(() => wishNotices(db, g, now));
        const server = client.guilds.cache.get(g)?.name;
        for (const n of notes) {
          const what = n.items.map((id) => `${emojiOr(id, anyItem(id)?.emoji ?? '📦')} **${anyItem(id)?.name ?? id}**`).join(', ');
          addInbox(db, n.userId, g, 'Wishlist restocked', `Marquez's delivery brought ${n.items.map((id) => anyItem(id)?.name ?? id).join(', ')}.`, now);
          client.users.fetch(n.userId).then((u) => u.send({ content: `${emojiOr('truck', '🚚')} Marquez's delivery truck just pulled up${server ? ` in **${server}**` : ''} with something off your wishlist: ${what}. \`${prefix}shop\`\n-# Take an item off with \`${prefix}shop want <item>\`.`, allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
        }
      } catch (e) { console.error('[street]', e); }
    }
  };
  setInterval(tick, MINUTE).unref();
  setTimeout(tick, 20_000).unref();
}

/** DMs players whose next shift is ready (for those with /job remind on). Restart-safe: kept in the database. */
export function startReminders(db: Db, client: Client, prefix: string): void {
  setInterval(() => {
    const now = Date.now();
    for (const r of db.all<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key LIKE 'remind:%' AND value != '0'")) {
      if (Number(r.value) > now) continue;
      db.setMeta(r.key, 0);
      const [, guildId, userId] = r.key.split(':') as [string, string, string];
      const job = db.get<{ job: string | null }>('SELECT job FROM players WHERE guild_id = ? AND user_id = ?', guildId, userId)?.job;
      if (!job) continue;   // they quit since
      const server = client.guilds.cache.get(guildId)?.name;
      const text = `${emoji('work')} Your next shift at **${job}** is ready${server ? ` in **${server}**` : ''}. Clock in with \`${prefix}work\`.\n-# Turn these off with \`${prefix}job remind off\`.`;
      client.users.fetch(userId).then((u) => u.send({ content: text, allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
    }
    // Under New Management: count elections that just closed (results go to the candidates' inboxes)
    for (const r of db.all<{ guild_id: string }>('SELECT DISTINCT guild_id FROM candidates WHERE week >= ?', weekOf(now - 8 * 86_400_000))) countElections(db, r.guild_id, now);
    // The Fishy Deep: pay out last Saturday's fishing tournaments (winners hear by inbox)
    settleTourneys(db, now);
    for (const n of loanNotices(db, now)) {
      addInbox(db, n.userId, n.guildId, n.title, n.text.replace(/`(payback|collect)/g, '`' + prefix + '$1'), now);
      const server = client.guilds.cache.get(n.guildId)?.name;
      client.users.fetch(n.userId).then((u) => u.send({ content: `${emoji('loan')} ${n.text.replace(/`(payback|collect)/g, '`' + prefix + '$1')}${server ? `\n-# ${server}` : ''}`, allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
    }
  }, MINUTE).unref();
}

/** Loans: tells a borrower when their loan goes overdue, and both sides when the lender can collect. Once each. */
export function loanNotices(db: Db, now: number): { guildId: string; userId: string; title: string; text: string }[] {
  const out: { guildId: string; userId: string; title: string; text: string }[] = [];
  for (const l of db.all<{ id: number; guild_id: string; lender_id: string; borrower_id: string; owed: number; due_at: number }>("SELECT id, guild_id, lender_id, borrower_id, owed, due_at FROM loans WHERE status = 'active' AND due_at <= ?", now)) {
    const step = Number(db.meta(`loan.notice:${l.id}`) ?? 0);
    const at = l.due_at + collectTerms(db, l.guild_id, now).graceMs;
    if (step < 1) {
      db.setMeta(`loan.notice:${l.id}`, 1);
      out.push({ guildId: l.guild_id, userId: l.borrower_id, title: 'Your loan is overdue', text: `Your loan from <@${l.lender_id}> is **overdue** (${format(l.owed)}). Half of what you earn now goes to it. Pay it with \`payback\` before <t:${Math.floor(at / 1000)}:F>, or they can collect from your wallet, savings, shares and items.` });
    } else if (step < 2 && now >= at) {
      db.setMeta(`loan.notice:${l.id}`, 2);
      out.push({ guildId: l.guild_id, userId: l.lender_id, title: 'You can collect', text: `<@${l.borrower_id}> still owes you ${format(l.owed)}, past the grace period. You can collect now: \`collect @them\`.` });
      out.push({ guildId: l.guild_id, userId: l.borrower_id, title: 'Your lender can collect', text: `<@${l.lender_id}> can now collect your overdue loan from what you own. Pay it with \`payback\` to keep your things.` });
    }
  }
  return out;
}

/** Polygon Holidays: Secret Santa draws, DMs and Christmas deliveries. Quiet outside December and early January. */
export function startHolidays(db: Db, client: Client, prefix: string): void {
  const tick = () => {
    const now = Date.now();
    if (!isHoliday(now) && !db.get('SELECT 1 FROM santa WHERE year = ? AND delivered = 0 AND target_id IS NOT NULL LIMIT 1', season(now))) return;
    holidayTick(db, now, cryptoRng(), (userId, guildId, text) => {
      const server = client.guilds.cache.get(guildId)?.name ?? 'your server';
      client.users.fetch(userId).then((u) => u.send({ content: text(server), allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
    }, (id) => anyItem(id)?.name ?? id, prefix);
  };
  setInterval(tick, 5 * MINUTE).unref();
  setTimeout(tick, 30_000).unref();
}

/** Room to Grow: settles every server with property every 15 minutes, so buyouts, auctions and condemnations
 *  finish on time even when nobody looks. Everything that happens goes to the players' inboxes. */
export function startEstates(db: Db, prefix: string): void {
  const tick = () => {
    const now = Date.now();
    for (const g of db.all<{ guild_id: string }>("SELECT DISTINCT guild_id FROM estates UNION SELECT DISTINCT guild_id FROM freight WHERE done = 0")) {
      try { settleServer(db, g.guild_id, now, prefix); } catch (e) { console.error('[estates]', e); }
    }
  };
  setInterval(tick, 15 * MINUTE).unref();
  setTimeout(tick, 60_000).unref();
}

/** DMs farmers (with /farm remind on) once a crop is ready. Looks ahead without saving, so nothing else changes. */
export function startFarmReminders(db: Db, client: Client, prefix: string): void {
  setInterval(() => {
    const now = Date.now(), weather = weatherLog(db);
    for (const f of db.all<{ guild_id: string; user_id: string }>('SELECT guild_id, user_id FROM farms WHERE remind = 1 AND (farmhand_until IS NULL OR farmhand_until <= ?)', now)) {
      const has = (item: string) => count(db, f.guild_id, f.user_id, item) > 0;
      const env = { hand: false, greenhouse: has('greenhouse'), scarecrow: has('scarecrow'), weather };
      const ready = plotsOf(db, f.guild_id, f.user_id).filter((p) => !p.reminded && !p.wilted).filter((p) => { const r = simulate(p, env, now); return !r.gone && r.plot.ready_at !== null; });
      if (!ready.length) continue;
      for (const p of ready) db.run('UPDATE farm_plots SET reminded = 1 WHERE guild_id = ? AND user_id = ? AND slot = ?', f.guild_id, f.user_id, p.slot);
      const what = ready.map((p) => `${emojiOr(p.crop, CROPS[p.crop]!.emoji)} ${CROPS[p.crop]!.name}`).join(', ');
      addInbox(db, f.user_id, f.guild_id, 'Crops ready', `${ready.map((p) => CROPS[p.crop]!.name).join(', ')} ready to harvest.`);
      const server = client.guilds.cache.get(f.guild_id)?.name;
      const text = `${emoji('harvest')} Ready to harvest${server ? ` in **${server}**` : ''}: ${what}. Pick ${ready.length === 1 ? 'it' : 'them'} with \`${prefix}harvest\`.\n-# Turn these off with \`${prefix}farm remind off\`.`;
      client.users.fetch(f.user_id).then((u) => u.send({ content: text, allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
    }
  }, MINUTE).unref();
}

/** The Farm Handiness Update: every farmhand works his shift every 10 minutes, even when nobody looks, and
 *  DMs (if they're on) when he runs out of seeds or quits. */
export function startFarmhands(db: Db, client: Client, prefix: string, rng: Rng): void {
  const tick = () => {
    const now = Date.now();
    for (const f of db.all<{ guild_id: string; user_id: string }>('SELECT guild_id, user_id FROM farms WHERE farmhand_until IS NOT NULL')) {
      try {
        const r = db.tx(() => runShift(db, f.guild_id, f.user_id, now, rng));
        const lines: string[] = [];
        const server = client.guilds.cache.get(f.guild_id)?.name;
        const where = server ? ` in **${server}**` : '';
        const H = emojiOr('farmhand', '🧑‍🌾');
        if (r.left) { lines.push(`${H} Your farmhand${where} quit: you couldn't pay his ${format(FARMING.farmhandWage)} wage. The seeds in his shed are back in your inventory.`); addInbox(db, f.user_id, f.guild_id, 'Farmhand quit', 'You couldn\'t pay his wage.', now); }
        if (r.newlyOut && !r.left) {
          const named = (r.log?.outOf ?? []).filter((c) => CROPS[c]).map((c) => CROPS[c]!.name);
          lines.push(`${H} Your farmhand${where} is out of seeds${named.length ? ` (${named.join(', ')})` : ''}. Some plots are sitting empty. Hand him more with \`${prefix}farmhand give carrot 10\`.`);
          addInbox(db, f.user_id, f.guild_id, 'Farmhand out of seeds', 'Some plots are sitting empty.', now);
        }
        if (!lines.length || !handSettings(db, f.guild_id, f.user_id).dm) continue;
        lines.push(`-# \`${prefix}farmhand dms off\` turns these off.`);
        client.users.fetch(f.user_id).then((u) => u.send({ content: lines.join('\n'), allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
      } catch (e) { console.error('[farmhand]', e); }
    }
  };
  setInterval(tick, 10 * MINUTE).unref();
  setTimeout(tick, 45_000).unref();
}

// ---------------------------------------------------------------- the Trading Floor (Discord Activity)

const ALLOWED = new Set(['underground', 'property', 'landmark', 'vip', 'use', 'inbox', 'showcase', 'trade', 'oddjob', 'farmhand', 'shop', 'purchase', 'sellitem', 'inventory', 'gift', 'loans', 'portfolio', 'rocket', 'blackjack', 'bus', 'hilo', 'mines', 'derby', 'heist', 'advent', 'santa', 'farm', 'plant', 'water', 'harvest', 'sellcrops', 'fertilize', 'compost', 'buyplot', 'balance', 'buy', 'sell', 'short', 'cover', 'dividends', 'daily', 'savings', 'event', 'leaderboard', 'reserve', 'order', 'gambling',
  'coinflip', 'dice', 'roulette', 'slots', 'fish', 'achievements', 'market', 'compare', 'profile', 'history']);
// ---------------------------------------------------------------- the Trading Floor's buttons and live updates
// The Activity can't receive message edits, so it asks: "__press <button id>" presses a button (at the moment
// the player clicked), and "__poll <key>" fetches the next frame of anything live (the Rocket's multiplier,
// the Derby race, a heist's countdown). Live updates are kept here in memory for 15 minutes.
type RelayButton = { label?: string; emoji?: string; id: string; style?: string; disabled?: boolean };
export interface Relay { content?: string; embeds?: { title?: string; description?: string; fields?: unknown; color?: number; footer?: string }[]; buttons?: RelayButton[][]; live?: string; everyMs?: number }
const relayLive = new Map<string, { next?: () => ReplyObject | null; everyMs: number; later?: { at: number; edit: ReplyObject }; session?: string; until: number }>();
let liveSeq = 0;

export function toRelay(out: ReplyObject, now: number): Relay {
  const r: Relay = {};
  if (out.content !== undefined) r.content = out.content;
  if (out.embeds !== undefined) r.embeds = out.embeds.map((e) => ({ title: e.title, description: e.description, fields: e.fields, color: e.color, footer: e.footer?.text }));
  if (out.buttons !== undefined) r.buttons = out.buttons.map((row) => row.map((x) => ({ label: x.label, emoji: x.emoji, id: x.id, style: x.style, disabled: x.disabled })));
  if (out.live || out.later) {
    const key = out.session ?? `live${++liveSeq}`;
    const old = relayLive.get(key);
    relayLive.set(key, {
      next: out.live?.next ?? old?.next, everyMs: Math.max(1500, out.live?.everyMs ?? old?.everyMs ?? 2500),
      later: out.later ? { at: now + out.later.ms, edit: out.later.edit } : old?.later, session: out.session, until: now + 15 * MINUTE
    });
    r.live = key; r.everyMs = relayLive.get(key)!.everyMs;
  }
  for (const [k, v] of relayLive) if (v.until < now) relayLive.delete(k);
  return r;
}

/** The next frame of something live, for the Activity. done: nothing more will come. */
export function pollRelay(db: Db, key: string, now: number): { update?: Relay; done: boolean } {
  const e = relayLive.get(key);
  if (!e) return { done: true };
  let out: ReplyObject | null = null;
  if (e.later && now >= e.later.at) {
    const later = e.later; e.later = undefined;
    if (!e.session || sessions.get(db, e.session, now)) out = later.edit;
  }
  if (!out && e.next) { try { out = e.next(); } catch (err) { console.error('[live]', err); out = null; } if (!out) e.next = undefined; }
  const done = !e.next && !e.later;
  if (done) relayLive.delete(key);
  return { update: out ? toRelay(out, now) : undefined, done };
}

/** The live feed: prices and the world event, pushed to the Worker every 30 seconds for the site and the Floor. */
export function liveSnapshot(db: Db, now = Date.now()): Record<string, unknown> {
  const m = loadMarket(db);
  const e = activeEvent(db, now);
  return {
    at: now,
    market: m ? { status: m.market.status, open: m.market.open, text: m.market.text } : null,
    prices: m?.prices ?? {}, changes: m?.changes ?? {}, statuses: m?.statuses ?? {},
    event: e ? { id: e.id, ticker: e.ticker ?? null, until: e.until, name: EVENTS[e.id!]?.name, emoji: EVENTS[e.id!]?.emoji, text: EVENTS[e.id!]?.desc(e.ticker) } : null,
    reserve: balance(db, RESERVE) / 100,
    // player companies: prices for public ones, treasuries for all (for /rend-conomy/exchange/co/)
    estates: estatesSnapshot(db),
    underground: undergroundSnapshot(db),
    wiki: wikiSnapshot(db, now),
    players: Object.fromEntries(listCompanies(db, ['public', 'private']).map((c) => [c.ticker, { price: c.status === 'public' ? c.price : null, change: c.status === 'public' ? Math.round(change(c) * 100) / 100 : null, treasury: treasury(db, c) / 100, status: c.status }]))
  };
}
/** The servers the site shows: every server with players (an empty map is still a map). */
const mapGuilds = (db: Db): string[] => db.all<{ guild_id: string }>('SELECT DISTINCT guild_id FROM players WHERE guild_id IS NOT NULL').map((r) => r.guild_id);
/** No Questions Asked: where Mr. Glaz is tonight in each server (for /backstage/underground/). Never the password. */
function undergroundSnapshot(db: Db): Record<string, { open: boolean; lot?: number; tile?: string; kind?: string; where?: string; passwordNight?: boolean; until?: number; opens?: number }> {
  const now = Date.now(), out: ReturnType<typeof undergroundSnapshot> = {};
  for (const g of mapGuilds(db)) {
    const n = tonight(db, g, now);
    if (!n) { out[g] = { open: false, opens: nextOpen(now) }; continue; }
    const l = n.lot ? lotAt(lotsOf(db, g), n.lot) : undefined;
    out[g] = { open: true, lot: n.lot, tile: n.lot ? tileName(n.lot) : 'the alley', kind: l ? KINDS[l.kind].name : n.where === 'alley' ? 'Alley' : 'Empty lot', where: n.where, passwordNight: !!n.password, until: nightCloses(n.night) };
  }
  return out;
}
/** Each server's city for the site (/rend-conomy/map/): the 8×8 grid, who built what, landmarks and trains. */
function estatesSnapshot(db: Db): Record<string, { size: number; tiles: Record<string, unknown>[]; landmarks: { built: string[]; current: { id: string; name: string; funded: number; cost: number } | null }; trains: number }> {
  const out: ReturnType<typeof estatesSnapshot> = {};
  const now = Date.now();
  for (const g of mapGuilds(db)) {
    const lots = lotsOf(db, g);
    const c = currentLandmark(db, g);
    out[g] = {
      size: SIZE,
      tiles: lots.map((l) => ({
        lot: l.lot, tile: tileName(l.lot), kind: l.kind, name: KINDS[l.kind].name, level: l.level, status: l.status, condition: Math.round(l.condition), squatters: !!l.squatters,
        building: l.build_until > now, ready: l.build_until,
        owner_id: l.owner_id, owner: l.owner_id ? db.get<{ name: string }>('SELECT name FROM players WHERE guild_id = ? AND user_id = ?', l.guild_id, l.owner_id)?.name ?? 'someone' : null,
        bid: l.bid_cents / 100, until: l.status === 'auction' ? l.auction_until : l.bid_until
      })),
      landmarks: { built: finishedLandmarks(db, g).map((l) => l.id), current: c ? { id: c.l.id, name: c.l.name, funded: c.funded / 100, cost: c.l.cost / 100 } : null },
      trains: trainsOf(db, g, now).length
    };
  }
  return out;
}
export function startLiveFeed(db: Db): void {
  const url = process.env.ACTIVITY_URL ?? '', secret = process.env.ACTIVITY_SECRET ?? '';
  if (!url || !secret) return;
  const push = () => fetch(`${url}/bot/live`, { method: 'POST', headers: { 'X-Bot-Secret': secret, 'Content-Type': 'application/json' }, body: JSON.stringify(liveSnapshot(db)) }).catch(() => { /* next time */ });
  setInterval(push, 30_000).unref();
  setTimeout(push, 5_000).unref();
}

/** Pushes everyone's profile to the Worker whenever it changes (checked every minute), so /profile/ is live.
 *  The data branch still gets its copy every 10 minutes, as a fallback. Main bot only. */
export function startProfilesFeed(db: Db, dir: Directory): void {
  const url = process.env.ACTIVITY_URL ?? '', secret = process.env.ACTIVITY_SECRET ?? '';
  if (!url || !secret) return;
  let last = '', warned = false;
  const push = () => {
    let body: string;
    try { body = JSON.stringify(profilesSnapshot(db, dir)); } catch (e) { console.error('[profiles feed]', e); return; }
    const key = body.replace(/"updated":"[^"]*"/, '');
    if (key === last) return;
    if (body.length > 1_800_000) { if (!warned) console.warn('[profiles feed] profiles are too big for the live feed; the site uses the data branch instead'); warned = true; return; }
    fetch(`${url}/bot/profiles`, { method: 'POST', headers: { 'X-Bot-Secret': secret, 'Content-Type': 'application/json' }, body })
      .then((r) => { if (r.ok) last = key; }).catch(() => { /* next time */ });
  };
  // Linked Roles: everyone's five stats, to a private spot on the Worker (it updates linked players' roles)
  let lastRoles = '';
  const pushRoles = () => {
    let body: string;
    try { body = JSON.stringify(roleStats(db, dir.botId?.() ?? null)); } catch (e) { console.error('[roles feed]', e); return; }
    if (body === lastRoles) return;
    fetch(`${url}/bot/roles`, { method: 'POST', headers: { 'X-Bot-Secret': secret, 'Content-Type': 'application/json' }, body })
      .then((r) => { if (r.ok) lastRoles = body; }).catch(() => { /* next time */ });
  };
  setInterval(() => { push(); pushRoles(); }, 60_000).unref();
  setTimeout(() => { push(); pushRoles(); }, 10_000).unref();
}

/** Polls the Cloudflare Worker for commands sent from the Activity, runs them as that player, sends replies back. */
/** The bits of a WebSocket the relay uses (Node 22 has one built in). */
interface LiveSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error', fn: () => void): void;
  addEventListener(type: 'message', fn: (ev: { data: unknown }) => void): void;
}

export function startActivity(db: Db, config: BotConfig, rng: Rng, client: Client): void {
  const url = process.env.ACTIVITY_URL ?? '', secret = process.env.ACTIVITY_SECRET ?? '';
  if (!url || !secret) { console.log('[activity] ACTIVITY_URL / ACTIVITY_SECRET not set, so the Trading Floor relay is off.'); return; }
  const headers = { 'X-Bot-Secret': secret, 'Content-Type': 'application/json' };
  let busy = false, failing = false;
  type Action = { id: string; guild_id: string; user_id: string; line: string; created?: number };
  const runOne = async (a: Action): Promise<unknown> => {
    // the site's admin console: owners only (the Worker has already checked who's logged in)
    if (String(a.line).startsWith('__console ')) {
      if (!config.ownerIds.includes(a.user_id)) return { content: 'ACCESS DENIED', denied: true };
      return { content: await consoleFromDm(String(a.line).slice(10)) };
    }
    const guild = client.guilds.cache.get(a.guild_id);
    if (!guild) return { content: 'The bot is not in this server.' };
    const member = await guild.members.fetch(a.user_id).catch(() => null);
    if (!member) return { content: 'You are not a member of this server.' };
    // when the player clicked, if the Worker says so (and it's recent): a Rocket cash-out counts from the click
    const now = Date.now(), at = a.created && now - a.created < 30_000 && a.created <= now ? a.created : now;
    const ctx = { db, config, rng, now: at, guildId: a.guild_id, channelId: `activity:${a.guild_id}`, user: { id: member.user.id, name: member.user.globalName ?? member.user.username }, isOwner: false, isMod: false, notes: [] as string[] };
    const line = String(a.line);
    // Iso-Chess on the site: unlocks, and paying for a finished run (needs an account in this server)
    if (line.startsWith('__chess ')) {
      me(ctx);
      const rest = line.slice(8).trim();
      if (rest === 'status') return { content: '', chess: chessStatus(db, a.guild_id, a.user_id, now) };
      if (rest.startsWith('finish ')) return { content: chessFinish(db, a.guild_id, a.user_id, rest.slice(7), now) };
      return { content: 'Unknown Iso-Chess request.' };
    }
    // Render's File Tycoon on the site: cashing out game earnings, and its achievements (needs an account here)
    if (line.startsWith('__rft ')) {
      me(ctx);
      const rest = line.slice(6).trim();
      if (rest === 'status') return { content: '', rft: rftStatus(db, a.user_id, now) };
      if (rest.startsWith('cashout ')) return { content: db.tx(() => rftCashout(db, a.guild_id, a.user_id, rest.slice(8), now)) };
      if (rest.startsWith('achieve ')) return { content: db.tx(() => rftAchieve(db, a.guild_id, a.user_id, rest.slice(8).trim(), now)) };
      return { content: 'Unknown File Tycoon request.' };
    }
    if (line.startsWith('__poll ')) return pollRelay(db, line.slice(7).trim(), now);
    if (line.startsWith('__press ')) {
      const r = press(ctx, line.slice(8).trim());
      return { update: r.update ? toRelay(r.update, now) : undefined, followUp: r.followUp ? toRelay(r.followUp, now) : undefined, notice: r.notice };
    }
    const parsed = parsePrefix(config.prefix + line.replace(/^\S*?!/, ''), config.prefix);
    if (!parsed || 'unknown' in parsed) return { content: didYouMean(config.prefix + line.replace(/^\S*?!/, ''), config.prefix) ?? 'Unknown command.' };
    if (!ALLOWED.has(parsed.cmd.name)) return { content: `\`${parsed.cmd.name}\` does not work from the Trading Floor. Use it in chat.` };
    const out = await execute(find(parsed.cmd.name)!, ctx, parsed.args);
    return { content: '', ...toRelay(out, now) };
  };
  // The live connection: commands arrive the moment they're sent and the reply goes straight back.
  // While it's open, the old check below only runs every 30 seconds (in case anything waited in the queue).
  let live = false;
  const run = (a: Action) => runOne(a).catch((e: unknown) => { console.error('[activity]', e); return { content: 'Something broke. It has been logged.' }; });
  const WS = (globalThis as unknown as { WebSocket?: new (url: string) => LiveSocket }).WebSocket;
  let wait = 5_000;
  const connect = (): void => {
    if (!WS) return;
    let sock: LiveSocket;
    try { sock = new WS(url.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws/bot'); } catch { setTimeout(connect, wait).unref(); return; }
    let ping: NodeJS.Timeout | undefined, pong = Date.now(), mine = false;
    sock.addEventListener('open', () => sock.send(JSON.stringify({ type: 'hello', secret })));
    sock.addEventListener('message', (ev) => {
      const text = String(ev.data);
      if (text === 'pong') { pong = Date.now(); return; }
      let m: { type?: string; action?: Action };
      try { m = JSON.parse(text); } catch { return; }
      if (m.type === 'ready') {
        mine = true; live = true; wait = 5_000;
        console.log('[activity] Live connection to the Worker is open');
        ping = setInterval(() => {
          if (Date.now() - pong > 90_000) { sock.close(); return; }
          try { sock.send('ping'); } catch { /* closing */ }
        }, 30_000);
        ping.unref();
        return;
      }
      if (m.type === 'run' && m.action) {
        const a = m.action;
        void run(a).then((result) => { try { sock.send(JSON.stringify({ type: 'result', id: a.id, result })); } catch { /* closed; the site will say so */ } });
      }
    });
    sock.addEventListener('close', () => {
      if (ping) clearInterval(ping);
      if (mine) { live = false; console.log('[activity] Live connection closed; checking the queue until it reconnects'); }
      setTimeout(connect, wait + Math.random() * 2_000).unref();
      wait = Math.min(wait * 2, 5 * 60_000);
    });
    sock.addEventListener('error', () => { /* "close" comes next */ });
  };
  connect();

  let ticks = 0;
  setInterval(async () => {
    if (busy) return;
    if (live && ++ticks % 15) return;
    busy = true;
    try {
      const r = await fetch(`${url}/bot/actions`, { headers });
      if (!r.ok) throw new Error(`Worker said ${r.status}`);
      const { actions = [] } = (await r.json()) as { actions?: Action[] };
      if (actions.length) {
        const results = [];
        for (const a of actions) results.push({ id: a.id, result: await run(a) });
        await fetch(`${url}/bot/results`, { method: 'POST', headers, body: JSON.stringify({ results }) });
      }
      if (failing) console.log('[activity] Reconnected to the Worker');
      failing = false;
    } catch (e) { if (!failing) console.error('[activity] Could not reach the Worker:', (e as Error).message); failing = true; }
    finally { busy = false; }
  }, 2000).unref();
  console.log('[activity] Listening for the Trading Floor at', url);
}

// ---------------------------------------------------------------- the web API

/** GET /health and GET /api/leaderboard?guild=<id>, for the site. Only when PORT is set. */
export function startApi(db: Db, client: Client): void {
  const port = Number(process.env.PORT ?? 0);
  if (!port) return;
  const origins = ['https://renderproductions.github.io', 'http://localhost:4000'];
  http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    if (origins.includes(String(req.headers.origin))) res.setHeader('Access-Control-Allow-Origin', String(req.headers.origin));
    res.setHeader('Content-Type', 'application/json');
    const send = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    if (u.pathname === '/health') return send(200, { ok: true, discord: client.isReady() ? 'connected' : 'not connected' });
    if (u.pathname === '/api/leaderboard') {
      const g = u.searchParams.get('guild') ?? '';
      const m = loadMarket(db);
      const rows = db.all<{ user_id: string; name: string | null }>('SELECT user_id, name FROM players WHERE guild_id = ?', g)
        .map((p) => ({ name: p.name ?? 'Unknown', netWorth: netWorth(db, m, g, p.user_id) / 100 })).sort((a, b) => b.netWorth - a.netWorth).slice(0, 10);
      return send(200, { guild: g, players: rows });
    }
    send(404, { error: 'not found' });
  }).listen(port, () => console.log(`[api] listening on ${port}`));
}

// The status lives in ./status.ts.
