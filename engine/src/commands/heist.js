// r!heist: plan a heist and get a crew together in this channel.
//   r!heist                      how it works, and recent heists here
//   r!heist vault <ticker>       rob one of the five main companies
//   r!heist stash                rob TODD
//   r!heist reserve              rob the Polygon Reserve (needs a hacker; hurts everyone)
const config = require('../config');
const H = require('../heists');
const A = require('../achievements');
const reserve = require('../reserve');
const { amt, relTime } = require('../format');
const { button, rows } = require('../buttons');

const name = (l) => (l.target === 'vault' ? `the ${l.ticker} vault` : H.TARGETS[l.target].label);

function lobbyView(l) {
  const T = H.TARGETS[l.target];
  const crew = l.crew.map((m) => `${H.ROLES[m.role].emoji} **${m.name}** · ${H.ROLES[m.role].label}${m.id === l.leader ? ' (leader)' : ''}`).join('\n');
  const roleBtns = Object.entries(H.ROLES).map(([k, r]) => button(r.label, `heist:join:${l.id}:${k}`, 'grey', false, r.emoji));
  const ctl = [button('Start the heist', `heist:start:${l.id}`, 'green', l.crew.length < H.RULES.minCrew, '🦹'), button('Leave', `heist:leave:${l.id}`, 'grey', false, '🚪'), button('Call it off', `heist:cancel:${l.id}`, 'red', false, '✖️')];
  return {
    embeds: [{
      title: `${T.emoji} Heist: ${name(l)}`,
      description: `**${l.crew[0] ? l.crew.find((m) => m.id === l.leader)?.name : 'Someone'}** is putting a crew together. Pick a role to join.\n\n` +
        `${crew}\n\n` +
        `Crew: **${l.crew.length}** / ${H.RULES.maxCrew} (need ${H.RULES.minCrew}) · Stake: **${amt(T.stake)}** each, paid when it starts\n` +
        `Odds right now: **${Math.round(H.odds(l.target, l.crew, l.bonus || 0) * 100)}%**${l.bonus ? ' (🚔 Police Strike!)' : ''}` + (T.needs && !l.crew.some((m) => m.role === T.needs) ? ' · ⚠️ No hacker: the Reserve\'s locks will be a problem' : '') +
        `\n\n-# 💻 Hacker: better odds · 🚗 Driver: might get away if it goes wrong · 👀 Lookout: better odds · 💪 Muscle: bigger haul\n` +
        `-# Caught? You lose your stake and pay a fine of ${H.RULES.fine}x the stake. This crew breaks up ${relTime(l.at + H.RULES.lobbyMs)}.`,
      color: 0x8c6239
    }],
    components: [...rows(roleBtns), ...rows(ctl)]
  };
}

const BEATS = {
  vault: ['The crew slips into the lobby after hours...', 'The vault door is bigger than anyone expected.'],
  stash: ["TODD's server room hums. Something blinks.", 'A fan spins up. TODD is... asleep?'],
  reserve: ['The Polygon Reserve. Nobody has ever tried this.', 'Polygons, as far as the eye can see.']
};
const ROLE_BEATS = {
  hacker: (n) => `💻 **${n}** gets to work on the locks.`,
  driver: (n) => `🚗 **${n}** keeps the engine running out back.`,
  lookout: (n) => `👀 **${n}** watches the street.`,
  muscle: (n) => `💪 **${n}** carries the heavy bags.`
};

function resultView(l, r, extra) {
  const T = H.TARGETS[l.target];
  const crew = r.crew.map((m) => `${H.ROLES[m.role].emoji} ${m.name}`).join(' · ');
  let desc;
  if (r.outcome === 'clean') desc = `💰 **CLEAN GETAWAY!** The crew walks out with **${amt(r.haul)}**.\nEach of you gets **${amt(r.each)}**.` +
    (l.target === 'reserve' ? '\n\n🔶 *The Polygon Reserve just got lighter. Everyone will feel that.*' : l.target === 'stash' ? "\n\n🖥️ *Somewhere, TODD wakes up very angry.*" : `\n\n📉 *News of the robbery rattles ${l.ticker}'s stock.*`);
  else if (r.outcome === 'escaped') desc = `🚨 **The alarm goes off!** Nobody gets the money, but the driver gets everyone out. You lose your stakes, nothing more.`;
  else desc = `🚔 **CAUGHT.** TODD was waiting. Everyone loses their stake and pays a fine of up to **${amt(T.stake * H.RULES.fine)}**.\n-# The crew is lying low for ${H.RULES.caughtMs / 3600000} hours.`;
  return {
    embeds: [{
      title: `${T.emoji} Heist: ${name(l)}`,
      description: `${crew}\n\n${desc}` + (r.dropped.length ? `\n\n-# Left behind (couldn't pay the stake): ${r.dropped.map((m) => m.name).join(', ')}` : '') +
        `\n-# The odds were ${Math.round(r.odds * 100)}%.` + (extra.length ? `\n\n${extra.join('\n')}` : ''),
      color: r.outcome === 'clean' ? 0x57f287 : r.outcome === 'escaped' ? 0xf0b232 : 0xed4245
    }],
    components: []
  };
}

