import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ButtonInteraction, Client } from 'discord.js';
import { freshDb } from './helpers';
import { botConfig } from '../src/config';
import { seededRng } from '../src/core/rng';
import { balance, wallet } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { consoleFromDm, consoleRun, onRainButton, startConsole, type ConsoleDeps } from '../src/discord/console';
import { find } from '../src/commands';
import { execute } from '../src/discord/router';
import { siteLink } from '../src/discord/style';
import { resolveItem } from '../src/commands/admin';

const G = '900000000000000001', CH = '700000000000000001', A = '111111111111111111', B = '222222222222222222';

function setup() {
  const db = freshDb();
  const sent: { content?: string; components?: unknown[]; embeds?: unknown[] }[] = [];
  const channel = { id: CH, name: 'general', guildId: G, isSendable: () => true, isTextBased: () => true, send: async (m: never) => { sent.push(m); return { delete: async () => {} }; }, sendTyping: async () => {} };
  let left = false;
  const guild = { id: G, name: 'The Render Room', memberCount: 3, channels: { cache: new Map([[CH, channel]]) }, leave: async () => { left = true; } };
  let presence: unknown = null;
  const client = {
    guilds: { cache: new Map([[G, guild]]) },
    channels: { cache: new Map([[CH, channel]]), fetch: async (id: string) => (id === CH ? channel : null) },
    user: { id: 'bot', setPresence: (p: unknown) => { presence = p; } }
  } as unknown as Client;
  const config = { ...botConfig(), ownerIds: [A] };
  let todd = 0;
  const deps: ConsoleDeps = { db, client, config, rng: seededRng(5), todd: async () => { todd++; }, postNext: async () => null };
  process.env.CONSOLE = '0';   // no stdin listener in tests
  startConsole(deps);
  const run = (line: string) => consoleRun(deps, line);
  const ctx = (u: string) => ({ db, config, rng: seededRng(1), now: Date.now(), guildId: G, channelId: CH, user: { id: u, name: u }, isOwner: false, isMod: false, notes: [] });
  return { db, run, sent, presence: () => presence, todd: () => todd, ctx, left: () => left };
}

test('console: help, servers, say, todd, status and unknown commands', async () => {
  const { db, run, sent, presence, todd } = setup();
  assert.match((await run('help'))!, /say <channel> <text>/);
  assert.match((await run('servers'))!, /The Render Room/);
  assert.match((await run(`say ${CH} hello there`))!, /Posted/);
  assert.equal(sent.at(-1)!.content, 'hello there');
  assert.match((await run('say #general by name'))!, /Posted/);
  await run(`todd <#${CH}>`); assert.equal(todd(), 1);
  await run('status Counting Polygons'); assert.equal(db.meta('status.custom'), 'Counting Polygons'); assert.ok(presence());
  await run('status clear'); assert.equal(db.meta('status.custom'), '');
  assert.match((await run('dance'))!, /Unknown console command/);
  await assert.rejects(run('say #nowhere hi'), /No channel called/);
  assert.match(await consoleFromDm('> servers'), /The Render Room/);
  assert.match(await consoleFromDm('>say #nowhere hi'), /No channel called/);
});

test('console: leave asks first, then needs the exact id', async () => {
  const { run, left } = setup();
  assert.match((await run('leave render room'))!, new RegExp(`leave ${G} confirm`));
  assert.equal(left(), false);
  assert.match((await run('leave render room confirm'))!, /confirm with the id/);
  assert.equal(left(), false);
  assert.match((await run(`leave ${G} confirm`))!, /Left The Render Room/);
  assert.equal(left(), true);
});

test('console: run any command as the owner', async () => {
  const { db, run, ctx } = setup();
  await execute(find('balance')!, ctx(B), {});
  const before = balance(db, wallet(G, B));
  const out = (await run(`run ${G} give <@${B}> 500 contest prize`))!;
  assert.match(out, /granted|500/i);
  assert.equal(balance(db, wallet(G, B)) - before, polygons(500));
});

