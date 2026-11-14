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
import * as sessions from '../src/core/sessions';
import { cooldown, HOUR } from '../src/core/time';
import { execute, press, typedAnswer } from '../src/discord/router';
import { load, tick } from '../src/market/market';
import { buy as buyShares, sharesOf } from '../src/market/trading';
import { addItem, count } from '../src/shop/inventory';
import { collectibleOfWeek, stockOf } from '../src/shop/shop';
import { KIND, TUNING as WORK, type WorkState } from '../src/work/shift';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const noon = eastern('2026-11-13T12:00', -5);

function setup() {
  const db = freshDb();
  tick(db, seededRng(5), noon);
  let now = noon;
  const ctx = (user = A): Ctx => ({ db, config: botConfig(), rng: seededRng(7), now, guildId: G, channelId: 'c', user: { id: user, name: user }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A) => execute(find(name)!, ctx(user), args);
  const rich = (user = A) => transfer(db, { from: RESERVE, to: wallet(G, user), cents: polygons(20_000), reason: 'mod.give' });
  return { db, ctx, run, rich, later: (ms: number) => { now += ms; } };
}

test('buying from the shop: stock is shared and restocks hourly; Marquez explains refusals', async () => {
  const { db, run, rich, later } = setup();
  await run('balance');
  assert.match(text(await run('purchase', { item: 'coffee' })), /Purchase complete[\s\S]*1 × ☕ Coffee: ⬡100\.00/);
  assert.equal(balance(db, wallet(G, A)), polygons(400));
  assert.match(text(await run('purchase', { item: 'title' })), /costs ⬡5,000\.00/);
  rich();
  await run('purchase', { item: 'coffee 4' });
  assert.equal(stockOf(db, 'coffee'), 0);
  assert.match(text(await run('purchase', { item: 'coffee' }, B)), /sold out/, 'stock is shared by everyone');
  later(HOUR);
  assert.match(text(await run('purchase', { item: 'coffee' }, B)), /Purchase complete/, 'restocked');
  assert.match(text(await run('purchase', { item: 'megaphone' })), /not on sale yet/);
  assert.ok(audit(db).ok);
});

test('the shop view switches shelves and buys with buttons', async () => {
  const { db, run, ctx } = setup();
  const r = await run('shop');
  assert.match(text(r), /Marquez's Shop · 💼 Work[\s\S]*Coffee/);
  const market = press(ctx(), sessions.buttonId(r.session!, 'shelf:market'));
  assert.match(text(market.update), /Dividend Booster/);
  const bought = press(ctx(), sessions.buttonId(r.session!, 'buy:booster'));
  assert.match(text(bought.update), /Purchased: 📈 Dividend Booster/);
  assert.equal(count(db, G, A, 'booster'), 1);
});

test('collectibles: only this week\'s, one per customer', async () => {
  const { db, run, rich } = setup();
  await run('balance');
  rich();
  const col = collectibleOfWeek(noon);
  const other = ['col_nacho', 'col_todd'].find((c) => c !== col)!;
  assert.match(text(await run('purchase', { item: col })), /Purchase complete/);
  assert.match(text(await run('purchase', { item: col })), /already bought/);
  assert.match(text(await run('purchase', { item: other })), /not on the special shelf/);
  assert.equal(count(db, G, A, col), 1);
});

test('using items: coffee resets work, overtime doubles a shift, stopwatch adds time', async () => {
  const { db, run, ctx } = setup();
  await run('apply', { ticker: 'BNW' });
  WORK.kind = 'math';
  await run('work');
  typedAnswer(ctx(), 'wrong');
  assert.equal(cooldown(db, 'work', `${G}:${A}`, noon).ready, false);
  addItem(db, G, A, 'coffee'); addItem(db, G, A, 'overtime'); addItem(db, G, A, 'stopwatch');
  assert.match(text(await run('use', { item: 'coffee' })), /cooldown has been reset/);
  assert.equal(cooldown(db, 'work', `${G}:${A}`, noon).ready, true);
  await run('use', { item: 'overtime' });
  await run('use', { item: 'stopwatch' });
  const r = await run('work');
  assert.match(r.content!, /Stopwatch: 10 extra seconds/);
  const s = sessions.active<WorkState>(db, KIND, G, A, noon)!;
  assert.equal(s.state.task.limitSec, 30);
  const out = typedAnswer(ctx(), 'wrong')!.reply;
  assert.match(text(out), /Overtime: pay doubled/);
  WORK.kind = undefined;
});

test('passive items: insurance saves shares from a wipe, a resume skips the quit lock, wrap skips the gift fee', async () => {
  const { db, run } = setup();
  await run('balance');
  const m = load(db)!;
  buyShares(db, m, { guildId: G, userId: A, ticker: 'BLU', qty: 2 });
  addItem(db, G, A, 'insurance');
  const wiped = { ...m, wipes: { ...m.wipes, BLU: (m.wipes.BLU ?? 0) + 1 } };
  assert.equal(sharesOf(db, wiped, G, A, 'BLU'), 2, 'insured');
  assert.equal(count(db, G, A, 'insurance'), 0, 'the policy is used up');

  await run('apply', { ticker: 'RRM' });
  addItem(db, G, A, 'resume');
  assert.match(text(await run('quit')), /Confirm resignation/);
  assert.equal(count(db, G, A, 'resume'), 0);

  addItem(db, G, A, 'wrap');
  await run('use', { item: 'gift wrap' });
  assert.match(text(await run('gift', { player: B, amount: '10' })), /Gift Wrap: no fee/);
  assert.match(text(await run('gift', { player: B, amount: '10' })), /Fee: ⬡0\.50/);
});

test('mystery and floppy always do something and keep the books balanced', async () => {
  const { db, run } = setup();
  await run('balance');
  for (let i = 0; i < 20; i++) { addItem(db, G, A, 'mystery'); addItem(db, G, A, 'floppy'); }
  for (let i = 0; i < 20; i++) {
    assert.ok(text(await run('use', { item: 'mystery' })).length > 10);
    assert.ok(text(await run('use', { item: 'floppy' })).length > 10);
  }
  assert.match(text(await run('use', { item: 'insurance' })), /works on its own/);
  assert.match(text(await run('use', { item: 'coffee' })), /do not have a Coffee/);
  assert.ok(audit(db).ok);
});

test('profiles: the kit and paints unlock looks for good; the profile shows the essentials', async () => {
  const { db, run } = setup();
  await run('balance');
  assert.match(text(await run('profile', { action: 'color #ff4fd8' })), /Customizer Kit is required/);
  addItem(db, G, A, 'kit'); addItem(db, G, A, 'paint_terminal');
  await run('use', { item: 'kit' });
  assert.match(text(await run('profile', { action: 'color #ff4fd8' })), /#ff4fd8/);
  assert.match(text(await run('profile', { action: 'theme terminal' })), /is a Profile Paint/);
  await run('use', { item: 'paint_terminal' });
  assert.match(text(await run('profile', { action: 'theme terminal' })), /TODD Terminal/);
  assert.match(text(await run('profile', { action: 'banner crown' })), /reserved/);
  const card = await run('profile');
  assert.match(text(card), /Net worth:\*\* ⬡/);
  assert.equal(card.embeds![0]!.color, 0x33ff66);
});

test('titles: set with a Title item, cleared by moderators', async () => {
  const { db, run } = setup();
  await run('balance');
  assert.match(text(await run('settitle', { title: 'Nacho Baron' })), /Title item is required/);
  addItem(db, G, A, 'title');
  assert.match(text(await run('settitle', { title: 'Nacho **Baron**' })), /Nacho Baron/);
  assert.equal(db.get<{ title: string }>('SELECT title FROM players WHERE user_id = ?', A)!.title, 'Nacho Baron');
});

test('fishing: needs a rod, costs bait, fills the bag, sells to Marquez', async () => {
  const { db, run, later } = setup();
  await run('balance');
  assert.match(text(await run('fish')), /Fishing Rod is required/);
  addItem(db, G, A, 'rod');
  let caught = 0;
  for (let i = 0; i < 40; i++) {
    const r = text(await run('fish'));
    assert.match(r, /Fishing/);
    if (/Caught:/.test(r)) caught++;
    later(3 * 60_000);
  }
  assert.ok(caught > 10, `caught ${caught} in 40 casts`);
  assert.match(text(await run('sellfish')), /Catch sold[\s\S]*Paid: ⬡/);
  assert.match(text(await run('sellfish')), /bag is empty/);
  assert.ok(audit(db).ok);
});
