// Moderator tools. Every action needs a reason, is written to the ledger (for money), and is posted to
// the mod log channel when one is set (MOD_LOG_CHANNEL_ID).
import path from 'node:path';
import { GameError } from '../core/errors';
import { emit } from '../core/events';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, parseAmount } from '../core/money';
import { eraseServer, erasePlayer } from '../core/players';
import * as sessions from '../core/sessions';
import { embed } from '../discord/style';
import { guildOf } from './shared';
import { anyItem, findItem } from '../shop/items';
import { addItem, count, items, takeItem } from '../shop/inventory';
import { CATCH, FISHING, SPECIES, addToBag, bagCount, bagOf, isCatch, takeFromBag } from '../fishing/fishing';
import { CROPS, cropItem, parseCropItem, type Mutation } from '../farming/farming';
import type { Command, Ctx, SessionReply } from './types';

function needMod(ctx: Ctx): string {
  const g = guildOf(ctx);
  if (!ctx.isMod) throw new GameError('mod.only', 'This command is restricted to moderators (Manage Server).');
  return g;
}
function needOwner(ctx: Ctx): string {
  const g = guildOf(ctx);
  if (!ctx.isOwner) throw new GameError('owner.only', 'This command is restricted to the bot owner.');
  return g;
}
function target(ctx: Ctx, guildId: string, id: unknown): string {
  if (typeof id !== 'string' || !/^\d{5,22}$/.test(id)) throw new GameError('mod.target', 'Name a player, for example @someone.');
  if (!ctx.db.get('SELECT 1 FROM players WHERE guild_id = ? AND user_id = ?', guildId, id)) throw new GameError('mod.noaccount', 'That player has no account in this server.');
  return id;
}
const reasonOf = (r: unknown): string => {
  const s = String(r ?? '').trim();
  if (!s) throw new GameError('mod.reason', 'A reason is required.');
  return s.slice(0, 300);
};

export const give: Command = {
  name: 'give',
  description: 'Moderators: give a player Polygons from the Reserve',
  system: 'admin',
  guildOnly: true,
  options: [
    { name: 'player', type: 'user', description: 'Who receives it', required: true },
    { name: 'amount', type: 'string', description: 'How much', required: true },
    { name: 'reason', type: 'string', description: 'Why (recorded)', required: true }
  ],
  run(ctx, args) {
    const g = needMod(ctx);
    const who = target(ctx, g, args.player);
    const cents = parseAmount(args.amount);
    const reason = reasonOf(args.reason);
    transfer(ctx.db, { from: RESERVE, to: wallet(g, who), cents, reason: 'mod.give', guildId: g, actorId: ctx.user.id, now: ctx.now, note: { reason } });
    emit('mod.action', { guildId: g, modId: ctx.user.id, action: 'give', targetId: who, cents, reason });
    return { embeds: [embed('admin', 'Polygons granted', [`<@${who}> received **${format(cents)}** from the Reserve.`, `Reason: ${reason}`, `Their balance: ${format(balance(ctx.db, wallet(g, who)))}`])] };
  }
};

export const take: Command = {
  name: 'take',
  description: 'Moderators: take Polygons from a player back to the Reserve',
  system: 'admin',
  guildOnly: true,
  options: [
    { name: 'player', type: 'user', description: 'Who loses it', required: true },
    { name: 'amount', type: 'string', description: 'How much, or "all"', required: true },
    { name: 'reason', type: 'string', description: 'Why (recorded)', required: true }
  ],
  run(ctx, args) {
    const g = needMod(ctx);
    const who = target(ctx, g, args.player);
    const cents = parseAmount(args.amount, { all: balance(ctx.db, wallet(g, who)) });
    const reason = reasonOf(args.reason);
    transfer(ctx.db, { from: wallet(g, who), to: RESERVE, cents, reason: 'mod.take', guildId: g, actorId: ctx.user.id, now: ctx.now, note: { reason } });
    emit('mod.action', { guildId: g, modId: ctx.user.id, action: 'take', targetId: who, cents, reason });
    return { embeds: [embed('admin', 'Polygons removed', [`**${format(cents)}** was returned to the Reserve from <@${who}>.`, `Reason: ${reason}`, `Their balance: ${format(balance(ctx.db, wallet(g, who)))}`])] };
  }
};

function setFrozen(frozen: boolean): Command {
  return {
    name: frozen ? 'freeze' : 'unfreeze',
    description: frozen ? 'Moderators: freeze a player (no commands that use their account)' : 'Moderators: unfreeze a player',
    system: 'admin',
    guildOnly: true,
    options: [
      { name: 'player', type: 'user', description: 'Which player', required: true },
      { name: 'reason', type: 'string', description: 'Why (recorded)', required: true }
    ],
    run(ctx, args) {
      const g = needMod(ctx);
      const who = target(ctx, g, args.player);
      const reason = reasonOf(args.reason);
      ctx.db.run('UPDATE players SET frozen = ? WHERE guild_id = ? AND user_id = ?', frozen ? 1 : 0, g, who);
      emit('mod.action', { guildId: g, modId: ctx.user.id, action: frozen ? 'freeze' : 'unfreeze', targetId: who, reason });
      return { embeds: [embed('admin', frozen ? 'Account frozen' : 'Account unfrozen', [`<@${who}>`, `Reason: ${reason}`])] };
    }
  };
}
export const freeze = setFrozen(true);
export const unfreeze = setFrozen(false);

