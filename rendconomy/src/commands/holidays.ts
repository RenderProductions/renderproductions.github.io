// Polygon Holidays: /advent and /santa. Both only do anything in December.
import { awardHere } from '../achievements/achievements';
import { GameError } from '../core/errors';
import { balance } from '../core/ledger';
import { format, parseAmount } from '../core/money';
import { emojiOr } from '../discord/emoji';
import { itemE } from '../discord/icons';
import { embed } from '../discord/style';
import { DOORS, HOLIDAY, draw, drawn, holidayDay, isHoliday, join, leave, openDoors, openedDoors, santaRow, santaRows, season, signupsOpen, wrapGift } from '../holidays/holidays';
import { count, takeItem } from '../shop/inventory';
import { HOLIDAY_COLLECTIBLES, anyItem, findItem } from '../shop/items';
import { me } from './shared';
import type { Command, Ctx } from './types';

const notYet = (ctx: Ctx, what: string) => new GameError('holiday.off', `${what} ${isHoliday(ctx.now) ? '' : 'runs in December. See you on December 1! 🎄'}`.trim());
const itemLabel = (id: string, qty = 1) => { const it = anyItem(id); return it ? `${itemE(id, it.emoji)} ${qty > 1 ? `${qty} × ` : ''}${it.name}` : id; };

export const advent: Command = {
  name: 'advent', aliases: ['calendar', 'door'], description: 'Open today\'s door of the advent calendar (December)', system: 'social', guildOnly: true,
  run(ctx) {
    if (!isHoliday(ctx.now)) throw notYet(ctx, 'The advent calendar');
    const { guildId } = me(ctx);
    return ctx.db.tx(() => {
      const opened = openDoors(ctx.db, guildId, ctx.user.id, ctx.now);
      const done = new Set(openedDoors(ctx.db, guildId, ctx.user.id, season(ctx.now)));
      if (done.size >= HOLIDAY.doors) awardHere('every_door');
      const grid: string[] = [];
      for (let r = 0; r < 5; r++) grid.push(Array.from({ length: 5 }, (_, c) => (done.has(r * 5 + c + 1) ? emojiOr('advent_open', '🌟') : emojiOr('advent', '🚪'))).join(''));
      const today = Math.min(holidayDay(ctx.now), HOLIDAY.doors);
      const lines = opened.map(({ day, door, paid }) =>
        `**Door ${day}:** ${[door.item ? itemLabel(door.item, door.qty) : null, paid ? `**${format(paid)}**` : null].filter(Boolean).join(' and ')}`);
      return {
        content: grid.join('\n'),
        embeds: [embed('social', '🎄 Advent calendar', [
          opened.length ? (opened.length > 1 ? `You open ${opened.length} doors.` : 'You open today\'s door.') : `Door ${today} is already open. ${today < HOLIDAY.doors ? `Door ${today + 1} opens tomorrow.` : 'That was the last one. Merry Christmas!'}`,
          ...lines,
          '', `-# ${done.size} of ${HOLIDAY.doors} doors open. Missed one? You can still open it, any time in December.`
        ])]
      };
    });
  }
};

