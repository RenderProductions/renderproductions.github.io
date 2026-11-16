// Off the Clock: silly commands that never touch the economy. No Polygons in, none out.
import { embed } from '../discord/style';
import { GameError } from '../core/errors';
import type { Command } from './types';

const EIGHT_BALL = [
  // yes
  'Yes. TODD would bet the farm on it, and TODD has bet worse.', 'Absolutely. Buy the dip.', 'All signs point to yes.',
  'The Reserve has spoken: yes.', 'Without a doubt.', 'Yes, but tell no one.',
  // maybe
  'Ask again after the market opens.', 'The lake is murky. Try again.', 'TODD is on break. Ask later.',
  'Hard to say. The chart looks like a heartbeat.', 'Maybe. Marquez is giving you a look.',
  // no
  'No. Not even with a Hard Hat.', 'TODD says no, and TODD is wrong about most things, so... still no.',
  'Absolutely not.', 'The crows have voted. No.', 'Short it.'
];

const FORTUNES = [
  'The market smiles upon carrots.', 'A golden pumpkin is closer than you think.', 'Do not trust a broker who smiles.',
  'Your next shift will be strangely quiet.', 'Someone in this server owes you Polygons. They know who they are.',
  'The White Whale remembers you.', 'Water your plants. They notice.', 'A crash is just a sale with bad lighting.',
  'Today is a good day to diversify.', 'TODD will offer you a loan. Think it over twice.', 'Beware the 7th spin.',
  'The Reserve is not infinite, and neither is your luck.', 'You will find a boot. Treasure it anyway.',
  'An old friend will buy shares in your company.', 'What goes up must be shorted.', 'Patience is a dividend.',
  'Your fortune is in another cookie.', 'The frequency is clearer at night.', 'Sell high. Brag responsibly.',
  'A snow globe holds more than snow.'
];

/** Same thing, same score: a quick string hash so r!rate is consistent. */
function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s.toLowerCase().trim()) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const eightBall: Command = {
  name: '8ball', aliases: ['eightball', 'ask'], description: 'Ask the magic 8-ball a yes-or-no question', system: 'general',
  options: [{ name: 'question', type: 'string', description: 'Your question', required: true }],
  run(ctx, args) {
    const q = String(args.question ?? '').trim();
    if (!q) throw new GameError('fun.noq', 'Ask it something.');
    return { embeds: [embed('general', '🎱 The magic 8-ball', [`> ${q.slice(0, 300)}`, '', `**${ctx.rng.pick(EIGHT_BALL)}**`])] };
  }
};

export const rate: Command = {
  name: 'rate', description: 'TODD rates anything out of 10 (badly)', system: 'general',
  options: [{ name: 'thing', type: 'string', description: 'What should TODD rate?', required: true }],
  run(ctx, args) {
    const thing = String(args.thing ?? '').replace(/@(everyone|here)/g, '@​$1').trim();
    if (!thing) throw new GameError('fun.nothing', 'Rate what?');
    const n = hash(thing) % 11;
    const say = n === 10 ? 'Perfect. No notes. TODD is emotional.' : n >= 8 ? 'Very good. TODD would invest.' : n >= 6 ? 'Solid. TODD respects it.'
      : n >= 4 ? 'Mid. TODD has seen better. TODD has seen worse.' : n >= 2 ? 'Rough. TODD is concerned.' : n === 1 ? 'Oof. TODD looked away.' : 'Zero. TODD is filing a complaint.';
    return { embeds: [embed('general', '📋 TODD rates it', [`**${thing.slice(0, 200)}**`, '', `${'🟩'.repeat(n)}${'⬛'.repeat(10 - n)}  **${n}/10**`, say])] };
  }
};

export const fortune: Command = {
  name: 'fortune', aliases: ['cookie'], description: 'Crack open a fortune cookie from the counter at Marquez\'s', system: 'general',
  run(ctx) {
    const lucky = Array.from({ length: 5 }, () => ctx.rng.int(1, 60)).join(' · ');
    return { embeds: [embed('general', '🥠 Fortune cookie', [`*${ctx.rng.pick(FORTUNES)}*`, '', `-# Lucky numbers: ${lucky}`])] };
  }
};

export const funCommands = [eightBall, rate, fortune];