interface WipeState { scope: 'player' | 'server'; targetId: string | null }

export const wipe: Command = {
  name: 'wipe',
  description: 'Bot owner: erase one player\'s data, or the whole server\'s (backup first, asks to confirm)',
  system: 'admin',
  guildOnly: true,
  options: [
    { name: 'scope', type: 'string', description: '"player" or "server"', required: true },
    { name: 'player', type: 'user', description: 'Which player (for scope: player)' }
  ],
  run(ctx, args) {
    const g = needOwner(ctx);
    const scope = String(args.scope ?? '').trim().toLowerCase();
    if (scope !== 'player' && scope !== 'server') throw new GameError('wipe.scope', 'The scope must be "player" or "server".');
    const who = scope === 'player' ? target(ctx, g, args.player) : null;
    const count = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM players WHERE guild_id = ?', g)!.n;
    const s = sessions.create<WipeState>(ctx.db, { kind: 'wipe', guildId: g, channelId: ctx.channelId, userId: ctx.user.id, state: { scope, targetId: who }, ttlMs: 2 * 60_000, now: ctx.now });
    return {
      embeds: [embed('admin', 'Confirm erasure', [
        who ? `Every record of <@${who}> in this server will be erased: balance, shares, jobs and history. Their Polygons return to the Reserve.`
          : `Every record of all **${count}** players in this server will be erased. Their Polygons return to the Reserve.`,
        'A backup of the database is taken first. This cannot be undone from Discord.'
      ])],
      buttons: [[{ label: 'Erase', id: sessions.buttonId(s.id, 'yes'), style: 'danger' }, { label: 'Cancel', id: sessions.buttonId(s.id, 'no') }]],
      session: s.id
    };
  }
};

export function onWipeButton(ctx: Ctx, s: sessions.Session<WipeState>, value: string): SessionReply {
  if (ctx.user.id !== s.user_id || !ctx.isOwner) return { notice: 'Only the bot owner who started this can confirm it.' };
  if (!sessions.end(ctx.db, s.id)) return { update: { buttons: [] } };
  if (value !== 'yes') return { update: { embeds: [embed('admin', 'Erasure cancelled', ['Nothing was changed.'])], buttons: [] } };
  const g = s.guild_id!;
  let backup = 'not taken (in-memory database)';
  if (ctx.db.file !== ':memory:') {
    const stamp = new Date(ctx.now).toISOString().replace(/[:.]/g, '-');
    backup = path.basename(ctx.db.backup(path.join(path.dirname(ctx.db.file), 'backups', `before-wipe-${stamp}.db`)));
  }
  let summary: string;
  if (s.state.scope === 'player') {
    erasePlayer(ctx.db, g, s.state.targetId!, ctx.now);
    summary = `All records of <@${s.state.targetId}> in this server have been erased.`;
  } else {
    summary = `All records of ${eraseServer(ctx.db, g, ctx.now)} players in this server have been erased.`;
  }
  emit('mod.action', { guildId: g, modId: ctx.user.id, action: `wipe ${s.state.scope}`, targetId: s.state.targetId ?? undefined });
  return { update: { embeds: [embed('admin', 'Erasure complete', [summary, `Backup: ${backup}`])], buttons: [] } };
}

// ---------------------------------------------------------------- items (bot owner)
// One inventory holds everything: shop items and collectibles, the fish bag (fish_*) and the farm basket (crop_*).
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Any item a player can hold, by id or by name. Plain crop names mean the crop ("carrot"); seeds are "carrot seeds". */
export function resolveItem(text: string): { id: string; name: string; where: 'inventory' | 'fish bag' | 'basket' } | null {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw) return null;
  const inv = (id: string) => ({ id, name: anyItem(id)!.name, where: 'inventory' as const });
  const fishOf = (id: string) => ({ id: `fish_${id}`, name: CATCH[id]!.name, where: 'fish bag' as const });
  const cropOf = (id: string) => ({ id, name: parseCropItem(id)!.name, where: 'basket' as const });
  if (anyItem(raw)) return inv(raw);
  if (isCatch(raw)) return fishOf(raw.slice(5));
  if (parseCropItem(raw)) return cropOf(raw);
  const t = normName(raw);
  if (CATCH[t]) return fishOf(t);
  const fish = Object.keys(CATCH).find((k) => normName(CATCH[k]!.name) === t || normName(CATCH[k]!.name).split(' ').includes(t));
  if (fish && !/seed/.test(t)) return fishOf(fish);
  if (t === 'square pumpkin' || t === 'squarepumpkin') return cropOf('crop_squarepumpkin');
  const m = /^(?:(golden|rainbow) )?(.+?)s?$/.exec(t.replace(/ crops?$/, ''));
  if (m && !/seed/.test(t)) {
    const id = Object.keys(CROPS).find((k) => k === m[2] || normName(CROPS[k]!.name) === m[2] || normName(CROPS[k]!.name) === m[2] + 's' || normName(CROPS[k]!.plural) === t.replace(/^(golden|rainbow) /, ''));
    if (id) return cropOf(cropItem(id, (m[1] as Mutation | undefined) ?? null));
  }
  const found = findItem(raw);
  return found ? inv(found) : null;
}