export const santa: Command = {
  name: 'santa', aliases: ['secretsanta', 'ss'], description: 'Secret Santa: sign up, see who you\'re shopping for, and wrap a gift (December)', system: 'social', guildOnly: true,
  options: [
    { name: 'action', type: 'string', description: 'Blank for your status, or: join, leave, gift' },
    { name: 'amount', type: 'string', description: 'For gift: Polygons to give (no fee)' },
    { name: 'item', type: 'string', description: 'For gift: an item from your inventory, then "| a note" if you like' },
    { name: 'note', type: 'string', description: 'For gift: a note, read on Christmas morning' }
  ],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const P = ctx.config.prefix;
    const word = String(args.action ?? '').trim().toLowerCase();
    const year = season(ctx.now), day = holidayDay(ctx.now);
    if (!isHoliday(ctx.now) && !santaRow(ctx.db, guildId, ctx.user.id, year)) throw notYet(ctx, 'Secret Santa');
    const state = draw(ctx.db, guildId, ctx.now, ctx.rng);
    const people = santaRows(ctx.db, guildId, year).length;
    const say = (lines: (string | null)[]) => ({ embeds: [embed('social', '🎅 Secret Santa', lines)] });

    if (word === 'join' || word === 'signup') {
      if (!signupsOpen(ctx.now)) throw new GameError('santa.closed', `Sign-ups closed on December ${HOLIDAY.signupLastDay}.`);
      join(ctx.db, guildId, ctx.user.id, ctx.now);
      const n = santaRows(ctx.db, guildId, year).length;
      return say([`${emojiOr('secretsanta', '🎅')} You're in! ${n} ${n === 1 ? 'person has' : 'people have'} signed up in this server so far.`,
        `Names are drawn on **December ${HOLIDAY.drawDay}**, and the bot will DM you who you're shopping for. Gifts are opened on **Christmas morning**.`]);
    }
    if (word === 'leave') {
      if (!leave(ctx.db, guildId, ctx.user.id, ctx.now)) throw new GameError('santa.leave', drawn(ctx.db, guildId, year) ? 'Names have been drawn, so it\'s too late to leave. Someone\'s counting on you!' : 'You haven\'t signed up.');
      return say(['You\'ve left Secret Santa. Changed your mind? `' + P + 'santa join` before the draw.']);
    }
    const me_ = santaRow(ctx.db, guildId, ctx.user.id, year);
    if (word === 'gift' || word === 'wrap') {
      if (state !== 'drawn' || !me_?.target_id) throw new GameError('santa.notdrawn', state === 'cancelled' ? 'Secret Santa is off in this server this year.' : `Names are drawn on December ${HOLIDAY.drawDay}. Gift after that.`);
      if (me_.gifted_at) throw new GameError('santa.done', 'Your gift is already wrapped and under the tree.');
      if (!isHoliday(ctx.now) || day >= HOLIDAY.revealDay) throw new GameError('santa.late', 'Christmas has come and gone. Next year!');
      // "r!santa gift 500 coffee | Merry Christmas!": everything after the | is the note
      const all = `${String(args.amount ?? '')} ${String(args.item ?? '')}`;
      const bar = all.indexOf('|');
      const note = (bar >= 0 ? all.slice(bar + 1) : String(args.note ?? '')).replace(/[`*_~]/g, '').trim().slice(0, 200);
      const before = bar >= 0 ? all.slice(0, bar).trim().split(/\s+/) : [String(args.amount ?? '').trim(), String(args.item ?? '').trim()];
      let amountText = (before[0] ?? '').trim(), itemText = before.slice(1).join(' ').trim();
      if (amountText && !/^[\d.,]+[kmb]?$/i.test(amountText)) { itemText = `${amountText} ${itemText}`.trim(); amountText = ''; }
      const cents = amountText ? parseAmount(amountText, { min: HOLIDAY.giftMin }) : 0;
      if (cents > HOLIDAY.giftMax) throw new GameError('santa.max', `Secret Santa gifts go up to ${format(HOLIDAY.giftMax)}.`);
      const item = itemText ? findItem(itemText) : null;
      if (itemText && (!item || !count(ctx.db, guildId, ctx.user.id, item))) throw new GameError('santa.item', `You don't have ${itemText ? `a "${itemText}"` : 'that'} to give.`);
      if (!cents && !item) throw new GameError('santa.empty', `Wrap Polygons, an item, or both: \`${P}santa gift 500\`, \`${P}santa gift snow globe\`, \`${P}santa gift 500 coffee\`.`);
      if (balance(ctx.db, wallet) < cents) throw new GameError('funds.short', `The balance is ${format(balance(ctx.db, wallet))}.`);
      ctx.db.tx(() => {
        if (item) takeItem(ctx.db, guildId, ctx.user.id, item);
        wrapGift(ctx.db, guildId, ctx.user.id, cents, item, note, ctx.now);
      });
      awardHere('secret_santa');
      if (item && HOLIDAY_COLLECTIBLES[item]) awardHere('regift');
      return say([`🎁 You wrap ${[cents ? `**${format(cents)}**` : null, item ? itemLabel(item) : null].filter(Boolean).join(' and ')} for <@${me_.target_id}> and slip it under the tree.`,
        note ? `With a note: *"${note}"*` : `-# Add a note next time with \`${P}santa gift 500 | Merry Christmas!\``,
        'They\'ll find out who it was from on Christmas morning. No fee, Santa\'s orders.']);
    }

    // status
    const fromMe = me_;
    const forMe = santaRows(ctx.db, guildId, year).find((r) => r.target_id === ctx.user.id);
    if (!fromMe) return say([signupsOpen(ctx.now) ? `Sign-ups are open until **December ${HOLIDAY.signupLastDay}**: \`${P}santa join\`. ${people} ${people === 1 ? 'person has' : 'people have'} signed up so far.` : 'You didn\'t sign up for Secret Santa this year. There\'s always next December!']);
    if (state === 'waiting') return say([`You're signed up, along with ${people - 1} ${people - 1 === 1 ? 'other' : 'others'}. Names are drawn on **December ${HOLIDAY.drawDay}**.`, `-# Changed your mind? \`${P}santa leave\``]);
    if (state === 'cancelled') return say(['Secret Santa is off in this server this year: it needs at least 3 people.']);
    return say([
      `You're shopping for <@${fromMe.target_id}>.`,
      fromMe.gifted_at ? `🎁 Under the tree: ${[fromMe.gift_cents ? `**${format(fromMe.gift_cents)}**` : null, fromMe.gift_item ? itemLabel(fromMe.gift_item) : null].filter(Boolean).join(' and ')}.${fromMe.note ? ` Note: *"${fromMe.note}"*` : ''}${fromMe.delivered ? ' Delivered!' : ''}`
        : `Nothing wrapped yet: \`${P}santa gift <amount> [item]\`, before Christmas.`,
      forMe?.delivered ? `\nYour own Secret Santa was <@${forMe.user_id}>.${forMe.note ? ` Their note: *"${forMe.note}"*` : ''}` : day >= HOLIDAY.revealDay || !isHoliday(ctx.now) ? null : `\nSomeone is shopping for you too. You'll find out who on Christmas morning.`
    ]);
  }
};

export const holidayCommands = [advent, santa];
