import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, wallet } from '../src/core/ledger';
import { seededRng } from '../src/core/rng';
import { execute } from '../src/discord/router';
import { award, has } from '../src/achievements/achievements';
import { ACHIEVEMENTS, BY_ID } from '../src/achievements/list';
import { BIRTHDAY, addCake, cakeOf, capsuleTick, forceParty, nextParty, onPartyShelf, partyDid, partyOf, partyTick, sealCapsule } from '../src/birthday/birthday';
import { buy } from '../src/shop/shop';
import { addItem, count } from '../src/shop/inventory';
import { SPECIES } from '../src/fishing/fishing';
import { question } from '../src/social/chatter';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const at = (d: string) => eastern(d, d.slice(5, 7) === '08' ? -4 : -5);

function setup(start: string) {
  const db = freshDb();
  let now = at(start);
  const ctx = (user: string): Ctx => ({ db, config: botConfig(), rng: seededRng(5), now, guildId: G, channelId: 'c', user: { id: user, name: `P${user[0]}` }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A) => execute(find(name)!, ctx(user), args);
  return { db, run, set: (d: string) => { now = at(d); }, now: () => now };
}

test('the parties: Nov 9-15 for RendConomy (from 2027), Aug 17-19 for Render Vision', () => {
  assert.equal(partyOf(at('2026-11-10T12:00')), null, 'not in the bot\'s own first week');
  const b = partyOf(at('2027-11-09T12:00'))!;
  assert.equal(b.kind, 'bot'); assert.equal(b.age, 1); assert.equal(b.bash, true); assert.equal(b.name, 'RendConomy Big Birthday Blowout!');
  assert.equal(partyOf(at('2027-11-10T12:00'))!.bash, false);
  assert.equal(partyOf(at('2027-11-15T23:59'))!.day, 7);
  assert.equal(partyOf(at('2027-11-16T00:01')), null);
  assert.equal(partyOf(at('2028-11-12T12:00'))!.age, 2);
  const d = partyOf(at('2027-08-18T12:00'))!;
  assert.equal(d.kind, 'dev'); assert.equal(d.name, 'Render Vision\'s Big Birthday!'); assert.equal(d.bash, true);
  assert.ok(partyOf(at('2027-08-17T00:01')) && partyOf(at('2027-08-19T23:59')));
  assert.equal(partyOf(at('2027-08-20T00:01')), null);
  assert.deepEqual(nextParty(at('2026-11-27T12:00')), { kind: 'dev', at: 'August 17' });
  assert.deepEqual(nextParty(at('2027-09-01T12:00')), { kind: 'bot', at: 'November 9' });
});

test('r!birthday outside a party says when the next one is', async () => {
  const { run } = setup('2027-03-01T12:00');
  await run('balance');
  assert.match(text(await run('birthday')), /next one is \*\*Render Vision's Big Birthday!\*\*, starting \*\*August 17\*\*/);
  assert.match(text(await run('yearbook')), /RendConomy's birthday, November 9 to 15/);
});

test('the cake: everyone fills it, and everyone who helped is paid when it\'s done', async () => {
  const { db, run, now } = setup('2027-11-10T12:00');
  await run('balance'); await run('balance', {}, B);
  const p = partyOf(now())!;
  const target = cakeOf(db, G, p, now()).target;
  assert.equal(target, BIRTHDAY.cake.bot.base + BIRTHDAY.cake.bot.perPlayer * 2, 'base plus two active players');
  const a0 = balance(db, wallet(G, A)), b0 = balance(db, wallet(G, B));
  addCake(db, G, B, 5, now());
  assert.equal(addCake(db, G, A, target - 6, now()), '');
  const done = addCake(db, G, A, 3, now());
  assert.match(done, /The cake is done!.*\(2\)/);
  assert.equal(addCake(db, G, A, 3, now()), '', 'done once');
  assert.ok(balance(db, wallet(G, A)) - a0 >= BIRTHDAY.cakeReward.bot);
  assert.ok(balance(db, wallet(G, B)) - b0 >= BIRTHDAY.cakeReward.bot);
  assert.ok(has(db, A, 'blow_out_the_candles') && has(db, B, 'blow_out_the_candles'));
  assert.match(text(await run('birthday')), /RendConomy is \*\*1\*\*[\s\S]*done! The candles are out/);
  assert.ok(audit(db).ok);
});

test('Birthday Bash: a bonus on dailies; Year One and Party Guest just for showing up', async () => {
  const { db, run } = setup('2027-11-09T12:00');
  const r = text(await run('daily'));
  assert.match(r, /Birthday Bash: \*\*\+⬡250(\.00)?\*\* birthday bonus/);
  assert.ok(has(db, A, 'party_guest'));
  assert.ok(has(db, A, 'year_1'));
});

test('the Party shelf: cake slices, one Party Hat per party, and the candle for the age it\'s turning', async () => {
  const { db, run, now, set } = setup('2027-11-11T12:00');
  await run('balance');
  db.run('UPDATE accounts SET balance = 100000000 WHERE id = ?', wallet(G, A));
  assert.ok(onPartyShelf('col_candle1', now()) && !onPartyShelf('col_candle2', now()));
  buy(db, seededRng(1), G, A, 'col_partyhat', 1, now());
  assert.throws(() => buy(db, seededRng(1), G, A, 'col_partyhat', 1, now()), /already have a Party Hat/);
  buy(db, seededRng(1), G, A, 'col_candle1', 1, now());
  buy(db, seededRng(1), G, A, 'cake', 3, now());
  assert.equal(count(db, G, A, 'cake'), 3);
  assert.match(text(await run('use', { item: 'cake' })), /folded note under it: \*\*⬡/);
  set('2027-08-18T12:00');
  assert.ok(!onPartyShelf('col_candle1', now()), 'no numbered candle on Render Vision\'s birthday');
  set('2027-12-01T12:00');
  assert.throws(() => buy(db, seededRng(1), G, A, 'cake', 1, now()), /party stock/);
});

test('Party Animal: a slice, a drop-in and a Party Fish in the same party', () => {
  const db = freshDb();
  const now = at('2027-08-18T12:00');
  partyDid(db, G, A, 'slice', now); partyDid(db, G, A, 'dropin', now);
  assert.ok(!has(db, A, 'party_animal'));
  partyDid(db, G, A, 'fish', now);
  assert.ok(has(db, A, 'party_animal'));
  assert.ok(SPECIES.partyfish?.event, 'the Party Fish isn\'t part of the Fishdex');
});

test('the time capsule: sealed this year, opened (and DMed) at the next birthday', async () => {
  const { db, run, set, now } = setup('2027-11-12T12:00');
  await run('balance');
  assert.match(text(await run('birthday', { action: 'capsule', text: 'hello future me' })), /Sealed: \*"hello future me"\*/);
  assert.ok(has(db, A, 'sealed_with_care'));
  set('2028-11-09T12:00');
  assert.match(text(await run('birthday', { action: 'capsule' })), /from last year \(1\)[\s\S]*hello future me/);
  const sent: string[] = [];
  capsuleTick(db, now(), (_u, _g, t) => sent.push(t('Server')));
  capsuleTick(db, now(), (_u, _g, t) => sent.push(t('Server')));
  assert.equal(sent.length, 1);
  assert.match(sent[0]!, /hello future me/);
  set('2028-08-18T12:00');
  assert.match(text(await run('birthday', { action: 'capsule', text: 'x' })), /RendConomy's own birthday/);
  assert.throws(() => sealCapsule(db, G, A, 'x', now()));
});

test('the party starts once: jackpots topped up, then the Bash announced', () => {
  const db = freshDb();
  db.run('INSERT INTO players (guild_id, user_id, joined_at) VALUES (?, ?, ?)', G, A, 0);
  db.setMeta(`casino.jackpot:${G}`, '1000000');
  const said = partyTick(db, at('2027-11-09T00:05'));
  assert.equal(said.length, 2);
  assert.match(said[0]!, /RendConomy is 1 today/);
  assert.match(said[1]!, /Birthday Bash/);
  assert.equal(Number(db.meta(`casino.jackpot:${G}`)), 1_000_000 + BIRTHDAY.jackpotTopUp.bot);
  assert.deepEqual(partyTick(db, at('2027-11-09T08:00')), []);
});

test('TODD asks birthday questions at a party, and the console can start one early', () => {
  forceParty('dev');
  try {
    const qs = Array.from({ length: 40 }, (_, i) => question(null, seededRng(i)).q);
    assert.ok(qs.some((q) => q.startsWith('🎈')));
    assert.equal(partyOf(at('2027-03-01T12:00'))!.kind, 'dev');
  } finally { forceParty(null); }
  assert.equal(partyOf(at('2027-03-01T12:00')), null);
});

test('Completionist is gone: one completion achievement per category instead', () => {
  assert.equal(BY_ID.completionist, undefined);
  assert.ok(BY_ID.complete_fishing && BY_ID.complete_casino);
  assert.equal(BY_ID.complete_birthday, undefined, 'birthdays grow every year');
  assert.equal(BY_ID.complete_secret, undefined);
  const db = freshDb();
  const now = at('2027-03-01T12:00');
  for (const a of ACHIEVEMENTS.filter((x) => x.cat === 'heists')) award(db, null, A, a.id, now);
  assert.ok(has(db, A, 'complete_heists'));
  assert.ok(!has(db, A, 'complete_fishing'));
  void addItem;
});