test('console: Polygon rain pays the first few grabbers once each', async () => {
  const { db, run, sent, ctx } = setup();
  await execute(find('balance')!, ctx(A), {});
  assert.match((await run(`rain ${CH} 300 2`))!, /Rain started/);
  const id = (sent.at(-1)!.components as { components: { custom_id: string }[] }[])[0]!.components[0]!.custom_id;
  const replies: string[] = [];
  const press = (u: string) => onRainButton({ customId: id, channelId: CH, user: { id: u, username: u, globalName: null }, reply: async (r: { content: string }) => { replies.push(r.content); }, message: { edit: async () => {} } } as unknown as ButtonInteraction);
  const before = balance(db, wallet(G, A));
  await press(A); assert.match(replies.at(-1)!, /You caught/);
  assert.equal(balance(db, wallet(G, A)) - before, polygons(150));
  await press(A); assert.match(replies.at(-1)!, /already grabbed/);
  await press(B); assert.match(replies.at(-1)!, /You caught/);   // opens an account for a new player too
  await press('333333333333333333'); assert.match(replies.at(-1)!, /stopped/);
  assert.equal(await onRainButton({ customId: 'shop:1' } as unknown as ButtonInteraction), false);
});

test('embed titles link to the matching site page', () => {
  assert.equal(siteLink('The market'), 'https://renderproductions.github.io/rend-conomy/');
  assert.equal(siteLink('Render Room (RRM)'), 'https://renderproductions.github.io/rend-conomy/rrm/');
  assert.equal(siteLink('Some Player Co (ZZZ)'), 'https://renderproductions.github.io/rend-conomy/exchange/co/?t=ZZZ');
  assert.equal(siteLink('Founded: Some Player Co (ZZZ)'), 'https://renderproductions.github.io/rend-conomy/exchange/co/?t=ZZZ');
  assert.equal(siteLink('🌾 Ana\'s farm'), 'https://renderproductions.github.io/play/#farm');
  assert.equal(siteLink('Bet placed'), undefined);
});

test('fun commands: 8ball, rate (same thing, same score) and fortune', async () => {
  const { ctx } = setup();
  const text = (r: { embeds?: { description?: string }[] }) => r.embeds?.[0]?.description ?? '';
  assert.match(text(await execute(find('8ball')!, ctx(A), { question: 'Will RRM go up?' })), /Will RRM go up\?/);
  const r1 = text(await execute(find('rate')!, ctx(A), { thing: 'pineapple pizza' }));
  const r2 = text(await execute(find('rate')!, ctx(B), { thing: 'Pineapple Pizza ' }));
  assert.equal(/(\d+)\/10/.exec(r1)![1], /(\d+)\/10/.exec(r2)![1]);
  assert.match(text(await execute(find('fortune')!, ctx(A), {})), /Lucky numbers/);
});

test('items: names and ids resolve to the inventory, the fish bag or the basket', () => {
  const r = (t: string) => { const x = resolveItem(t); return x && `${x.id}|${x.where}`; };
  assert.equal(r('coffee'), 'coffee|inventory');
  assert.equal(r('col_snowglobe'), 'col_snowglobe|inventory');
  assert.equal(r('snow globe'), 'col_snowglobe|inventory');
  assert.equal(r('white whale'), 'fish_whale|fish bag');
  assert.equal(r('fish_minnow'), 'fish_minnow|fish bag');
  assert.equal(r('carrot'), 'crop_carrot|basket');
  assert.equal(r('carrots'), 'crop_carrot|basket');
  assert.equal(r('golden pumpkin'), 'crop_golden_pumpkin|basket');
  assert.equal(r('rainbow polygon fruit'), 'crop_rainbow_polyfruit|basket');
  assert.equal(r('square pumpkin'), 'crop_squarepumpkin|basket');
  assert.equal(r('carrot seeds'), 'seed_carrot|inventory');
  assert.equal(r('definitely not an item'), null);
});

test('console: additem and removeitem by player name, with amounts', async () => {
  const { db, run, ctx } = setup();
  await execute(find('balance')!, ctx(B), {});
  db.run('UPDATE players SET name = ? WHERE user_id = ?', 'NachoBell', B);
  assert.match((await run(`additem ${G} nacho 3 golden pumpkin`))!, /Gave 3 × Golden Pumpkin .*basket/);
  assert.match((await run(`additem ${G} <@${B}> white whale x2`))!, /Gave 2 × White Whale .*fish bag/);
  assert.match((await run(`removeitem ${G} ${B} 10 golden pumpkin`))!, /Took 3 × Golden Pumpkin/);
  assert.match((await run(`additem ${G} nobody coffee`))!, /No player called/);
  assert.match((await run(`additem ${G} ${B} unobtainium`))!, /No item called/);
});
