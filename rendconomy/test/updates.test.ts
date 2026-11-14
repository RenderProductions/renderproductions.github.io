import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PATCH_NOTES_FILE, newestUpdate, readNewestUpdate, toMarkdown, updateEmbed } from '../src/site/updates';

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
