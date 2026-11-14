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
import { DAY } from '../src/core/time';
import { execute } from '../src/discord/router';
import { tick } from '../src/market/market';
import { companiesTick, getCompany, treasury, treasuryId, holding } from '../src/companies/companies';
import { siteFiles } from '../src/site/publish';

const G = 'g1', A = '111111111111111111', B = '222222222222222222', OWNER = '999999999999999999';
const text = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const noon = eastern('2026-11-13T12:00', -5);

function setup() {
  const db = freshDb();
  tick(db, seededRng(2), noon);
  let now = noon;
  const ctx = (user = A, owner = false): Ctx => ({ db, config: botConfig(), rng: seededRng(1), now, guildId: G, channelId: 'c', user: { id: user, name: user }, isOwner: owner, isMod: owner, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A, owner = false) => execute(find(name)!, ctx(user, owner), args);
  const fund = (u: string, p: number) => transfer(db, { from: RESERVE, to: wallet(G, u), cents: polygons(p), reason: 'mod.give' });
  return { db, ctx, run, fund, later: (ms: number) => { now += ms; }, now: () => now };
}

test('found, approve or reject, invest, upgrade, go public, trade shares, salary', async () => {
  const { db, run, fund } = setup();
  await run('balance'); await run('balance', {}, B);
  fund(A, 50_000); fund(B, 20_000);
  assert.match(text(await run('found', { ticker: 'RRM', name: 'Nope' })), /already a listed company/);
  assert.match(text(await run('found', { ticker: 'MEOW', name: 'Cat Corp' })), /Founded: Cat Corp \(MEOW\)/);
  assert.match(text(await run('approve', { ticker: 'MEOW' }, B)), /restricted to the bot owner/);
  assert.match(text(await run('upgrade')), /must be approved/);
  await run('approve', { ticker: 'MEOW' }, OWNER, true);
  await run('invest', { amount: '20000' });
  assert.match(text(await run('upgrade')), /now a Small Business/);
  assert.match(text(await run('upgrade')), /now a Firm/);
  assert.match(text(await run('ipo')), /Cat Corp is public[\s\S]*Opening price/);
  assert.match(text(await run('buy', { ticker: 'MEOW', amount: '10' })), /cannot own shares of your own company/);
  const before = treasury(db, getCompany(db, 'MEOW')!);
  assert.match(text(await run('buy', { ticker: 'MEOW', amount: '10' }, B)), /Purchase complete: 10 MEOW/);
  assert.ok(treasury(db, getCompany(db, 'MEOW')!) > before, 'IPO shares fund the treasury');
  assert.match(text(await run('sell', { ticker: 'MEOW', amount: '10' }, B)), /Sale complete: 10 MEOW/);
  assert.match(text(await run('salary', { amount: 'max' })), /Salary paid/);
  assert.match(text(await run('salary', { amount: '1' })), /once a day/);
  assert.match(text(await run('exchange')), /MEOW\*\* · Cat Corp · Firm/);
  const pc = JSON.parse(siteFiles(db)['player-companies.json']!);
  assert.equal(pc.companies[0].ticker, 'MEOW');
  assert.ok(audit(db).ok);
});

test('rejection refunds; a private company that misses upkeep 3 days closes', async () => {
  const { db, run, fund, now } = setup();
  await run('balance'); fund(A, 3000);
  await run('found', { ticker: 'BAD', name: 'Bad Name' });
  const before = balance(db, wallet(G, A));
  assert.match(text(await run('reject', { ticker: 'BAD', reason: 'name' }, OWNER, true)), /refunded/);
  assert.equal(balance(db, wallet(G, A)) - before, polygons(2500));
  await run('found', { ticker: 'POOR', name: 'Poor Co' });
  await run('approve', { ticker: 'POOR' }, OWNER, true);
  transfer(db, { from: treasuryId('POOR'), to: RESERVE, cents: treasury(db, getCompany(db, 'POOR')!), reason: 'test' });
  companiesTick(db, now() + 3 * DAY + 1000, () => 0.5);
  assert.equal(getCompany(db, 'POOR')!.status, 'dead');
  assert.ok(audit(db).ok);
});

test('jobs at player companies earn for the treasury', async () => {
  const { db, run, fund } = setup();
  await run('balance'); await run('balance', {}, B); fund(A, 3000);
  await run('found', { ticker: 'JOBS', name: 'Job Co' });
  await run('approve', { ticker: 'JOBS' }, OWNER, true);
  assert.match(text(await run('apply', { ticker: 'JOBS' }, B)), /Hired: Job Co/);
  const before = treasury(db, getCompany(db, 'JOBS')!);
  const { typedAnswer } = await import('../src/discord/router.js');
  await run('work', {}, B);
  const s = (await import('../src/core/sessions.js')).active<{ task: { grade: { type: string; value?: string; values?: string[] }; steps?: string[] } }>(db, 'work', G, B, noon)!;
  const g = s.state.task.grade;
  typedAnswer({ db, config: botConfig(), rng: seededRng(9), now: noon + 1000, guildId: G, channelId: 'c', user: { id: B, name: B }, isOwner: false, isMod: false, notes: [] },
    s.state.task.steps ? s.state.task.steps.join(' ') : g.type === 'exact' ? g.value! : g.type === 'oneOf' ? g.values![0]! : '0');
  assert.ok(treasury(db, getCompany(db, 'JOBS')!) > before, 'the shift added revenue');
});

test('takeover: a controlling stake bids; with no defense it completes', async () => {
  const { db, run, fund, now } = setup();
  await run('balance'); await run('balance', {}, B); fund(A, 50_000); fund(B, 200_000);
  await run('found', { ticker: 'PREY', name: 'Prey Inc' });
  await run('approve', { ticker: 'PREY' }, OWNER, true);
  await run('invest', { amount: '20000' }); await run('upgrade'); await run('upgrade'); await run('ipo');
  assert.match(text(await run('takeover', { action: 'bid PREY' }, B)), /needs 200 of the 400/);
  for (let i = 0; i < 10; i++) await run('buy', { ticker: 'PREY', amount: '20' }, B);
  assert.equal(holding(db, G, B, 'PREY'), 200);
  assert.match(text(await run('takeover', { action: 'bid PREY' }, B)), /Takeover bid: Prey Inc/);
  companiesTick(db, now() + DAY + 1000, () => 0.5);
  assert.equal(getCompany(db, 'PREY')!.owner_id, B);
  assert.ok(audit(db).ok);
});