/** "3 golden pumpkin", "golden pumpkin x3" or "golden pumpkin 3": the item text and how many. */
function qtyAndItem(text: string): { qty: number; item: string } {
  const s = String(text ?? '').trim();
  const a = /^(\d{1,4})\s*x?\s+(.+)$/i.exec(s), b = /^(.+?)\s+x?(\d{1,4})$/i.exec(s);
  if (a) return { qty: Number(a[1]), item: a[2]! };
  if (b) return { qty: Number(b[2]), item: b[1]! };
  return { qty: 1, item: s };
}

function itemCommand(mode: 'give' | 'take'): Command {
  return {
    name: mode === 'give' ? 'giveitem' : 'takeitem',
    aliases: mode === 'give' ? ['additem'] : ['removeitem'],
    description: mode === 'give' ? 'Bot owner: put items in a player\'s inventory, fish bag or basket' : 'Bot owner: take items from a player\'s inventory, fish bag or basket',
    system: 'admin', guildOnly: true,
    options: [
      { name: 'player', type: 'user', description: 'Which player', required: true },
      { name: 'item', type: 'string', description: 'The item, with an optional amount: "3 coffee", "golden pumpkin x2", "white whale"', required: true }
    ],
    run(ctx, args) {
      const g = needOwner(ctx);
      const who = target(ctx, g, args.player);
      const { qty, item } = qtyAndItem(String(args.item ?? ''));
      if (qty < 1 || qty > 9999) throw new GameError('item.qty', 'Between 1 and 9,999 at a time.');
      const it = resolveItem(item);
      if (!it) throw new GameError('item.unknown', `No item called "${item}". Try an id like coffee, col_snowglobe, fish_whale, crop_golden_pumpkin or seed_carrot.`);
      let done = qty;
      const sp = it.where === 'fish bag' ? SPECIES[it.id.slice(5)] : undefined;
      if (sp && sp.size > 0) {
        // The Fishy Deep: real fish go in the bag, one row each, at the middle of their weight range
        const rows = bagOf(ctx.db, g, who).filter((r) => r.species === sp.id);
        if (mode === 'give') for (let i = 0; i < qty; i++) addToBag(ctx.db, g, who, sp.id, Math.round(((sp.lb[0] + sp.lb[1]) / 2) * 100) / 100, ctx.now);
        else {
          if (!rows.length) throw new GameError('item.none', `<@${who}> has no ${it.name}.`);
          done = Math.min(qty, rows.length);
          for (const r of rows.slice(0, done)) takeFromBag(ctx.db, r.id);
        }
        emit('mod.action', { guildId: g, modId: ctx.user.id, action: `${mode}item ${it.id} ×${done}`, targetId: who });
        return { embeds: [embed('admin', mode === 'give' ? 'Items granted' : 'Items removed', [`${mode === 'give' ? 'Gave' : 'Took'} **${done} × ${it.name}** ${mode === 'give' ? 'to' : 'from'} <@${who}>'s fish bag.`, `They now have **${bagOf(ctx.db, g, who).filter((r) => r.species === sp.id).length}**.`])] };
      }
      if (mode === 'give') addItem(ctx.db, g, who, it.id, qty);
      else {
        const have = count(ctx.db, g, who, it.id);
        if (!have) throw new GameError('item.none', `<@${who}> has no ${it.name}.`);
        done = Math.min(qty, have);
        takeItem(ctx.db, g, who, it.id, done);
      }
      const now = count(ctx.db, g, who, it.id);
      emit('mod.action', { guildId: g, modId: ctx.user.id, action: `${mode}item ${it.id} ×${done}`, targetId: who });
      const bagNote = it.where === 'fish bag' && mode === 'give' && fishInBag(ctx, g, who) > FISHING.bagMax ? `\nTheir fish bag is over the usual ${FISHING.bagMax}; they can still sell, but can't fish until it's under.` : '';
      return { embeds: [embed('admin', mode === 'give' ? 'Items granted' : 'Items removed', [
        `${mode === 'give' ? 'Gave' : 'Took'} **${done} × ${it.name}** ${mode === 'give' ? 'to' : 'from'} <@${who}>'s ${it.where} (\`${it.id}\`).`,
        `They now have **${now}**.${bagNote}`
      ])] };
    }
  };
}
const fishInBag = (ctx: Ctx, g: string, u: string) => items(ctx.db, g, u).filter((r) => isCatch(r.item)).reduce((s, r) => s + r.qty, 0) + bagCount(ctx.db, g, u);

export const giveitem = itemCommand('give');
export const takeitem = itemCommand('take');
