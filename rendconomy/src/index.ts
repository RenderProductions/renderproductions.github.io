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
  market.start(db, rng);
  console.log(`[${config.name}] market running (${market.TICKERS.join(', ')})`);

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
  const deps: Deps = { db, config, rng, ping: () => client.ws.ping };

  client.once(Events.ClientReady, async (c) => {
    console.log(`[${config.name}] logged in as ${c.user.tag}`);
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
