// RendConomy: starts the bot.
import { loadAppEmojis, syncAppEmojis } from './discord/emoji';
import { COLORS } from './discord/style';
import { receiptView, setReceiptSender } from './social/receipts';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { botConfig, economy, loadEnv } from './config';
import { dailyBackup } from './core/backups';
import { open } from './core/db';
import { ensureReserve } from './core/economy';
import { audit, balance, RESERVE } from './core/ledger';
import { format } from './core/money';
import { cryptoRng } from './core/rng';
import { HOUR, pruneCooldowns } from './core/time';
import { onButton, onMessage, onSlash, slashBody, type Deps } from './discord/router';
import { prune as pruneSessions } from './core/sessions';
import * as market from './market/market';
import { on } from './core/events';
import { startPublishing } from './site/publish';
import { setNotifier } from './market/schemes';
import { setEventAnnouncer } from './events/install';
import { describeEvent } from './events/world';
import { setAdPoster } from './shop/use';
import { ROLE_BUTTON_ID, pendingUpdates, postUpdate, readAllUpdates, setUpdatePoster, updateEmbed } from './site/updates';
import { ButtonStyle, ComponentType, type SendableChannels } from 'discord.js';
import { consoleFromDm, onRainButton, startConsole } from './discord/console';
import { startActivity, startLiveFeed, startProfilesFeed, startApi, startFarmReminders, startFarmhands, startHolidays, startEstates, startReminders, startStreet } from './discord/background';
import { startStatus } from './discord/status';
import { connectorHijack } from './commands/underground';
import { registerRoleMetadata } from './site/roles';
import { setLotteryAnnouncer } from './commands/extras';
import { answerDrop, chatPay, dropinHome, dropinsOff, expireDrop, shouldDrop, startDrop } from './social/chatter';
import { truckDue } from './shop/street';
import { truckEmbed } from './commands/shop';
import { runInRequest } from './core/request';
import { importOnStartup, oldDbFile } from './achievements/import';
import { runFixes } from './fixes';
import { addInbox } from './social/inbox';

