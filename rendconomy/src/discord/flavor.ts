// A little life for replies: varied lines for the same moment, and the short "suspense" embeds shown
// before a result (see ReplyObject.teaser). The narrator stays clear and to the point; the world around
// them (the lake, the Rend-Sino, Marquez, TODD) is allowed some character.
import type { APIEmbed } from 'discord.js';
import type { Rng } from '../core/rng';

export const LINES = {
  fishNothing: ['Not a single bite.', 'You wait... and wait. Nothing.', 'A fish nibbles, then swims off laughing at you.', 'The bobber never moves.', 'Something big swims past. It is not interested.'],
  fishBig: ['', '', ' Nice one!', ' **What a monster!**', ' ✨ **LEGENDARY!** The whole lake goes quiet.'],
  coinSpin: ['The coin spins through the air...', 'You flick the coin. It tumbles end over end...', 'The coin rings off your thumb...'],
  diceRoll: ['The dice tumble across the felt...', 'You shake, you throw...', 'The dice clatter against the wall...'],
  wheelSpin: ['The ball rattles around the wheel...', 'The croupier spins the wheel...', 'Clack, clack, clack... the wheel slows...'],
  reels: ['The reels spin...', 'Whirr... click... click...', 'Lights flash. The reels blur...'],
  win: ['Winner!', 'The house pays out.', 'Luck is on your side.', 'Nicely done.'],
  bigWin: ['**The whole floor turns to look.**', '**Jackpot energy.**', '**TODD sighs and counts out the Polygons.**'],
  loss: ['The house thanks you for your contribution.', 'Not this time.', 'TODD pockets the chips with a grin.', 'So close. Probably.'],
  workFast: ['Smooth.', 'Textbook.', 'The manager nods approvingly.', 'Employee of the month material.', 'Clean work.'],
  workOk: ['Done and dusted.', 'That will do.', 'Another one in the books.', 'Solid.'],
  workSlow: ['The manager taps their watch.', 'Someone else had to finish it.', 'The clock wins this round.'],
  workWrong: ['The manager sighs.', 'Close, but no.', 'That one goes back for corrections.'],
  gift: ['Wrapped with care.', 'Generosity looks good on you.', 'Somebody\'s day just got better.'],
  dailyHello: ['Rise and shine.', 'Another day, another Polygon.', 'Payday from the Reserve.', 'The Reserve opens its doors.', 'Good to see you back.']
} satisfies Record<string, string[]>;

export const line = (rng: Rng, key: keyof typeof LINES): string => rng.pick(LINES[key]);

/** A teaser embed in a system's color, shown for `ms` before the result. */
export const teaser = (title: string, text: string, color: number, ms = 1800): { embeds: APIEmbed[]; ms: number } => ({ embeds: [{ title, description: text, color }], ms });
