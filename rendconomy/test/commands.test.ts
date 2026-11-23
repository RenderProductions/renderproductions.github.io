import { test } from 'node:test';
import { TUNING as ACH } from '../src/achievements/achievements';
ACH.pay = false; // these tests check exact balances
import assert from 'node:assert/strict';
import { freshDb, eastern } from './helpers';
import { commands, find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, RESERVE, wallet } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { execute, parsePrefix, press, slashBody } from '../src/discord/router';
import { tick } from '../src/market/market';
import { slashFor } from '../src/commands/slashname';

const G = 'guild1';
const db = freshDb();
const config = { ...botConfig(), prefix: 'r!' };

function ctx(userId: string, now: number, guildId: string | null = G): Ctx {
  return { db, config, rng: seededRng(1), now, guildId, channelId: 'chan1', user: { id: userId, name: userId }, isOwner: false, isMod: false, notes: [] };
}
async function run(line: string, userId = 'alice', now = eastern('2026-11-13T22:00', -5), guildId: string | null = G): Promise<ReplyObject> {
  const p = parsePrefix(line, 'r!');
  if (!p || 'unknown' in p) throw new Error(`not a command: ${line}`);
  return execute(p.cmd, ctx(userId, now, guildId), p.args);
}
const text = (r: ReplyObject) => [r.content ?? '', ...(r.embeds ?? []).flatMap((e) => [e.title ?? '', e.description ?? '', e.footer?.text ?? ''])].join('\n');

test('the first command opens an account with 500 Polygons', async () => {
  const r = await run('r!bal');
  assert.match(text(r), /⬡500\.00/);
  assert.match(text(r), /Account opened/);
  assert.doesNotMatch(text(await run('r!balance')), /Account opened/, 'only the first time');
});

test('daily pays 250 once per Eastern day, and streaks count yesterday', async () => {
  const night = eastern('2026-11-13T23:59', -5);
  assert.match(text(await run('r!daily', 'alice', night)), /\*\*⬡250\.00\*\* has been deposited[\s\S]*⬡750\.00[\s\S]*Streak: \*\*1 day/);
  const again = await run('r!daily', 'alice', night);
  assert.equal(again.ephemeral, true);
  assert.match(text(again), /already been collected/);
  assert.equal(balance(db, wallet(G, 'alice')), polygons(750), 'no second payout');

  assert.match(text(await run('r!daily', 'alice', eastern('2026-11-14T00:00', -5))), /Streak: \*\*2 days/, 'midnight is a new day');
  assert.match(text(await run('r!daily', 'alice', eastern('2026-11-16T12:00', -5))), /Streak: \*\*1 day/, 'a missed day resets it');
  assert.ok(audit(db).ok);
});

test('balance of another player, and of someone with no account', async () => {
  await run('r!daily', '222222222222222222');
  assert.match(text(await run('r!bal <@222222222222222222>')), /⬡750\.00/);
  assert.match(text(await run('r!bal <@333333333333333333>')), /no account in this server/);
});

