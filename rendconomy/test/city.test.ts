import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as ACH } from '../src/achievements/achievements';
ACH.pay = false;
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, transfer, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { DAY, HOUR } from '../src/core/time';
import { execute } from '../src/discord/router';
import { tick } from '../src/market/market';
import { getCompany, treasury, treasuryId } from '../src/companies/companies';
import { cityAccount, closesAt, phaseOf, weekOf, workBonus } from '../src/city/state';
import { settleWorkers, staffOf, WORKERS } from '../src/companies/workers';

const G = 'g1', A = '111111111111111111', B = '222222222222222222', C = '333333333333333333', OWNER = '999999999999999999';
const text = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const monday = eastern('2026-11-16T12:00', -5);

function setup(start = monday) {
  const db = freshDb();
  tick(db, seededRng(2), start);
  let now = start;
  const ctx = (user = A, owner = false): Ctx => ({ db, config: botConfig(), rng: seededRng(1), now, guildId: G, channelId: 'c', user: { id: user, name: user }, isOwner: owner, isMod: owner, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A, owner = false) => execute(find(name)!, ctx(user, owner), args);
  const fund = (u: string, p: number) => transfer(db, { from: RESERVE, to: wallet(G, u), cents: polygons(p), reason: 'mod.give' });
  return { db, run, fund, later: (ms: number) => { now += ms; }, at: (t: number) => { now = t; }, now: () => now };
}

/** Accounts made 8 days ago and played on 3 different days since, so they can run. */
async function veterans(s: ReturnType<typeof setup>, ...users: string[]) {
  s.at(monday - 8 * DAY);
  for (const u of users) await s.run('balance', {}, u);
  for (const d of [5, 3, 1]) { s.at(monday - d * DAY); for (const u of users) await s.run('balance', {}, u); }
  s.at(monday);
}

test('the election week: nominations Monday to Thursday, voting Friday to Sunday 9 PM Eastern', () => {
  assert.equal(weekOf(monday), '2026-11-16');
  assert.equal(weekOf(eastern('2026-11-22T20:00', -5)), '2026-11-16', 'Sunday evening is the same week');
  assert.equal(phaseOf(monday).phase, 'nominations');
  assert.equal(phaseOf(eastern('2026-11-20T00:30', -5)).phase, 'voting');
  assert.equal(closesAt('2026-11-16'), eastern('2026-11-22T21:00', -5));
  assert.deepEqual(phaseOf(eastern('2026-11-22T21:30', -5)), { week: '2026-11-23', phase: 'nominations' }, 'after the close, the next race opens');
});

test('running, voting, the count, and the mayor taking office', async () => {
  const s = setup();
  const { db, run } = s;
  await run('balance', {}, C);   // a brand-new account
  assert.match(text(await run('mayor', { action: 'run' }, C)), /account at least 7 days old/);
  await veterans(s, A, B);
  assert.match(text(await run('mayor', { action: 'run', details: 'A Polygon in every pot' })), /on the ballot/);
  await run('mayor', { action: 'run' }, B);
  assert.match(text(await run('vote', { candidate: A }, C)), /Voting opens/);
  s.at(eastern('2026-11-20T12:00', -5));   // Friday
  assert.match(text(await run('mayor', { action: 'run' }, C)), /Nominations are closed/);
  await run('vote', { candidate: A }, C);
  await run('vote', { candidate: A }, B);
  assert.match(text(await run('vote', { candidate: B }, B)), /changed your vote/);
  await run('vote', { candidate: A });
  assert.match(text(await run('mayor', { action: 'race' })), /<@111111111111111111> · \*\*2\*\* votes[\s\S]*A Polygon in every pot/);
  assert.match(text(await run('mayor', { action: 'tax', details: 'shop 5' })), /no mayor this week/);
  s.at(eastern('2026-11-22T21:01', -5));
  assert.match(text(await run('mayor')), /Mayor:\*\* <@111111111111111111> \(2 of 3 votes\)/);
  assert.ok(db.get("SELECT 1 FROM achievements WHERE user_id = ? AND id = 'elected'", A));
});

test('two terms in a row, then sit one out', async () => {
  const s = setup();
  const { db, run } = s;
  await veterans(s, A);
  db.run("INSERT INTO mayors (guild_id, week, user_id, votes, total, starts_at, ends_at) VALUES (?, '2026-11-09', ?, 1, 1, 0, 0), (?, '2026-11-02', ?, 1, 1, 0, 0)", G, A, G, A);
  assert.match(text(await run('mayor', { action: 'run' })), /2 terms in a row/);
});

/** A mayor in office now: A. */
async function elected(s: ReturnType<typeof setup>) {
  await veterans(s, A, B, C);
  await s.run('mayor', { action: 'run' });
  s.at(eastern('2026-11-21T12:00', -5));
  await s.run('vote', { candidate: A }, B);
  s.at(eastern('2026-11-23T12:00', -5));   // the next Monday: A is mayor
}

test('taxes start at midnight and go to the city treasury', async () => {
  const s = setup();
  const { db, run, fund } = s;
  await elected(s);
  fund(B, 1000);
  assert.match(text(await run('mayor', { action: 'tax', details: 'shop 20' })), /0 to 15%/);
  assert.match(text(await run('mayor', { action: 'tax', details: 'shop 10' })), /\*\*10%\*\* from/);
  assert.match(text(await run('mayor', { action: 'tax', details: 'shop 10' }, B)), /Only the mayor/);
  const city0 = balance(db, cityAccount(G));
  await run('purchase', { item: 'coffee' }, B);
  assert.equal(balance(db, cityAccount(G)), city0, 'not until midnight');
  s.later(DAY);
  await run('purchase', { item: 'times' }, B);
  assert.ok(balance(db, cityAccount(G)) > city0, 'the sales tax lands in the city treasury');
  assert.ok(audit(db).ok);
});

test('business powers: freeze, fine, block, and no conflicts of interest', async () => {
  const s = setup();
  const { db, run, fund } = s;
  await elected(s);
  fund(B, 100_000); fund(C, 100_000); fund(A, 100_000);
  await run('found', { ticker: 'PREY', name: 'Prey Inc' }, B);
  await run('approve', { ticker: 'PREY' }, OWNER, true);
  await run('invest', { amount: '30000' }, B); await run('upgrade', {}, B); await run('upgrade', {}, B); await run('ipo', {}, B);
  // C starts crashing it; the mayor freezes trading
  await run('buy', { ticker: 'PREY', amount: '100' }, C);
  assert.match(text(await run('mayor', { action: 'freeze', details: 'PREY' })), /Give a reason/);
  assert.match(text(await run('mayor', { action: 'freeze', details: 'PREY Someone is dumping shares' })), /can't be traded until/);
  assert.match(text(await run('sell', { ticker: 'PREY', amount: '100' }, C)), /froze trading in PREY/);
  // fines: 15% of the treasury at most
  const t = treasury(db, getCompany(db, 'PREY')!);
  assert.match(text(await run('mayor', { action: 'fine', details: `PREY ${Math.ceil(t * 0.2 / 100)} too much` })), /The most you can fine PREY/);
  assert.match(text(await run('mayor', { action: 'fine', details: `<@${C}> 100 market manipulation` })), /Fined <@333333333333333333> \*\*⬡100/);
  // a takeover bid, blocked and refunded
  s.later(2 * DAY);
  for (let i = 0; i < 2; i++) await run('buy', { ticker: 'PREY', amount: '50' }, C);
  const c0 = balance(db, wallet(G, C));
  await run('takeover', { action: 'bid PREY' }, C);
  assert.ok(balance(db, wallet(G, C)) < c0, 'the premium went into escrow');
  // a mayor holding PREY shares can't touch it
  await run('buy', { ticker: 'PREY', amount: '1' });
  assert.match(text(await run('mayor', { action: 'block', details: 'PREY hostile' })), /Conflict of interest/);
  await run('sell', { ticker: 'PREY', amount: '1' });
  assert.match(text(await run('mayor', { action: 'block', details: 'PREY hostile takeover' })), /takeover bid is off and refunded/);
  assert.equal(balance(db, wallet(G, C)), c0, 'C got the premium back');
  assert.match(text(await run('mayor', { action: 'log' })), /Blocked a takeover bid on PREY: hostile takeover[\s\S]*Fined/);
  assert.ok(audit(db).ok);
});

test('public works, decrees, appointments and impeachment', async () => {
  const s = setup();
  const { db, run, now } = s;
  await elected(s);
  transfer(db, { from: RESERVE, to: (await (async () => { const { ensureCity } = await import('../src/city/city.js'); return ensureCity(db, G, now()); })()), cents: polygons(100_000), reason: 'mod.give' });
  assert.match(text(await run('mayor', { action: 'quote', details: 'rent 10 3' })), /\+10% rent for 3 days: \*\*⬡/);
  assert.match(text(await run('mayor', { action: 'build', details: 'rent 10 3 Main Street Repaving' })), /Main Street Repaving[\s\S]*funded/);
  assert.equal(workBonus(db, G, 'rent', s.now()), 0.1);
  assert.match(text(await run('mayor', { action: 'build', details: 'rent 5 1 Again' })), /already a rent work/);
  assert.match(text(await run('mayor', { action: 'decree', details: 'noheist Not on my watch' })), /No heists/);
  assert.match(text(await run('heist', { target: 'vault' }, B)), /By order of the mayor/);
  assert.match(text(await run('mayor', { action: 'decree', details: 'happyhour Again' })), /One decree with an effect a day/);
  assert.match(text(await run('mayor', { action: 'appoint', details: `chief <@${B}>` })), /new Police Chief/);
  assert.match(text(await run('mayor', { action: 'investigate', details: `<@${C}> suspicious` }, B)), /public record until/);
  assert.match(text(await run('mayor', { action: 'fine', details: `<@${C}> 1 nope` }, B)), /doesn't cover that/);
  // impeachment: 5 votes at least
  for (const u of [B, C]) await run('impeach', {}, u);
  for (const u of ['444444444444444444', '555555555555555555']) { await run('balance', {}, u); await run('impeach', {}, u); }
  await run('balance', {}, '666666666666666666');
  assert.match(text(await run('impeach', {}, '666666666666666666')), /Impeached!/);
  assert.match(text(await run('mayor')), /nobody this week/);
  assert.ok(audit(db).ok);
});

test('Collect Call fees go to the city treasury; the mayor sets the fee', async () => {
  const s = setup();
  const { db, run } = s;
  await elected(s);
  assert.match(text(await run('mayor', { action: 'collect', details: 'fee 25' })), /5 to 20%/);
  assert.match(text(await run('mayor', { action: 'collect', details: 'fee 20' })), /20\.00%|20%/);
  assert.match(text(await run('mayor')), /Collections:\*\* 20% fee, 3 days' grace/);
});

test('NPC workers: hire, earn, moods, strikes and quitting', async () => {
  const s = setup();
  const { db, run, fund } = s;
  await run('balance');
  fund(A, 50_000);
  await run('found', { ticker: 'MEOW', name: 'Cat Corp' });
  await run('approve', { ticker: 'MEOW' }, OWNER, true);
  await run('invest', { amount: '5000' });
  assert.match(text(await run('company', { ticker: 'hire' })), /Hired: \w+ \w+/);
  await run('company', { ticker: 'hire' });
  assert.match(text(await run('company', { ticker: 'hire' })), /room for 2 workers/);
  const c = getCompany(db, 'MEOW')!;
  const t0 = treasury(db, c);
  settleWorkers(db, c, () => 0.99, s.now() + 3 * DAY);
  assert.ok(treasury(db, c) > t0, 'two happy workers earn more than their wages');
  const [w] = staffOf(db, 'MEOW');
  assert.match(text(await run('company', { ticker: 'wage', details: `all 5` })), /under the going rate|Wages run/);
  await run('company', { ticker: 'wage', details: 'all 20' });
  settleWorkers(db, getCompany(db, 'MEOW')!, () => 0.99, s.now() + 14 * DAY);
  assert.equal(staffOf(db, 'MEOW').length, 0, 'underpaid for days, everyone quit');
  assert.ok(db.get("SELECT 1 FROM inbox WHERE user_id = ? AND title LIKE '% quit'", A), `${w!.name} told the owner why`);
  assert.equal(WORKERS.cap[0], 2);
  assert.ok(audit(db).ok);
});
