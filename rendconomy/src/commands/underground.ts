// No Questions Asked: r!underground (the Connector), and his hijack of TODD's drop-ins on password nights.
import { award, awardHere } from '../achievements/achievements';
import { economy } from '../config';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer, wallet as walletOf } from '../core/ledger';
import { format, parseAmount, type Cents } from '../core/money';
import { dayKey, discordTime } from '../core/time';
import { emojiOr } from '../discord/emoji';
import { embed } from '../discord/style';
import { KINDS, hasPerk, lotAt, lotsOf, parseTile, saveLot, tileName } from '../estate/estate';
import { KEY as MARKET_KEY, TICKERS, nudge } from '../market/market';
import { addInbox } from '../social/inbox';
import {
  ALIASES, CONTRABAND, LOOT, UG, addHeat, charges, fencePrice, heatFor, heatNow, lootOf, markPosted, maybeRaid, nextOpen, nightCloses, nightKey, passwordToPost,
  raid, row, settlePlayer, stars, stockFor, tonight, type ContrabandId, type Night, type Raid, type Settled
} from '../underground/underground';
import { me } from './shared';
import type { Command, Ctx, ReplyObject } from './types';

const WHISPERS = ['Keep your voice down.', 'Don\'t say my name. Don\'t say yours either.', 'You weren\'t followed? Good.', 'Make it quick.', 'Psst. Over here.', 'I wasn\'t here. Neither were you.', 'Nobody saw you come in. Keep it that way.', 'There\'s a frequency out there. Tune it to RED SUIT. Or don\'t.'];
const BYES = ['Now get out of here.', 'We never talked.', 'Back door. Go.', 'Don\'t come back too soon.'];
const pick = <T>(ctx: Ctx, list: T[]): T => list[Math.floor(ctx.rng.next() * list.length)]!;
const ce = (): string => emojiOr('connector', '🎩');

export const heatBar = (heat: number): string => {
  const n = stars(heat);
  return emojiOr('heat', '★').repeat(n) + emojiOr('heat_off', '☆').repeat(5 - n);
};

/** The message the Connector leaves in place of one of TODD's drop-ins on a password night. */
export function connectorHijack(db: Ctx['db'], guildId: string, now: number): ReplyObject | null {
  const n = passwordToPost(db, guildId, now);
  if (!n || !n.password) return null;
  markPosted(db, guildId, n);
  return { embeds: [{
    author: { name: 'TODD has entered the chat' }, title: 'DR0P-1N', color: 0xd62839,
    description: [
      '~~First right answer wins.~~ ~~You have 60 seconds.~~',
      '',
      '**THE CONNECTOR HAS TAKEN CONTROL OF THIS INFERNAL MACHINE TO LEAVE YOU THIS!**',
      '',
      `${emojiOr('password', '🔐')} Tonight's password: ||**${n.password}**||`,
      n.where === 'alley' ? '-# The alley. Ten o\'clock. You didn\'t hear it from me.' : `-# ${tileName(n.lot)}. Ten o'clock. You didn't hear it from me.`
    ].join('\n')
  }] };
}

function raidLines(r: Raid): string[] {
  return [
    '**TODD kicks the door in.**',
    r.lost.length ? `Confiscated: ${r.lost.join(', ')}.` : 'He doesn\'t find much, which only makes him angrier.',
    r.fine > 0 ? `Fined **${format(r.fine)}** (to the Reserve).` : 'You had nothing to fine.',
    `Your Heat drops to ${heatBar(UG.raidHeat)}.`
  ];
}
const busted = (r: Raid): ReplyObject['embeds'] => [{ title: `${emojiOr('raid', '🚨')} BUSTED`, color: 0xd62839, description: raidLines(r).join('\n') }];

function settledLines(s: Settled[]): string[] {
  return s.map((x) => x.kind === 'laundered' ? `${emojiOr('launder', '🧺')} The shop sold ${x.what} out the back: **+${format(x.cents)}**, clean.`
    : x.kind === 'smuggled' ? `${emojiOr('smuggle', '⛵')} Your shipment made it across the lake: **+${format(x.cents)}** (${x.mult}x).`
    : `${emojiOr('raid', '🚨')} The harbor patrol caught your shipment. The ${format(x.stake)} is gone, and so is some of your cool.`);
}

