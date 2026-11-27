import { test } from 'node:test';
import assert from 'node:assert/strict';
import { welcomeMessage } from '../src/discord/welcome';
import { find } from '../src/commands';

test('the welcome message for new servers: real commands, working links, within Discord\'s limits', () => {
  const m = welcomeMessage('r!');
  const d = m.embeds[0]!.description;
  assert.ok(d.length < 4096);
  for (const name of ['daily', 'work', 'apply', 'shop', 'fish', 'farm', 'slots', 'help']) assert.ok(find(name), `r!${name} exists`);
  assert.match(d, /r!daily/);
  assert.match(d, /bot\/terms\//);
  assert.equal(m.components[0]!.components.length, 3);
  for (const b of m.components[0]!.components) assert.match(b.url, /^https:\/\//);
});
