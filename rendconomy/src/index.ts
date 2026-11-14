// RendConomy: starts the bot.
import { Client, Events, GatewayIntentBits } from 'discord.js';
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
import { setLotteryAnnouncer } from './commands/extras';
import { answerDrop, chatPay, expireDrop, shouldDrop, startDrop } from './social/chatter';
import { runInRequest } from './core/request';

async function main(): Promise<void> {
  loadEnv();
  const config = botConfig();
  const db = open(config.dbFile);
  ensureReserve(db, economy.reserveStart);

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
  market.start(db, rng, (posts) => {
    if (!config.newsWebhook) return;
    news.send(posts, config.newsWebhook.split(/[\s,]+/).filter(Boolean), { log: (m) => console.log('[news]', m) }).catch((e: unknown) => console.error('[news]', e));
  });
  console.log(`[${config.name}] market running (${market.TICKERS.join(', ')})`);

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
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
      if (!open || !ctx.guildId || !shouldDrop(db, ctx.guildId, msg.channelId, ctx.now, rng)) return;
      const drop = startDrop(market.load(db), ctx.guildId, msg.channelId, ctx.now, rng);
      if (!ch.isSendable()) return;
      await ch.send({ embeds: [{ author: { name: 'TODD has entered the chat' }, title: 'DROP-IN', color: 0x38e1ff, description: `${drop.q}\n\nFirst right answer wins **${format(drop.pot)}**. You have 60 seconds.` }], allowedMentions: { parse: [] } });
      setTimeout(() => { if (expireDrop(msg.channelId, drop) && ch.isSendable()) ch.send({ content: `Time is up. The answer was **${drop.shown}**. TODD keeps the Polygons.`, allowedMentions: { parse: [] } }).catch(() => {}); }, 60_000).unref();
    }
  };

  client.once(Events.ClientReady, async (c) => {
    console.log(`[${config.name}] logged in as ${c.user.tag}`);
    // DMs about things that happened while a player was away (orders filled, broker reports, margin calls)
    setNotifier((_g, userId, text) => {
      if (db.meta(`receipts.off:${userId}`) === '1') return;
      c.users.fetch(userId).then((u) => u.send({ content: text, allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
    });
    setLotteryAnnouncer((guildId, text) => {
      const chId = db.meta(`lottery.channel:${guildId}`);
      if (!chId) return;
      c.channels.fetch(chId).then(async (ch) => { if (ch && ch.isSendable()) await ch.send({ content: text, allowedMentions: { users: [] } }); }).catch(() => {});
    });
    startPublishing(db, config, {
      serverName: (id) => c.guilds.cache.get(id)?.name ?? null,
      user: (id) => { const u = c.users.cache.get(id); return u ? { name: u.globalName ?? u.username, avatar: u.displayAvatarURL({ size: 128 }) } : null; },
      servers: () => c.guilds.cache.size,
      botId: () => c.user.id
    });
    try {
      const body = slashBody();
      if (config.devGuildId) await c.application.commands.set(body, config.devGuildId);
      else await c.application.commands.set(body);
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

  client.on(Events.MessageCreate, (m) => { onMessage(deps, m).catch((e) => console.error('[message]', e)); });
  client.on(Events.InteractionCreate, (i) => {
    if (i.isChatInputCommand()) onSlash(deps, i).catch((e) => console.error('[slash]', e));
    else if (i.isButton()) onButton(deps, i).catch((e) => console.error('[button]', e));
  });

  const stop = () => { console.log(`[${config.name}] shutting down`); client.destroy(); db.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  await client.login(config.token);
}

main().catch((e) => { console.error(e); process.exit(1); });