/** The part everyone sees: Heat, loot, contraband and runs. */
function pockets(ctx: Ctx, g: string): string[] {
  const r = row(ctx.db, g, ctx.user.id, ctx.now);
  const heat = heatNow(ctx.db, g, ctx.user.id, ctx.now);
  const loot = lootOf(ctx.db, g, ctx.user.id);
  const held = [r.dice ? `${emojiOr('loaded_dice', '🎲')} Loaded Dice (${r.dice} games)` : null, r.fake_id ? `${emojiOr('fake_id', '🪪')} Fake ID` : null,
    r.lockpick ? `${emojiOr('lockpick', '🔓')} Lockpick Set` : null, r.smoke ? `${emojiOr('smoke_bomb', '💨')} Smoke Bomb` : null].filter(Boolean);
  return [
    `**Heat:** ${heatBar(heat)} (${Math.round(heat)}/100)${r.locked_until > ctx.now ? ` · locked out until ${discordTime(r.locked_until)}` : ''}`,
    loot.length ? `**Hot loot:** ${loot.map((l) => `${emojiOr(LOOT[l.kind].emoji, '🔥')} #${l.id} ${LOOT[l.kind].name.replace(/^an? /, '')} (${l.launder_until ? `laundering, done ${discordTime(l.launder_until)}` : `he'd pay ${format(fencePrice(l, ctx.now))}`})`).join(' · ')}` : null,
    held.length ? `**On you:** ${held.join(' · ')}` : null,
    r.smuggle_until && r.smuggle_stake ? `**Shipment:** ${format(r.smuggle_stake)} on the water, lands ${discordTime(r.smuggle_until)}` : null
  ].filter((x): x is string => !!x);
}

function where(ctx: Ctx, g: string, n: Night): string {
  if (n.where === 'alley') return `Police on every corner, so he's set up in **an alley off the map**. Every deal here brings ${Math.round((UG.alleyHeat - 1) * 100)}% more Heat.`;
  const l = lotAt(lotsOf(ctx.db, g, ctx.now), n.lot);
  const name = l ? KINDS[l.kind].name : 'place';
  return n.where === 'condemned' ? `He's squatting in **${tileName(n.lot)}**, the condemned ${name}.`
    : n.where === 'rundown' ? `Nothing's condemned, so he's squatting in **${tileName(n.lot)}**, the most run-down ${name} on the map. The owner won't be thrilled.`
    : `He's set up on the empty lot at **${tileName(n.lot)}**.`;
}

function shopView(ctx: Ctx, g: string, n: Night, extra: string[]): ReplyObject {
  const P = ctx.config.prefix;
  const stock = stockFor(g, n.night);
  return { embeds: [embed('underground', `${ce()} The Connector`, [
    ...extra, ...(extra.length ? [''] : []),
    `*"${pick(ctx, WHISPERS)}"*`,
    where(ctx, g, n) + ` Open until ${discordTime(nightCloses(n.night), 't')}.`,
    '',
    '**Tonight\'s shelf**',
    ...stock.map((id) => { const c = CONTRABAND[id]; return `${emojiOr(id, '📦')} **${c.name}** ${format(c.price)} · +${c.heat} Heat\n-# ${c.desc}`; }),
    '',
    ...pockets(ctx, g),
    '',
    `-# \`${P}ug buy <item>\` · \`${P}ug fence <#|all>\` · \`${P}ug launder <#> <your shop's tile>\` · \`${P}ug smuggle <amount>\` · \`${P}ug snitch @player\``
  ])] };
}

function closedView(ctx: Ctx, g: string, extra: string[], why: string): ReplyObject {
  return { embeds: [embed('underground', `${ce()} The Underground`, [...extra, ...(extra.length ? [''] : []), why, '', ...pockets(ctx, g)])] };
}

