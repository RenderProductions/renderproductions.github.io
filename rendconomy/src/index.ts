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
    try {
      const body = slashBody();
      if (config.devGuildId) await c.application.commands.set(body, config.devGuildId);
      else await c.application.commands.set(body);
      console.log(`[${config.name}] registered ${body.length} slash commands ${config.devGuildId ? `in server ${config.devGuildId}` : 'globally'}`);
    } catch (e) {
      console.error(`[${config.name}] could not register slash commands:`, e);
    }
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
