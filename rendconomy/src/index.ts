// RendConomy: starts the bot. For now this opens the database and checks the books;
// Discord, commands and the market are added module by module on the rewrite branch.
import { botConfig, economy, loadEnv } from './config';
import { open } from './core/db';
import { ensureReserve } from './core/economy';
import { audit, balance, RESERVE } from './core/ledger';
import { format } from './core/money';

function main(): void {
  loadEnv();
  const config = botConfig();
  const db = open(config.dbFile);
  ensureReserve(db, economy.reserveStart);

  const books = audit(db);
  console.log(`[${config.name}] database v${db.version()} at ${config.dbFile}`);
  console.log(`[${config.name}] Reserve: ${format(balance(db, RESERVE))}. Books ${books.ok ? 'balance' : 'DO NOT balance'}.`);
  if (!books.ok) process.exitCode = 1;
  db.close();
}

main();
