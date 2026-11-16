// How the bot looks and sounds. Each system has one embed color.
// The narrator (the bot's own voice) is very formal and to the point: short sentences, no exclamation
// marks, no slang, no emoji in sentences. TODD and Marquez keep their own voices in their own modules.
import type { APIEmbed } from 'discord.js';
import type { System } from '../commands/types';

export const COLORS: Record<System | 'error', number> = {
  general: 0x5865f2,  // Discord blurple
  wallet: 0x2ecc71,   // green
  market: 0x3498db,   // blue
  work: 0xe67e22,     // orange
  reserve: 0xd4a017,  // gold
  admin: 0x95a5a6,    // grey
  social: 0xff9ecb,   // pink
  casino: 0xeb459e,   // magenta
  farm: 0x7cb342,     // field green
  error: 0xc0392b     // red
};

export const SITE = 'https://renderproductions.github.io';
const PAGES = new Set(['RRM', 'NACH', 'BNW', 'BSTG', 'BLU']);   // the companies with their own page on the site
const strip = (t: string) => t.replace(/<a?:\w+:\d+>/g, '').replace(/[^\p{L}\p{N}()'#: -]/gu, '').trim();

/** The site page that shows the same thing as an embed with this title, if there is one. */
export function siteLink(title: string): string | undefined {
  const t = strip(title);
  const ticker = /\(([A-Z]{2,5})\)$/.exec(t)?.[1] ?? /^(?:Bought|Sold|Short opened:|Short covered:)\s+\d+\s+([A-Z]{2,5})$/.exec(t)?.[1];
  if (ticker) return PAGES.has(ticker) ? `${SITE}/rend-conomy/${ticker.toLowerCase()}/` : `${SITE}/rend-conomy/exchange/co/?t=${ticker}`;
  const rules: [RegExp, string][] = [
    [/^(The market|Compare|World event( started)?|Market (crash|boom))$/i, '/rend-conomy/'],
    [/^(The player exchange|Takeover |Merger )/i, '/rend-conomy/exchange/'],
    [/^(Balance|Savings|Loans|TODD Loans|Transaction history|Dividends)\b/i, '/play/#desk'],
    [/^(Marquez's Shop|Inventory)\b/i, '/play/#shop'],
    [/(\'s farm|^Farmhand|^Compost|^Harvest sold|farmers' market)/i, '/play/#farm'],
    [/^Odd job/i, '/play/#jobs'],
    [/^Trade (offers|offer #|#)/i, '/play/#trades'],
    [/^Inbox$/i, '/play/#inbox'],
    [/^(Leaderboard|Showcase)\b/i, '/profile/'],
    [/^The Polygon Reserve$/i, '/bot/']
  ];
  for (const [re, path] of rules) if (re.test(t)) return SITE + path;
  return undefined;
}

export function embed(system: System, title: string, lines: (string | false | null | undefined)[], extra: Partial<APIEmbed> = {}): APIEmbed {
  if (extra.url === undefined) { const url = siteLink(title); if (url) extra = { ...extra, url }; }
  let description = lines.filter((l) => l !== false && l !== null && l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Discord refuses the whole message over 4,096 characters: cut it short instead
  if (description.length > 4096) description = description.slice(0, 4080).replace(/\n[^\n]*$/, '') + '\n…';
  return { color: COLORS[system], title, description, ...extra };
}
