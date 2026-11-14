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
  error: 0xc0392b     // red
};

export function embed(system: System, title: string, lines: (string | false | null | undefined)[], extra: Partial<APIEmbed> = {}): APIEmbed {
  let description = lines.filter(Boolean).join('\n');
  // Discord refuses the whole message over 4,096 characters: cut it short instead
  if (description.length > 4096) description = description.slice(0, 4080).replace(/\n[^\n]*$/, '') + '\n…';
  return { color: COLORS[system], title, description, ...extra };
}