async function main(): Promise<void> {
  loadEnv();
  const config = botConfig();
  const db = open(config.dbFile);
  ensureReserve(db, economy.reserveStart);

  try {
    const imported = importOnStartup(db);
    if (!imported && !db.meta('achievements.imported')) console.warn(`[${config.name}] old achievements not imported yet: no database at ${oldDbFile()}. Upload it there and restart, or run /importachievements.`);
    if (imported) console.log(`[${config.name}] carried over ${imported.achievements} achievements for ${imported.players} players from ${oldDbFile()}${imported.caughtUp ? `, and paid ${imported.caughtUp} players who had already started` : ''}`);
  } catch (e) {
    console.error(`[${config.name}] WARNING: could not carry over achievements:`, (e as Error).message);
  }

  try {
    for (const f of runFixes(db)) console.log(`[${config.name}] fix ${f}`);
  } catch (e) {
    console.error(`[${config.name}] WARNING: a one-time fix failed:`, (e as Error).message);
  }

  const books = audit(db);
  console.log(`[${config.name}] database v${db.version()} at ${config.dbFile}`);
  console.log(`[${config.name}] Reserve: ${format(balance(db, RESERVE))}. Books ${books.ok ? 'balance' : 'DO NOT balance'}.`);
  if (!books.ok) console.error(`[${config.name}] WARNING: accounts hold ${books.inAccounts}, expected ${books.minted - books.burned}.`);

  const backup = dailyBackup(db);
  if (backup) console.log(`[${config.name}] daily backup: ${backup}`);
  setInterval(() => { dailyBackup(db); pruneCooldowns(db); pruneSessions(db); }, HOUR).unref();

  if (!config.token || !config.clientId) {
    console.error(`[${config.name}] DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in rendconomy/.env. Not connecting to Discord.`);
    db.close();
    process.exitCode = 1;
    return;
  }

  const rng = cryptoRng();
  // The market runs in the bot. News posts (to the market news channel) come back with the news module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const news: { send: (posts: unknown[], hooks: string[], o: { log: (m: string) => void }) => Promise<unknown> } = require('./market/engine/post-news.js');
  // World events are announced in the market news feed
  setEventAnnouncer((e) => {
    if (!config.newsWebhook) return;
    for (const hook of config.newsWebhook.split(/[\s,]+/).filter(Boolean)) {
      fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Rend-Conomy News', embeds: [{ title: 'World event', description: `${describeEvent(e)}\nFor the next hour.`, color: 0x3498db }] }) })
        .catch((err: unknown) => console.error('[event]', err));
    }
  });
  setAdPoster((text) => {
    for (const hook of config.newsWebhook.split(/[\s,]+/).filter(Boolean)) {
      fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Rend-Conomy News', embeds: [{ title: 'Advertisement', description: text, color: 0xff9f1c }] }) }).catch(() => {});
    }
  });
  market.start(db, rng, (posts) => {
    if (!config.newsWebhook) return;
    news.send(posts, config.newsWebhook.split(/[\s,]+/).filter(Boolean), { log: (m) => console.log('[news]', m) }).catch((e: unknown) => console.error('[news]', e));
  });
  console.log(`[${config.name}] market running (${market.TICKERS.join(', ')})`);

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages], partials: [Partials.Channel] });
  // TODD drops into a channel with a quick question (from chat, or from the console)
  const toddDrop = async (ch: SendableChannels, guildId: string, now = Date.now()) => {
    const drop = startDrop(market.load(db), guildId, ch.id, now, rng);
    await ch.send({ embeds: [{ author: { name: 'TODD has entered the chat' }, title: 'DROP-IN', color: 0x38e1ff, description: `${drop.q}\n\nFirst right answer wins **${format(drop.pot)}**. You have 60 seconds.` }], allowedMentions: { parse: [] } });
    setTimeout(() => { if (expireDrop(ch.id, drop)) ch.send({ content: `Time is up. The answer was **${drop.shown}**. TODD keeps the Polygons.`, allowedMentions: { parse: [] } }).catch(() => {}); }, 60_000).unref();
  };

  const deps: Deps = {
    db, config, rng, ping: () => client.ws.ping, botId: () => client.user?.id,
    // Ordinary chat: TODD drop-in answers, chat pay, and sometimes a new drop-in
    onChat: async (ctx, msg) => {
      const won = runInRequest({ db, guildId: ctx.guildId, userId: ctx.user.id, now: ctx.now, notes: ctx.notes }, () => db.tx(() => {
        const exists = db.get('SELECT 1 FROM players WHERE guild_id = ? AND user_id = ?', ctx.guildId, ctx.user.id);
        const w = exists ? answerDrop(ctx, msg.content) : null;
        if (exists) chatPay(ctx, msg.content);
        return w;
      }));
      if (won) { await msg.reply({ content: [won, ...ctx.notes].join('\n'), allowedMentions: { parse: [] } }); return; }
      const ch = msg.channel;
      const everyone = msg.guild?.roles.everyone;
      const open = !!everyone && 'permissionsFor' in ch && !!ch.permissionsFor(everyone)?.has(['ViewChannel', 'SendMessages']);
      // No Questions Asked: on a password night, Mr. Glaz hijacks TODD's next drop-in to leave it
      if (open && ctx.guildId && ch.isSendable()) {
        const hijack = db.tx(() => connectorHijack(db, ctx.guildId!, ctx.now));
        if (hijack) { await ch.send({ ...hijack, allowedMentions: { parse: [] } }); return; }
        // Main Street: the delivery truck announces itself in the next busy channel (where drop-ins may go)
        const home = dropinHome(db, ctx.guildId);
        if (!dropinsOff(db, ctx.guildId) && (!home || home === msg.channelId)) {
          const truck = db.tx(() => truckDue(db, ctx.guildId!, ctx.now));
          if (truck) { await ch.send({ embeds: [truckEmbed(db, ctx.guildId, ctx.now, config.prefix)], allowedMentions: { parse: [] } }); return; }
        }
      }
      if (!open || !ctx.guildId || !shouldDrop(db, ctx.guildId, msg.channelId, ctx.now, rng)) return;
      if (!ch.isSendable()) return;
      await toddDrop(ch, ctx.guildId, ctx.now);
    }
  };

  client.once(Events.ClientReady, async (c) => {
    console.log(`[${config.name}] logged in as ${c.user.tag}`);
    const emojis = await loadAppEmojis(c);
    console.log(`[${config.name}] custom emojis: ${emojis.length} loaded`);
    // new emojis upload in the background; the update post below waits for them, so it can use them
    const emojisReady = process.env.EMOJI_SYNC === '0' ? Promise.resolve(0) : syncAppEmojis(c).catch((e: unknown) => { console.error('[emoji]', e); return 0; });
    // DMs about things that happened while a player was away (orders filled, broker reports, margin calls)
    // Receipts: a small embed per transaction, with the server it happened in
    setReceiptSender((r) => {
      const server = c.guilds.cache.get(r.guildId)?.name;
      const v = receiptView(r);
      c.users.fetch(r.userId).then((u) => u.send({ embeds: [{
        title: `🧾 ${r.title}`, color: COLORS.wallet, description: v.description, fields: v.fields,
        footer: { text: `${server ? `${server} · ` : ''}Turn these off with ${config.prefix}receipts off` }, timestamp: new Date().toISOString()
      }], allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
    });
    setNotifier((guildId, userId, text) => {
      addInbox(db, userId, guildId, 'Market', text.replace(/<a?:\w+:\d+>\s*/g, ''));
      if (db.meta(`receipts.off:${userId}`) === '1') return;
      const server = c.guilds.cache.get(guildId)?.name;
      const content = `${text}\n-# ${server ? `${server} · ` : ''}Turn these off with ${config.prefix}receipts off`;
      c.users.fetch(userId).then((u) => u.send({ content, allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
    });
    setLotteryAnnouncer((guildId, ...texts) => {
      const chId = db.meta(`lottery.channel:${guildId}`);
      if (!chId) return;
      c.channels.fetch(chId).then(async (ch) => { if (ch && ch.isSendable()) for (const text of texts) await ch.send({ content: text, allowedMentions: { users: [] } }); }).catch(() => {});
    });
    // Update logs: post the newest patch notes entry once, if it's new (main bot only: UPDATES_CHANNEL_ID)
    setUpdatePoster(async (u) => {
      if (!config.updatesChannelId) return false;
      const ch = await c.channels.fetch(config.updatesChannelId).catch(() => null);
      if (!ch || !ch.isSendable()) { console.error('[updates] cannot post in UPDATES_CHANNEL_ID'); return false; }
      await ch.send({
        content: config.updatesRoleId ? `<@&${config.updatesRoleId}>` : undefined,
        embeds: [updateEmbed(u)],
        components: config.updatesRoleId ? [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Get update pings', emoji: { name: '🔔' }, custom_id: ROLE_BUTTON_ID }] }] : [],
        allowedMentions: { roles: config.updatesRoleId ? [config.updatesRoleId] : [] }
      });
      return true;
    });
    // every entry added since the last post, oldest first; read after the emojis are in, so posts show them
    const postNext = async (): Promise<string | null> => {
      const u = pendingUpdates(readAllUpdates(), db.meta('updates.last'))[0];
      if (!u) return null;
      if (!(await postUpdate(u))) throw new Error('Could not post (is UPDATES_CHANNEL_ID set?)');
      db.setMeta('updates.last', u.id);
      return u.title;
    };
    startConsole({ db, client: c, config, rng, todd: (ch, g) => toddDrop(ch, g), postNext });
    if (config.updatesChannelId) emojisReady.then(async () => {
      for (const u of pendingUpdates(readAllUpdates(), db.meta('updates.last'))) {
        const ok = await postUpdate(u).catch((e: unknown) => { console.error('[updates]', e); return false; });
        if (!ok) break;
        db.setMeta('updates.last', u.id);
        console.log(`[updates] posted "${u.title}"`);
      }
    });
    startReminders(db, c, config.prefix);
    startFarmReminders(db, c, config.prefix);
    startFarmhands(db, c, config.prefix, cryptoRng());
    startHolidays(db, c, config.prefix);
    startEstates(db, config.prefix);
    startStreet(db, c, config.prefix, cryptoRng());
    startActivity(db, config, rng, c);
    startLiveFeed(db);
    startApi(db, c);
    startStatus(db, c);
    void registerRoleMetadata(c);
    const dir = {
      serverName: (id: string) => c.guilds.cache.get(id)?.name ?? null,
      user: (id: string) => { const u = c.users.cache.get(id); return u ? { name: u.globalName ?? u.username, avatar: u.displayAvatarURL({ size: 128 }) } : null; },
      servers: () => c.guilds.cache.size,
      botId: () => c.user.id
    };
    startPublishing(db, config, dir);
    if (config.publish) startProfilesFeed(db, dir);   // live profiles: main bot only, like the data branch
    try {
      const body: unknown[] = slashBody();
      if (config.devGuildId) await c.application.commands.set(body as never, config.devGuildId);
      else {
        // An app with an Activity has an Entry Point command (the Launch button). Discord refuses a
        // bulk update that leaves it out, so carry it over as it is.
        const existing = await c.application.commands.fetch();
        for (const cmd of existing.values()) {
          if (Number(cmd.type) === 4) body.push({ name: cmd.name, description: cmd.description, type: 4, handler: (cmd as unknown as { handler?: number }).handler ?? 2 });
        }
        await c.application.commands.set(body as never);
      }
      console.log(`[${config.name}] registered ${body.length} slash commands ${config.devGuildId ? `in server ${config.devGuildId}` : 'globally'}`);
    } catch (e) {
      console.error(`[${config.name}] could not register slash commands:`, e);
    }
  });
  // Moderator actions go to the mod log channel, if one is set
  on('mod.action', (e) => {
    if (!config.modLogChannelId) return;
    const text = `**${e.action}** by <@${e.modId}>${e.targetId ? ` on <@${e.targetId}>` : ''}${e.cents ? `: ${format(e.cents)}` : ''}${e.reason ? `\nReason: ${e.reason}` : ''}`;
    client.channels.fetch(config.modLogChannelId)
      .then(async (ch) => { if (ch && ch.isSendable()) await ch.send({ content: text, allowedMentions: { parse: [] } }); })
      .catch((err: unknown) => console.error('[mod log]', err));
  });

  client.on(Events.MessageCreate, (m) => {
    // the console, from Discord: an owner DMs the bot "> command"
    if (!m.guild && !m.author.bot && m.content.startsWith('>') && config.ownerIds.includes(m.author.id)) {
      consoleFromDm(m.content).then((out) => m.reply({ content: '```\n' + out.slice(0, 1900) + '\n```', allowedMentions: { parse: [] } })).catch((e) => console.error('[console dm]', e));
      return;
    }
    onMessage(deps, m).catch((e) => console.error('[message]', e));
  });
  client.on(Events.InteractionCreate, (i) => {
    if (i.isChatInputCommand()) onSlash(deps, i).catch((e) => console.error('[slash]', e));
    else if (i.isStringSelectMenu()) onButton(deps, i).catch((e) => console.error('[select]', e));
    else if (i.isButton()) onRainButton(i).then((done) => { if (!done) return onButton(deps, i); }).catch((e) => console.error('[button]', e));
  });

  const stop = () => { console.log(`[${config.name}] shutting down`); client.destroy(); db.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  await client.login(config.token);
}

main().catch((e) => { console.error(e); process.exit(1); });
