import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setCustomEmojis, EMOJI_DIR } from '../src/discord/emoji';
import { PATCH_NOTES_FILE, allUpdates, findUpdate, newestUpdate, pendingUpdates, readAllUpdates, readNewestUpdate, toMarkdown, updateEmbed } from '../src/site/updates';

test('the real patch notes page parses into an update', () => {
  assert.ok(fs.existsSync(PATCH_NOTES_FILE), 'the bot finds patch-notes/index.html in the repo');
  const u = readNewestUpdate()!;
  assert.ok(u.id && u.title && u.sections.length > 0, JSON.stringify(u).slice(0, 200));
  const e = updateEmbed(u);
  const size = (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0) + (e.footer?.text.length ?? 0);
  assert.ok(size <= 6000, `within Discord's 6,000 characters (${size})`);
  for (const f of e.fields ?? []) assert.ok(f.value.length <= 1024 && f.name.length <= 256);
  assert.match(e.url!, /patch-notes\/#/);
});

test('HTML becomes Discord markdown', () => {
  assert.equal(toMarkdown('<span class="tag new">NEW</span><span><strong>Fishing</strong> with <code>r!fish</code> &amp; more</span>'), '🆕 **Fishing** with `r!fish` & more');
  const u = newestUpdate(`<article class="log release" id="x"><div class="label"><span class="tag live">LATEST</span><span>Dec 2026</span></div><h2>Big One</h2><p>Intro.</p><h3>A</h3><ul><li>one</li><li>two</li></ul><p>Thanks.</p></article><article class="log" id="old"><h2>Old</h2></article>`)!;
  assert.deepEqual([u.id, u.title, u.date, u.intro, u.outro], ['x', 'Big One', 'Dec 2026', 'Intro.', 'Thanks.']);
  assert.deepEqual(u.sections, [{ heading: 'A', items: ['one', 'two'] }]);
});

test('update posts use the bot\'s own emojis once they are uploaded, and flag hotfixes', () => {
  const html = '<article class="log release" id="x"><div class="label"><span class="tag live">LATEST</span><span class="tag fix">HOTFIX</span><span>November 2026</span></div><h2>Fix</h2><p>Intro.</p>'
    + '<h3>A</h3><ul><li><span class="tag fix">FIXED</span><span>One</span></li><li><span class="tag removed">REMOVED</span><span>Two</span></li></ul></article>';
  let u = newestUpdate(html)!;
  assert.equal(u.hotfix, true);
  assert.equal(u.date, 'November 2026');
  assert.deepEqual(u.sections[0]!.items, ['🩹 One', '🗑️ Two'], 'standard emojis until uploaded');
  assert.match(updateEmbed(u).description!, /^🔥 \*\*Hotfix\*\*/);
  assert.deepEqual(setCustomEmojis([{ name: 'rc_fixed', id: '123' }, { name: 'rc_hotfix', id: '456' }, { name: 'something_else', id: '9' }]), ['fixed', 'hotfix']);
  u = newestUpdate(html)!;
  assert.deepEqual(u.sections[0]!.items, ['<:rc_fixed:123> One', '🗑️ Two']);
  assert.match(updateEmbed(u).description!, /^<:rc_hotfix:456> \*\*Hotfix\*\*/);
});

test('an emoji image on the patch notes page becomes the bot\'s emoji in the post', () => {
  assert.equal(toMarkdown('<img class="emoji" data-emoji="hotfix" src="/bot/emojis/rc_hotfix.png" alt=""><strong>Hotfix:</strong> quick'), '<:rc_hotfix:456> **Hotfix:** quick');
  assert.equal(toMarkdown('<img class="emoji" data-emoji="nope" src="x.png">Text'), 'Text', 'unknown names are dropped');
});

test('restarts post every entry added since the last post, oldest first; /announce finds entries by name', () => {
  const page = ['c', 'b', 'a'].map((id) => `<article class="log release" id="${id}"><h2>Entry ${id.toUpperCase()}</h2><p>x</p></article>`).join('');
  const all = allUpdates(page);
  assert.deepEqual(all.map((e) => e.id), ['c', 'b', 'a']);
  assert.deepEqual(pendingUpdates(all, 'a').map((e) => e.id), ['b', 'c'], 'both new ones, oldest first');
  assert.deepEqual(pendingUpdates(all, 'c'), [], 'nothing new');
  assert.deepEqual(pendingUpdates(all, null).map((e) => e.id), ['c'], 'a fresh bot posts only the newest');
  assert.deepEqual(pendingUpdates(all, 'gone').map((e) => e.id), ['c']);
  assert.equal(findUpdate(all, 'entry b')!.id, 'b');
  assert.equal(findUpdate(all, '')!.id, 'c');
  assert.equal(findUpdate(all, 'nope'), null);
  // the real page: the next restart posts Animation Expansion, Glossy Makeover, farming, Polygon Holidays, The Loose Ends, Center Stage, Redeem Yourself, then Hold the Line
  const real = readAllUpdates();
  assert.deepEqual(pendingUpdates(real, 'rendconomy').map((e) => e.id), ['animation-expansion', 'glossy-makeover', 'plants-in-this-economy', 'polygon-holidays', 'the-loose-ends', 'center-stage', 'redeem-yourself', 'hold-the-line', 'connections-pt-2', 'off-the-clock', 'patrons-of-the-reserve', 'business-numbers-working', 'iso-chess-the-march', 'room-to-grow', 'make-it-stop', 'late-night-november-16']);
  assert.equal(findUpdate(real, 'animation')!.id, 'animation-expansion');
});

test('a plain CHANGED tag (class="tag") becomes the changed emoji too', () => {
  assert.equal(toMarkdown('<span class="tag">CHANGED</span><span>Balance and portfolio are one view</span>'), '🔧 Balance and portfolio are one view');
});

test('a section full of custom emojis carries on in a second field instead of being cut off', () => {
  setCustomEmojis(fs.readdirSync(EMOJI_DIR).filter((f) => /^rc_.*\.png$/.test(f)).map((f, i) => ({ name: f.slice(0, -4), id: String(1_400_000_000_000_000_000n + BigInt(i)) })));
  try {
    const e = updateEmbed(findUpdate(readAllUpdates(), 'polygon holidays')!);
    const fields = e.fields ?? [];
    assert.ok(fields.every((f) => f.value.length <= 1024), 'every field fits');
    assert.ok(!fields.some((f) => /and more on the patch notes/.test(f.value)), 'nothing cut off');
    assert.ok(fields.some((f) => f.name === '\u200b'), 'a long section carried on');
    assert.ok(JSON.stringify(e).length < 6000, 'the embed fits');
    assert.match(fields.map((f) => f.value).join('\n'), /<:rc_advent:\d+>/);
  } finally { setCustomEmojis([]); }
});

test('a Quick Add entry is flagged like a hotfix', () => {
  const html = '<article class="log release" id="q"><div class="label"><span class="tag live">LATEST</span><span class="tag quick">QUICK ADD</span><span>November 2026</span></div><h2>Small thing</h2><p>Intro.</p>'
    + '<h3>NEW</h3><ul><li><span class="tag new">NEW</span><span>A thing</span></li></ul></article>';
  const u = newestUpdate(html)!;
  assert.equal(u.quick, true);
  assert.equal(u.hotfix, false);
  assert.match(updateEmbed(u).description!, /^(⚡|<:rc_quickadd:\d+>) \*\*Quick Add\*\*/);
});
