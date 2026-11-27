// The museum (r!museum, donate a collectible) and your collection (r!collection, what your collectibles are worth).
import { GameError } from '../core/errors';
import { format } from '../core/money';
import { emojiOr } from '../discord/emoji';
import { itemE } from '../discord/icons';
import { embed } from '../discord/style';
import { MUSEUM, WINGS, collectionOf, donate, exhibits, prices, released, valueOf, wingsDone } from '../museum/museum';
import { count } from '../shop/inventory';
import { COLLECTIBLES, findItem } from '../shop/items';
import { me } from './shared';
import type { Command } from './types';

const name = (id: string): string => { const c = COLLECTIBLES[id]; return c ? `${itemE(id, c.emoji)} ${c.name}` : id; };
const pct = (x: number): string => (Math.abs(x) < 0.005 ? '' : ` ${x > 0 ? '▲' : '▼'} ${Math.abs(Math.round(x * 100))}%`);

export const museum: Command = {
  name: 'museum', aliases: ['exhibit', 'exhibits'], description: 'Your server\'s museum: see the exhibits, or donate a collectible', system: 'social', guildOnly: true,
  options: [
    { name: 'action', type: 'string', description: 'Blank for the museum, or: donate <collectible>' },
    { name: 'item', type: 'string', description: 'For donate: the collectible' }
  ],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const P = ctx.config.prefix;
    const raw = String(args.action ?? '').trim();
    const word = raw.split(/\s+/)[0]?.toLowerCase() ?? '';
    const want = word === 'donate' || word === 'give' ? `${raw.split(/\s+/).slice(1).join(' ')} ${String(args.item ?? '')}`.trim() : '';

    if (word === 'donate' || word === 'give') {
      const id = want ? findItem(want) : null;
      if (!want || !id || !COLLECTIBLES[id]) throw new GameError('museum.which', `Donate a collectible: \`${P}museum donate <collectible>\`. It's gone for good, and the museum pays you ${Math.round(MUSEUM.donorShare * 100)}% of its collector value.`);
      if (!count(ctx.db, guildId, ctx.user.id, id)) throw new GameError('museum.none', `You don't have a ${COLLECTIBLES[id]!.name}.`);
      const each = valueOf(ctx.db, id, ctx.now);
      const r = donate(ctx.db, guildId, ctx.user.id, id, ctx.now);
      return { embeds: [embed('social', `${emojiOr('museum', '🏛️')} A donation to the museum`, [
        `You hand over your ${name(id)}. It goes behind glass, for good.`,
        r.first ? '🪧 It\'s the first of its kind here, so **your name goes on the plaque.**' : 'There\'s already one on display, so it joins the collection in the back.',
        `The museum pays you **${format(r.paid)}** (${Math.round(MUSEUM.donorShare * 100)}% of its ${format(each)} collector value).`,
        ...r.wings.map((w) => `\n${w.emoji} **The ${w.name} is complete!** Everyone in this server gets ${w.perk}.`),
        r.curator ? '\n🏛️ **Every collectible there is, surrendered.** You are The Curator.' : null
      ])] };
    }

    const list = exhibits(ctx.db, guildId);
    const done = new Set(wingsDone(ctx.db, guildId, ctx.now).map((w) => w.id));
    const have = new Set(list.map((e) => e.item));
    const missing = released(ctx.now).filter((c) => !have.has(c.id));
    return { embeds: [embed('social', `${emojiOr('museum', '🏛️')} The museum`, [
      list.length ? `**${list.length} on display.** Each one gives this server **+${MUSEUM.perExhibit * 100}%** chat and shift pay (**+${Math.round(list.length * MUSEUM.perExhibit * 1000) / 10}%** now).` : 'The halls are empty. Be the first: your name goes on the plaque.',
      '',
      ...list.slice(0, 20).map((e) => `${name(e.item)} · 🪧 ${e.donor ? e.donor : `<@${e.donor_id}>`}${e.copies > 1 ? ` · ${e.copies} given` : ''}`),
      list.length > 20 ? `-# …and ${list.length - 20} more.` : null,
      '', '**The wings:**',
      ...WINGS.map((w) => { const ids = w.items(ctx.now); const n = ids.filter((id) => have.has(id)).length; return `${done.has(w.id) ? '✅' : w.emoji} **${w.name}** (${n} / ${ids.length || '?'}): ${w.perk}`; }),
      missing.length ? `\n-# Still missing: ${missing.slice(0, 8).map((c) => c.name).join(', ')}${missing.length > 8 ? '…' : ''}` : '\n-# Every collectible there is, on display.',
      `-# Donate one: \`${P}museum donate <collectible>\` (${Math.round(MUSEUM.donorShare * 100)}% of its collector value). What yours are worth: \`${P}collection\``
    ])] };
  }
};

export const collection: Command = {
  name: 'collection', aliases: ['collectibles', 'cols'], description: 'Your collectibles and what they\'re worth to collectors', system: 'social', guildOnly: true,
  run(ctx) {
    const { guildId } = me(ctx);
    const P = ctx.config.prefix;
    const mine = collectionOf(ctx.db, guildId, ctx.user.id, ctx.now);
    const total = mine.reduce((s, c) => s + c.each * c.qty, 0);
    const p = prices(ctx.db, ctx.now);
    const movers = Object.values(p).filter((x) => Math.abs(x.change) >= 0.05).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3);
    return { embeds: [embed('social', `🗃️ ${ctx.user.name}'s collection`, [
      mine.length ? `Worth **${format(total)}** to collectors. It counts toward your net worth.` : 'No collectibles yet. Marquez has one on his special shelf every week.',
      '',
      ...mine.map((c) => `${name(c.id)}${c.qty > 1 ? ` ×${c.qty}` : ''} · **${format(c.each)}**${pct(c.change)}`),
      movers.length ? `\n**Moving this week:** ${movers.map((m) => `${COLLECTIBLES[m.id]?.name ?? m.id}${pct(m.change)}`).join(' · ')}` : null,
      '', `-# Collector value follows how many exist across every server: the rarer, the pricier. Donate to the museum (\`${P}museum donate\`) or, at night, sell to Mr. Glaz.`
    ])] };
  }
};

export const museumCommands = [museum, collection];