/** Throws unless the Connector will deal with this player right now. */
function open(ctx: Ctx, g: string): Night {
  const n = tonight(ctx.db, g, ctx.now);
  if (!n) throw new GameError('ug.closed', `The lot's empty. The Connector comes back ${discordTime(nextOpen(ctx.now))}.`);
  const r = row(ctx.db, g, ctx.user.id, ctx.now);
  if (r.locked_until > ctx.now) throw new GameError('ug.locked', `The door stays shut. You're too hot. Come back ${discordTime(r.locked_until)}.`);
  if (n.password && r.entered !== n.night) throw new GameError('ug.password', `A slot in the door slides open. One red eye, one blue. *"Password."*\n-# \`${ctx.config.prefix}underground <password>\``);
  return n;
}

/** After a shady action: Heat, then maybe a raid. Returns the reply. */
function shady(ctx: Ctx, g: string, baseHeat: number, lines: string[], title: string): ReplyObject {
  const heat = heatFor(tonight(ctx.db, g, ctx.now), baseHeat);
  const more = addHeat(ctx.db, g, ctx.user.id, heat, ctx.now);
  const r = maybeRaid(ctx.db, g, ctx.user.id, ctx.now, () => ctx.rng.next());
  const body = [...lines, `-# +${heat} Heat: ${heatBar(heatNow(ctx.db, g, ctx.user.id, ctx.now))}`, ...more];
  if (r) return { embeds: [embed('underground', title, body), ...busted(r)!] };
  return { embeds: [embed('underground', title, [...body, '', `*"${pick(ctx, BYES)}"*`])] };
}
const spend = (ctx: Ctx, g: string, cents: Cents): void => {
  ctx.db.run('UPDATE underground SET spent = spent + ? WHERE guild_id = ? AND user_id = ?', cents, g, ctx.user.id);
  const r = row(ctx.db, g, ctx.user.id, ctx.now);
  if (r.spent >= UG.cleanHands && r.raids === 0) awardHere('clean_hands');
};
const pay = (ctx: Ctx, g: string, w: string, cents: Cents, reason: string): void => {
  if (balance(ctx.db, w) < cents) throw new GameError('funds.short', `That's ${format(cents)}. You have ${format(balance(ctx.db, w))}. *"I don't do credit."*`);
  transfer(ctx.db, { from: w, to: RESERVE, cents, reason, guildId: g, actorId: ctx.user.id, now: ctx.now });
};