test('history shows where the money came from, privately', async () => {
  const r = await run('r!history');
  assert.equal(r.ephemeral, true);
  assert.match(text(r), /```diff\n\+ ⬡250\.00  Daily allowance +just now/);
  assert.match(text(r), /\n\+ ⬡500\.00  Starting balance +just now/);
});

test('reserve shows what the house has left', async () => {
  const left = balance(db, RESERVE);
  assert.ok(left < polygons(25_000_000));
  assert.match(text(await run('r!reserve')), /The Polygon Reserve/);
});

test('server-only commands are refused in DMs', async () => {
  assert.match(text(await run('r!daily', 'alice', Date.now(), null)), /only available in a server/);
  assert.match(text(await run('r!ping', 'alice', Date.now(), null)), /Online/);
});

test('help: every command is on a section page, and every page fits in a Discord embed', async () => {
  const r = await run('r!help');
  assert.ok(r.session && r.buttons?.length);
  const pressButton = (id: string) => press(ctx('alice', eastern('2026-11-13T22:00', -5)), id);
  let all = '';
  for (const row of r.buttons!) for (const b of row) {
    const page = pressButton(b.id);
    const d = page.update?.embeds?.[0]?.description ?? '';
    assert.ok(d.length <= 4096, `${b.label} page is ${d.length} characters`);
    all += d;
  }
  for (const c of commands.filter((x) => x.system !== 'admin' && !x.hidden)) assert.ok(all.includes(slashFor(c, commands)), `help is missing ${c.name}`);
  assert.ok(!all.includes('/wipe'), 'moderator commands are hidden from players');
  assert.match(text(await run('r!help w')), /\/work[\s\S]*r!w/);
  assert.match(text(await run('r!help stock')), /Stock market[\s\S]*\/buy/);
  assert.match(text(await run('r!help nonsense')), /no command or section/);
});

test('prefix parsing', () => {
  assert.equal(parsePrefix('hello', 'r!'), null);
  assert.deepEqual(parsePrefix('r!nope', 'r!'), { unknown: 'nope' });
  const p = parsePrefix('R!BAL <@!123456789012345678>', 'r!');
  assert.ok(p && 'cmd' in p);
  assert.equal(p.cmd.name, 'balance');
  assert.equal(p.args.player, '123456789012345678');
  assert.equal(find('tx')?.name, 'history');
});

test('slash definitions are valid for Discord', () => {
  const body = slashBody();
  assert.equal(body.length, commands.filter((c) => !c.hidden && !c.helperOf && c.system !== 'admin').length + 1, 'every command, with the moderator ones folded into /mod and helpers under their parents');
  for (const c of body) {
    assert.match(c.name, /^[a-z0-9_-]{1,32}$/);
    assert.ok(c.description.length > 0 && c.description.length <= 100);
  }
  const names = new Set<string>();
  for (const c of commands) for (const n of [c.name, ...(c.aliases ?? [])]) {
    assert.ok(!names.has(n), `duplicate command name or alias: ${n}`);
    names.add(n);
  }
});

test('market commands: view, buy, sell, portfolio', async () => {
  const noon = eastern('2026-11-13T12:00', -5);
  tick(db, seededRng(3), noon);
  const u = '444444444444444444';
  const view = text(await run('r!market', u, noon));
  for (const t of ['RRM', 'NACH', 'BLU', 'BNW', 'BSTG']) assert.ok(view.includes(`**${t}**`), `market shows ${t}`);
  assert.match(text(await run('r!buy blu 2', u, noon)), /Bought 2 BLU/);
  assert.match(text(await run('r!buy RRM max', u, noon)), /Bought \d+ RRM/);
  assert.match(text(await run('r!pf', u, noon)), /Net worth/);
  assert.match(text(await run('r!sell blu all', u, noon)), /Sold 2 BLU[\s\S]*Gain against purchase price: ⬡0\.00/);
  assert.match(text(await run('r!sell blu 1', u, noon)), /hold 0 shares of BLU/);
  assert.match(text(await run('r!buy blu 1.5', u, noon)), /whole numbers/);
  assert.match(text(await run('r!div', u, noon)), /Dividends/);
  assert.match(text(await run('r!chart bstg', u, noon)), /Bastardly Glory \(BSTG\)/);
  assert.ok(audit(db).ok);
});

test('slash commands fit under Discord\'s limit of 100; moderator commands share /mod', async () => {
  const { slashBody } = await import('../src/discord/router.js');
  const body = slashBody();
  assert.ok(body.length <= 100, `${body.length} slash commands`);
  assert.ok(body.some((c) => c.name === 'mod'));
  assert.ok(!body.some((c) => c.name === 'give' || c.name === 'wipe'));
});

test('helpers: "company close" runs closecompany, by prefix and by slash; folded commands leave the slash list', async () => {
  const { parsePrefix, slashBody } = await import('../src/discord/router.js');
  const { commands } = await import('../src/commands/index.js');
  const p = parsePrefix('r!company close confirm', 'r!');
  assert.ok(p && 'cmd' in p && p.cmd.name === 'closecompany' && p.args.confirm === 'confirm');
  const q = parsePrefix('r!market chart RRM', 'r!');
  assert.ok(q && 'cmd' in q && q.cmd.name === 'chart');
  const v = parsePrefix('r!mayor vote <@222222222222222222>', 'r!');
  assert.ok(v && 'cmd' in v && v.cmd.name === 'vote' && v.args.candidate === '222222222222222222');
  const old = parsePrefix('r!closecompany', 'r!');
  assert.ok(old && 'cmd' in old && old.cmd.name === 'closecompany', 'the old names still work');
  const names = slashBody().map((c) => c.name);
  for (const n of ['closecompany', 'chart', 'vote', 'plant', 'sellfish', 'payback']) assert.ok(!names.includes(n), n);
  assert.ok(names.length <= 75, `${names.length} slash commands`);
  const { slashFor } = await import('../src/commands/slashname.js');
  assert.equal(slashFor(commands.find((c) => c.name === 'closecompany')!, commands), '/company close');
  assert.equal(slashFor(commands.find((c) => c.name === 'sellcrops')!, commands), '/farm sell');
});