module.exports = {
  name: 'heist',
  aliases: ['heists', 'rob'],
  description: 'Plan a heist with a crew: a company vault, TODD\'s stash, or the Polygon Reserve',
  usage: '[vault <ticker> | stash | reserve]',
  options: [
    { name: 'target', type: 'string', description: 'vault, stash, or reserve' },
    { name: 'ticker', type: 'string', description: 'For a vault: which company (RRM, NACH, BLU, BNW, BSTG)' }
  ],
  buttonPrefix: 'heist',

  async run(ctx, args = {}) {
    const P = config.prefix;
    const target = String(args.target || '').trim().toLowerCase();
    if (!H.TARGETS[target]) {
      const log = H.recent(ctx.db, ctx.guildId).map((h) => {
        const crew = JSON.parse(h.crew).map((c) => c[2]).join(', ');
        const [t, tk] = h.target.split(':');
        return `${{ clean: '💰', escaped: '🚨', caught: '🚔' }[h.outcome]} <t:${Math.floor(h.at / 1000)}:R> · ${t === 'vault' ? `${tk} vault` : H.TARGETS[t].label} · ${crew}${h.haul ? ` · ${amt(h.haul)}` : ''}`;
      });
      return {
        embeds: [{
          title: '🦹 Heists',
          description: 'Get a crew of 3 to 5 together and rob somebody. Everyone pays a stake when it starts. Pull it off and you split the haul.\n\n' +
            Object.entries(H.TARGETS).map(([k, t]) => `${t.emoji} \`${P}heist ${k}${k === 'vault' ? ' <ticker>' : ''}\` · ${t.label} · stake ${amt(t.stake)} · haul ${amt(t.haul[0])}–${amt(t.haul[1])} · base odds ${Math.round(t.odds * 100)}%`).join('\n') +
            `\n\n**Roles:** ${Object.values(H.ROLES).map((r) => `${r.emoji} ${r.label}`).join(' · ')}\n` +
            `One heist per server per hour. Afterwards the crew lies low for ${H.RULES.playerGapMs / 3600000} hours (${H.RULES.caughtMs / 3600000} if caught).` +
            (log.length ? `\n\n**Recent heists here**\n${log.join('\n')}` : ''),
          color: 0x8c6239
        }]
      };
    }
    const P_ = ctx.db.player(ctx.guildId, ctx.user);
    let ticker = null;
    if (target === 'vault') {
      const m = await ctx.market.get();
      ticker = String(args.ticker || '').toUpperCase();
      if (!m || !ctx.market.quote(m, ticker)) return `🏦 Which vault? \`${P}heist vault <ticker>\`: ${m ? ctx.market.tickerList(m) : 'RRM, NACH, BLU, BNW, BSTG'}.`;
    }
    if (target === 'reserve' && reserve.level(ctx.db) < H.TARGETS.reserve.minLevel) return `🔶 The Polygon Reserve is too low to be worth robbing right now (under ${H.TARGETS.reserve.minLevel * 100}%).`;
    if (P_.debt > 0) return `🖥️ You owe me **${amt(P_.debt)}** and you want to plan a HEIST? Pay up first.`;
    const cd = H.cooldown(ctx.db, ctx.guildId, ctx.user.id);
    if (cd) return `🕶️ You're lying low after your last job. Back in action ${relTime(cd)}.`;
    const wait = H.serverReady(ctx.db, ctx.guildId);
    if (wait) return `🚓 There was just a heist in this server. The heat dies down ${relTime(wait)}.`;
    const old = H.lobbies.get(ctx.channelId);
    if (old && Date.now() - old.at < H.RULES.lobbyMs) return '🦹 A crew is already forming in this channel. Join that one!';
    const l = { id: Math.random().toString(36).slice(2, 8), target, ticker, leader: ctx.user.id, at: Date.now(), guildId: ctx.guildId,
      crew: [{ id: ctx.user.id, name: ctx.user.username, role: target === 'reserve' ? 'hacker' : 'lookout' }] };
    l.bonus = require('../worldEvents').heistBonus(ctx.db);
    H.lobbies.set(ctx.channelId, l);
    return lobbyView(l);
  },

  async onButton(ctx, [action, id, role]) {
    const l = H.lobbies.get(ctx.channelId);
    if (!l || l.id !== id) return { update: { components: [] } };
    if (Date.now() - l.at > H.RULES.lobbyMs && action !== 'cancel') {
      H.lobbies.delete(ctx.channelId);
      return { update: { content: '🦹 The crew got cold feet and went home. (Nobody paid anything.)', embeds: [], components: [] } };
    }
    const me = l.crew.find((m) => m.id === ctx.user.id);
    l.bonus = require('../worldEvents').heistBonus(ctx.db);
    if (action === 'join' && H.ROLES[role]) {
      if (!me) {
        if (l.crew.length >= H.RULES.maxCrew) return { reply: 'The crew is full.' };
        const cd = H.cooldown(ctx.db, ctx.guildId, ctx.user.id);
        if (cd) return { reply: `🕶️ You're lying low after your last job. Back ${relTime(cd)}.` };
        const p = ctx.db.player(ctx.guildId, ctx.user);
        if (p.cash < H.TARGETS[l.target].stake) return { reply: `You need ${amt(H.TARGETS[l.target].stake)} for the stake.` };
        l.crew.push({ id: ctx.user.id, name: ctx.user.username, role });
      } else me.role = role;
      return { update: lobbyView(l) };
    }
    if (action === 'leave') {
      if (!me) return { reply: "You're not in this crew." };
      if (me.id === l.leader) return { reply: "You're the leader. Call it off instead." };
      l.crew = l.crew.filter((m) => m.id !== ctx.user.id);
      return { update: lobbyView(l) };
    }
    if (action === 'cancel') {
      if (ctx.user.id !== l.leader && !ctx.isMod) return { reply: 'Only the leader can call it off.' };
      H.lobbies.delete(ctx.channelId);
      return { update: { content: '🦹 The heist is off. Everyone scatters.', embeds: [], components: [] } };
    }
    if (action === 'start') {
      if (ctx.user.id !== l.leader) return { reply: 'Only the leader can start the heist.' };
      if (l.crew.length < H.RULES.minCrew) return { reply: `You need at least ${H.RULES.minCrew} in the crew.` };
      const wait = H.serverReady(ctx.db, ctx.guildId);
      if (wait) return { reply: `🚓 The heat's still on from the last heist. Try ${relTime(wait)}.` };
      H.lobbies.delete(ctx.channelId);
      const r = H.run(ctx.db, ctx.guildId, l, ctx.random || Math.random);
      if (r.outcome === 'short') return { update: { content: `🦹 Not enough of the crew could pay the stake (left behind: ${r.dropped.map((m) => m.name).join(', ')}). The heist is off.`, embeds: [], components: [] } };
      // Achievements, for everyone in the crew
      const extra = [];
      const roles = new Set(r.crew.map((m) => m.role));
      for (const m of r.crew) {
        const got = [];
        if (r.outcome === 'clean') {
          got.push(A.award(ctx, 'crew_up', m.id));
          if (l.target === 'reserve') got.push(A.award(ctx, 'inside_job', m.id));
          if (r.crew.length === H.RULES.maxCrew && roles.size === Object.keys(H.ROLES).length) got.push(A.award(ctx, 'dream_team', m.id));
        }
        if (r.outcome === 'caught') got.push(A.award(ctx, 'red_handed', m.id));
        for (const line of got.filter(Boolean)) extra.push(`**${m.name}**: ${line.replace('🏆 **Achievement unlocked:** ', '🏆 ')}`);
      }
      ctx.notes.length = 0; // already listed above, for the whole crew
      if (r.outcome === 'clean' && l.target === 'vault') require('../marketEngine').nudge(ctx.db, l.ticker, -0.03);
      const final = resultView(l, r, extra);
      const beats = [BEATS[l.target][0], ...r.crew.map((m) => ROLE_BEATS[m.role](m.name)), BEATS[l.target][1]];
      const frame = (n) => ({ embeds: [{ title: `${H.TARGETS[l.target].emoji} Heist: ${name(l)}`, description: beats.slice(0, n).join('\n') + '\n\n*...*', color: 0x99aab5 }], components: [] });
      return {
        update: {
          ...frame(1),
          after: async (edit) => {
            for (let n = 2; n <= beats.length; n++) { await new Promise((res) => setTimeout(res, 1800)); await edit(frame(n)); }
            await new Promise((res) => setTimeout(res, 2200));
            await edit(final);
          },
          _final: final
        }
      };
    }
    return null;
  }
};
