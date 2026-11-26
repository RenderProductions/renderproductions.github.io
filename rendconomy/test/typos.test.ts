import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commands, suggest, typoDistance } from '../src/commands';
import { didYouMean } from '../src/discord/router';

test('typo distance counts swaps as one edit', () => {
  assert.equal(typoDistance('vop', 'vip'), 1);
  assert.equal(typoDistance('balnace', 'balance'), 1);
  assert.equal(typoDistance('fihs', 'fish'), 1);
  assert.equal(typoDistance('vip', 'vip'), 0);
});

test('a mistyped command gets a suggestion with the rest of the line', () => {
  assert.equal(didYouMean('r!vop spin', 'r!'), 'Did you mean `r!vip spin`?');
  assert.equal(suggest('wrok'), 'work');
  assert.equal(suggest('blackjak'), 'blackjack');
});

test('nothing close means no suggestion', () => {
  assert.equal(didYouMean('r!zzzzzz', 'r!'), null);
  assert.equal(didYouMean('r!x', 'r!'), null);
  assert.equal(suggest('hello there'), undefined);
});

test('hidden commands are never suggested', () => {
  for (const c of commands.filter((x) => x.hidden)) {
    for (const w of [c.name, ...(c.aliases ?? [])]) {
      const typo = w.length > 3 ? w.slice(0, -1) + (w.endsWith('z') ? 'y' : 'z') : w + 'z';
      const s = suggest(typo);
      assert.ok(!s || ![c.name, ...(c.aliases ?? [])].includes(s), `${typo} suggested hidden ${s}`);
    }
  }
});
