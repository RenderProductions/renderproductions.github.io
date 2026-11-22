import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WIKI_DATA_FILE, wikiJson } from '../src/site/wiki';

test('the wiki\'s numbers match the bot (run `npm run wiki` after changing them)', () => {
  assert.ok(fs.existsSync(WIKI_DATA_FILE), 'wiki/data.json is missing: run npm run wiki');
  assert.equal(fs.readFileSync(WIKI_DATA_FILE, 'utf8'), wikiJson(), 'wiki/data.json is out of date: run npm run wiki');
});
