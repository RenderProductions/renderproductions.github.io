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
  error: 0xc0392b     // red
};

export function embed(system: System, title: string, lines: (string | false | null | undefined)[], extra: Partial<APIEmbed> = {}): APIEmbed {
  return { color: COLORS[system], title, description: lines.filter(Boolean).join('\n'), ...extra };
}