function buy(ctx: Ctx, g: string, w: string, n: Night, raw: string, extra: string): ReplyObject {
  const P = ctx.config.prefix;
  const id = (ALIASES[raw.toLowerCase().replace(/[\s_-]/g, '')] ?? raw.toLowerCase()) as ContrabandId;
  const c = CONTRABAND[id];
  if (!c) throw new GameError('ug.item', `*"Never heard of it."* Tonight he has: ${stockFor(g, n.night).map((x) => CONTRABAND[x].name).join(', ')}.`);
  if (!stockFor(g, n.night).includes(id)) throw new GameError('ug.stock', `*"Not tonight."* Tonight he has: ${stockFor(g, n.night).map((x) => CONTRABAND[x].name).join(', ')}.`);
  const args = extra.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  // check everything before taking the money
  if (id === 'insider_tip') {
    const t = (args[0] ?? TICKERS[Math.floor(ctx.rng.next() * TICKERS.length)]!).toUpperCase();
    if (!TICKERS.includes(t)) throw new GameError('ug.ticker', `He only has tips on ${TICKERS.join(', ')}.`);
    pay(ctx, g, w, c.price, 'ug.buy');
    const state = JSON.parse(ctx.db.meta(MARKET_KEY.state) ?? '{}') as { co?: Record<string, { trend?: number; mood?: { name?: string; trend?: number } }> };
    const s = state.co?.[t];
    let up = ((s?.mood?.trend ?? 0) + (s?.trend ?? 0)) >= 0;
    if (ctx.rng.next() < 0.2) up = !up;   // usually right
    const mood = s?.mood?.name;
    lines.push(`${emojiOr('insider_tip', '✉️')} He slides an envelope across. *"${t}. ${up ? 'Going up' : 'Going down'} this hour.${mood && mood !== 'normal' ? ` Word is it's in a ${mood}.` : ''} You didn't get this from me."*`);
  } else if (id === 'rumor_mill') {
    const t = (args[0] ?? '').toUpperCase(), dir = (args[1] ?? '').toLowerCase();
    if (!TICKERS.includes(t) || !/^(up|down)$/.test(dir)) throw new GameError('ug.rumor', `\`${P}ug buy rumor <${TICKERS.join('|')}> <up|down>\``);
    const key = `ug.rumor:${g}:${t}`;
    if (ctx.db.meta(key) === dayKey(ctx.now)) throw new GameError('ug.rumor.used', `*"Somebody already started a rumor about ${t} today. Two's suspicious."*`);
    pay(ctx, g, w, c.price, 'ug.buy');
    ctx.db.setMeta(key, dayKey(ctx.now));
    nudge(ctx.db, t, dir === 'up' ? UG.rumor : -UG.rumor);
    lines.push(`${emojiOr('rumor_mill', '📰')} *"Consider it whispered."* A rumor about **${t}** is going around. It'll move ${dir} on the next tick.`);
  } else if (id === 'squatter_crew') {
    const lot = parseTile(args[0]) ?? 0;
    const lots = lotsOf(ctx.db, g, ctx.now);
    const l = lotAt(lots, lot);
    if (!l) throw new GameError('ug.crew.lot', `\`${P}ug buy crew <tile>\`: someone else's place, under ${UG.crewBelow}%.`);
    if (l.status !== 'owned' || l.owner_id === ctx.user.id) throw new GameError('ug.crew.owner', `*"Whose place is that? Not someone else's."* Pick a place another player owns.`);
    if (l.condition >= UG.crewBelow) throw new GameError('ug.crew.nice', `*"Too nice. They'd get noticed."* It has to be under ${UG.crewBelow}%.`);
    if (l.squatters) throw new GameError('ug.crew.full', `*"Somebody's already in there."*`);
    if (Number(ctx.db.meta(`ug.crew:${g}:${lot}`) ?? 0) > ctx.now) throw new GameError('ug.crew.hot', '*"That place is crawling. Give it a few days."*');
    if (row(ctx.db, g, ctx.user.id, ctx.now).crew_day === dayKey(ctx.now)) throw new GameError('ug.crew.today', '*"One crew a day. They need their rest."*');
    pay(ctx, g, w, c.price, 'ug.buy');
    l.squatters = 1; saveLot(ctx.db, l);
    ctx.db.setMeta(`ug.crew:${g}:${lot}`, String(ctx.now + UG.crewCooldown));
    ctx.db.run('UPDATE underground SET crew_day = ? WHERE guild_id = ? AND user_id = ?', dayKey(ctx.now), g, ctx.user.id);
    addInbox(ctx.db, l.owner_id!, g, 'Squatters!', `${emojiOr('squatter_crew', '🛌')} **A crew of squatters moved into ${tileName(lot)}.** Somebody sent them. No rent until they're gone: \`${P}property evict ${tileName(lot)}\`, or repair it to 75%.`, ctx.now);
    lines.push(`${emojiOr('squatter_crew', '🛌')} *"They'll be there by morning."* A crew is moving into **${tileName(lot)}**.`);
  } else {
    pay(ctx, g, w, c.price, 'ug.buy');
    if (id === 'loaded_dice') { ctx.db.run('UPDATE underground SET dice = dice + ? WHERE guild_id = ? AND user_id = ?', UG.diceGames, g, ctx.user.id); lines.push(`${emojiOr('loaded_dice', '🎲')} Loaded Dice: your next ${UG.diceGames} casino games roll a little your way. Don't let TODD see them.`); }
    if (id === 'fake_id') {
      const ban = ctx.db.get<{ ban_until: number }>('SELECT ban_until FROM casino WHERE guild_id = ? AND user_id = ?', g, ctx.user.id)?.ban_until ?? 0;
      if (ban > ctx.now) { ctx.db.run('UPDATE casino SET ban_until = 0 WHERE guild_id = ? AND user_id = ?', g, ctx.user.id); lines.push(`${emojiOr('fake_id', '🪪')} A Fake ID. Your casino ban? *"Never happened."* You're back in.`); }
      else { ctx.db.run('UPDATE underground SET fake_id = fake_id + 1 WHERE guild_id = ? AND user_id = ?', g, ctx.user.id); lines.push(`${emojiOr('fake_id', '🪪')} A Fake ID. The next time TODD throws you out, you'll walk right back in.`); }
    }
    if (id === 'lockpick') { ctx.db.run('UPDATE underground SET lockpick = lockpick + 1 WHERE guild_id = ? AND user_id = ?', g, ctx.user.id); lines.push(`${emojiOr('lockpick', '🔓')} A Lockpick Set: +${Math.round(UG.lockpickOdds * 100)}% odds on your next heist.`); }
    if (id === 'smoke_bomb') { ctx.db.run('UPDATE underground SET smoke = smoke + 1 WHERE guild_id = ? AND user_id = ?', g, ctx.user.id); lines.push(`${emojiOr('smoke_bomb', '💨')} A Smoke Bomb: refuse your next buyout bid and you won't pay a fee.`); }
  }
  spend(ctx, g, c.price);
  return shady(ctx, g, c.heat, [`You paid **${format(c.price)}**.`, ...lines], `${ce()} No questions asked`);
}

export const underground: Command = {
  name: 'underground', aliases: ['ug', 'connector', 'blackmarket', 'bm', 'nqa'], system: 'underground', guildOnly: true,
  description: 'No Questions Asked: the Connector\'s black market (10 PM to 4 AM Eastern)',
  options: [
    { name: 'action', type: 'string', description: 'Blank to look, a password, or: buy, fence, launder, smuggle, snitch, heat' },
    { name: 'target', type: 'string', description: 'An item, a loot #, an amount, or a player' },
    { name: 'extra', type: 'string', description: 'More for the item (a ticker, up/down, a lot)' }
  ],
  run(ctx, args) {
    const { guildId: g, wallet: w } = me(ctx);
    const P = ctx.config.prefix;
    const action = String(args.action ?? '').trim();
    const verb = action.toLowerCase();
    const target = String(args.target ?? '').trim();
    const extra = String(args.extra ?? '').trim();
    return ctx.db.tx(() => {
      const done = settledLines(settlePlayer(ctx.db, g, ctx.user.id, ctx.now));

      if (!action || verb === 'look' || verb === 'heat' || verb === 'me') {
        const n = tonight(ctx.db, g, ctx.now);
        if (!n) return closedView(ctx, g, done, `The lot's empty. The Connector comes back ${discordTime(nextOpen(ctx.now))} (10 PM to 4 AM Eastern), somewhere condemned.`);
        const r = row(ctx.db, g, ctx.user.id, ctx.now);
        if (r.locked_until > ctx.now) return closedView(ctx, g, done, `${where(ctx, g, n)} The door stays shut for you: you're too hot. Come back ${discordTime(r.locked_until)}.`);
        if (n.password && r.entered !== n.night) return closedView(ctx, g, done, `${where(ctx, g, n)}\nA slot in the door slides open. One red eye, one blue. *"Password."*\n-# \`${P}underground <password>\` (it's out there somewhere tonight)`);
        return shopView(ctx, g, n, done);
      }

      if (verb === 'snitch' || verb === 'rat' || verb === 'tip') {
        const id = target.match(/\d{15,21}/)?.[0];
        if (!id) throw new GameError('ug.snitch.who', `\`${P}ug snitch @player\`: tip TODD off about someone.`);
        if (id === ctx.user.id) throw new GameError('ug.snitch.self', 'Turning yourself in? TODD appreciates the honesty, but no.');
        const r = row(ctx.db, g, ctx.user.id, ctx.now);
        if (r.snitch_day === dayKey(ctx.now)) throw new GameError('ug.snitch.today', 'TODD only takes one call a day from you.');
        pay(ctx, g, w, UG.snitchCost, 'ug.snitch');
        ctx.db.run('UPDATE underground SET snitch_day = ? WHERE guild_id = ? AND user_id = ?', dayKey(ctx.now), g, ctx.user.id);
        const exists = ctx.db.get('SELECT 1 FROM players WHERE guild_id = ? AND user_id = ?', g, id);
        const theirs = exists ? heatNow(ctx.db, g, id, ctx.now) : 0;
        if (stars(theirs) >= UG.snitchStars) {
          const hit = raid(ctx.db, g, id, ctx.now);
          const cut = payFromReserve(ctx.db, economy.reserveStart, { to: w, cents: Math.floor(hit.fine * UG.snitchShare) + UG.snitchReward, reason: 'ug.reward', guildId: g, actorId: ctx.user.id, now: ctx.now });
          addInbox(ctx.db, id, g, 'Raided', `${emojiOr('raid', '🚨')} **Someone talked.** TODD raided you.\n${raidLines(hit).join('\n')}`, ctx.now);
          award(ctx.db, g, ctx.user.id, 'snitches_get_stitches', ctx.now);
          return { embeds: [embed('underground', `${emojiOr('snitch', '🐀')} You made a call`, [`TODD listened. Then he went and kicked a door in. You got **${format(cut)}** for your trouble.`, '-# They won\'t know it was you. Probably.'])] };
        }
        const more = addHeat(ctx.db, g, ctx.user.id, UG.snitchMiss, ctx.now);
        return { embeds: [embed('underground', `${emojiOr('snitch', '🐀')} You made a call`, [`TODD checked it out. Nothing. Now he's looking at **you**.`, `-# +${UG.snitchMiss} Heat: ${heatBar(heatNow(ctx.db, g, ctx.user.id, ctx.now))}`, ...more])] };
      }

      // Everything else is dealing with the Connector himself
      const known = ['buy', 'fence', 'sell', 'launder', 'smuggle', 'run'];
      if (!known.includes(verb)) {
        // a password?
        const n = tonight(ctx.db, g, ctx.now);
        if (!n) throw new GameError('ug.closed', `The lot's empty. The Connector comes back ${discordTime(nextOpen(ctx.now))}.`);
        if (!n.password) throw new GameError('ug.nopw', `*"No password tonight. Just come in."* \`${P}underground\``);
        if (verb !== n.password) throw new GameError('ug.wrongpw', 'The slot slams shut.');
        const r = row(ctx.db, g, ctx.user.id, ctx.now);
        if (r.locked_until > ctx.now) throw new GameError('ug.locked', `Right password. Doesn't matter. You're too hot. Come back ${discordTime(r.locked_until)}.`);
        ctx.db.run('UPDATE underground SET entered = ? WHERE guild_id = ? AND user_id = ?', n.night, g, ctx.user.id);
        awardHere('password_please');
        return shopView(ctx, g, n, [...done, '*The door opens just wide enough.*']);
      }
      const n = open(ctx, g);

      if (verb === 'buy') {
        if (!target) throw new GameError('ug.buy', `\`${P}ug buy <item>\`. Tonight: ${stockFor(g, n.night).map((x) => CONTRABAND[x].name).join(', ')}.`);
        return buy(ctx, g, w, n, target, extra);
      }

      if (verb === 'fence' || verb === 'sell') {
        const loot = lootOf(ctx.db, g, ctx.user.id).filter((l) => !l.launder_until);
        const pickIt = /^all$/i.test(target) ? loot : loot.filter((l) => String(l.id) === target.replace(/^#/, ''));
        if (!loot.length) throw new GameError('ug.noloot', '*"You\'ve got nothing I want."* Hot loot comes from heists.');
        if (!pickIt.length) throw new GameError('ug.which', `\`${P}ug fence <#|all>\`. You have: ${loot.map((l) => `#${l.id}`).join(', ')}.`);
        let total = 0;
        for (const l of pickIt) {
          total += payFromReserve(ctx.db, economy.reserveStart, { to: w, cents: fencePrice(l, ctx.now), reason: 'ug.fence', guildId: g, actorId: ctx.user.id, now: ctx.now });
          ctx.db.run('DELETE FROM hot_loot WHERE id = ?', l.id);
        }
        ctx.db.run('UPDATE underground SET fenced = fenced + ? WHERE guild_id = ? AND user_id = ?', pickIt.length, g, ctx.user.id);
        if (row(ctx.db, g, ctx.user.id, ctx.now).fenced >= 5) awardHere('fence_sitter');
        return shady(ctx, g, UG.fenceHeat * pickIt.length, [`He turns it over in his hands. Counts it out. **+${format(total)}** for ${pickIt.length === 1 ? 'it' : `${pickIt.length} pieces`}.`, '-# Hot loot pays more after it cools off for a few days, if you can wait.'], `${emojiOr('connector', '🎩')} Fenced`);
      }

      if (verb === 'launder') {
        const l = lootOf(ctx.db, g, ctx.user.id).find((x) => String(x.id) === target.replace(/^#/, '') && !x.launder_until);
        if (!l) throw new GameError('ug.launder.which', `\`${P}ug launder <loot #> <your shop's tile>\`.`);
        const mine = lotsOf(ctx.db, g, ctx.now).filter((x) => x.kind === 'shop' && x.status === 'owned' && x.owner_id === ctx.user.id && x.build_until <= ctx.now);
        const lot = extra ? lotAt(mine, parseTile(extra) ?? 0) : mine.length === 1 ? mine[0] : undefined;
        if (!lot) throw new GameError('ug.launder.shop', 'It goes out the back of a **finished Corner Shop you own**. Which tile?');
        if (lot.squatters) throw new GameError('ug.launder.squat', 'There are squatters in that shop. Not tonight.');
        ctx.db.run('UPDATE hot_loot SET launder_until = ?, launder_lot = ? WHERE id = ?', ctx.now + UG.launderMs, lot.lot, l.id);
        return shady(ctx, g, UG.launderHeat, [`${emojiOr('launder', '🧺')} ${LOOT[l.kind].name.replace(/^./, (c) => c.toUpperCase())} goes out the back of your shop on ${tileName(lot.lot)}. It'll come back clean, for the full ${format(l.value)}, ${discordTime(ctx.now + UG.launderMs)}.`], `${emojiOr('launder', '🧺')} Laundering`);
      }

      if (verb === 'smuggle' || verb === 'run') {
        const r = row(ctx.db, g, ctx.user.id, ctx.now);
        if (r.smuggle_until && r.smuggle_stake) throw new GameError('ug.smuggle.busy', `Your shipment's still on the water. It lands ${discordTime(r.smuggle_until)}.`);
        if (r.smuggle_night === n.night) throw new GameError('ug.smuggle.tonight', '*"One boat a night. The patrol isn\'t stupid."*');
        const stake = parseAmount(target, { all: Math.min(balance(ctx.db, w), UG.smuggleMax), min: UG.smuggleMin, max: UG.smuggleMax });
        pay(ctx, g, w, stake, 'ug.smuggle');
        const beacon = hasPerk(ctx.db, g, ctx.user.id, 'lighthouse');
        const caught = beacon ? 0.07 : 0.15, x = ctx.rng.next();
        const mult = x < caught ? 0 : x < caught + 0.25 ? 1.1 : 1.5;
        ctx.db.run('UPDATE underground SET smuggle_stake = ?, smuggle_until = ?, smuggle_mult = ?, smuggle_night = ? WHERE guild_id = ? AND user_id = ?', stake, ctx.now + UG.smuggleMs, mult, n.night, g, ctx.user.id);
        return shady(ctx, g, UG.smuggleHeat, [`${emojiOr('smuggle', '⛵')} **${format(stake)}** of something goes into a crate, and the crate goes onto a boat. It lands ${discordTime(ctx.now + UG.smuggleMs)}. Check back with \`${P}underground\`.`, beacon ? `-# ${emojiOr('prop_lighthouse', '🗼')} Your Lighthouse keeps the patrol looking the other way.` : null].filter((x): x is string => !!x), `${emojiOr('smuggle', '⛵')} Smuggling run`);
      }
      throw new GameError('ug.action', `\`${P}ug\` · \`buy <item>\` · \`fence <#|all>\` · \`launder <#> <lot>\` · \`smuggle <amount>\` · \`snitch @player\``);
    });
  }
};

export const undergroundCommands = [underground];
