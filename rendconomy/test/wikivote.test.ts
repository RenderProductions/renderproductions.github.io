import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshDb, eastern } from './helpers';
import { featured, findPage, tally, vote, wikiPages, wikiSnapshot } from '../src/site/wikivote';
import { weekOf } from '../src/city/state';
import { find } from '../src/commands';
import { execute } from '../src/discord/router';
import { botConfig } from '../src/config';
import { seededRng } from '../src/core/rng';
import type { Ctx, ReplyObject } from '../src/commands/types';

const A = '111111111111111111', B = '222222222222222222', C = '333333333333333333';
const text = (r: ReplyObject) => [r.content ?? '', ...(r.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');

test('the wiki\'s page list comes from its search index (pages, not sections)', () => {
  const pages = wikiPages();
  assert.ok(pages.length >= 20, `${pages.length} pages`);
  assert.ok(pages.some((p) => p.slug === 'fishing'));
  assert.ok(!pages.some((p) => p.url.includes('#')));
  assert.equal(findPage('main street')?.slug, 'main-street');
  assert.equal(findPage('fish')?.slug, 'fishing');
  assert.equal(findPage('zz'), undefined);
});

test('Featured page: one vote a week per player, the winner is featured next week, ties go to the first vote', () => {
  const db = freshDb();
  const mon = eastern('2026-11-23T12:00', -5), nextMon = eastern('2026-11-30T12:00', -5), after = eastern('2026-12-07T12:00', -5);
  const pages = wikiPages();
  const fishing = findPage('fishing')!, farming = findPage('farming')!;
  const first = featured(db, mon, pages)!;
  assert.equal(first.by, 'pick', 'nobody has voted yet');
  assert.equal(featured(db, mon + 3600_000, pages)!.page.slug, first.page.slug, 'decided once for the week');
  vote(db, A, farming, mon + 1000);
  vote(db, B, fishing, mon + 2000);
  vote(db, C, fishing, mon + 3000);
  assert.equal(vote(db, A, fishing, mon + 4000).changed, true, 'changing your vote');
  vote(db, A, farming, mon + 5000);
  assert.deepEqual(tally(db, weekOf(mon)).map((r) => [r.page, r.votes]), [['fishing', 2], ['farming', 1]]);
  const f = featured(db, nextMon, pages)!;
  assert.equal(f.page.slug, 'fishing'); assert.equal(f.votes, 2); assert.equal(f.by, 'vote');
  const later = featured(db, after, pages)!;
  assert.equal(later.page.slug, 'fishing'); assert.equal(later.by, 'held', 'no votes: it stays up');
  assert.equal(wikiSnapshot(db, after)!.featured.slug, 'fishing');
});

test('r!wiki shows the featured page and takes votes', async () => {
  const db = freshDb();
  const now = eastern('2026-11-25T12:00', -5);
  const ctx = (): Ctx => ({ db, config: botConfig(), rng: seededRng(1), now, guildId: 'g', channelId: 'c', user: { id: A, name: 'A' }, isOwner: false, isMod: false, notes: [] });
  assert.match(text(await execute(find('wiki')!, ctx(), {})), /Featured this week[\s\S]*No votes yet/);
  assert.match(text(await execute(find('wiki')!, ctx(), { action: 'vote main street' })), /You voted for \*\*\[Main Street\]/);
  assert.match(text(await execute(find('wiki')!, ctx(), {})), /1\. Main Street · 1 vote[\s\S]*You voted for Main Street/);
  assert.match(text(await execute(find('wiki')!, ctx(), { action: 'vote', page: 'nope nope' })), /no wiki page called/);
  assert.match(text(await execute(find('wiki')!, ctx(), { action: 'pages' })), /Every wiki page[\s\S]*`fishing`/);
});
