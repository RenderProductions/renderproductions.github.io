// Automatic update logs: when a new update appears at the top of the patch notes page
// (patch-notes/index.html in this repo), the bot posts it once in the updates channel and pings the
// updates role. The page stays the only place patch notes are written.
//   UPDATES_CHANNEL_ID, UPDATES_ROLE_ID in .env; leave the channel empty to switch it off (the test bot).
import fs from 'node:fs';
import path from 'node:path';
import type { APIEmbed } from 'discord.js';

export interface UpdateEntry { id: string; title: string; date: string; intro: string; sections: { heading: string; items: string[] }[]; outro: string }

export const PATCH_NOTES_FILE = path.join(__dirname, '..', '..', '..', '..', 'patch-notes', 'index.html');
export const PATCH_NOTES_URL = 'https://renderproductions.github.io/patch-notes/';

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&rarr;': '→' };
const decode = (s: string) => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|[a-z]+);/gi, (m, d, h) => (d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : ENTITIES[m.toLowerCase()] ?? m));

/** A bit of the page's HTML as Discord markdown. */
export function toMarkdown(html: string): string {
  return decode(html
    .replace(/<span class="tag new">\s*NEW\s*<\/span>/gi, '🆕 ')
    .replace(/<span class="tag (?:changed)?">\s*CHANGED\s*<\/span>/gi, '🔧 ')
    .replace(/<span class="tag fix">\s*FIXED\s*<\/span>/gi, '🩹 ')
    .replace(/<span class="tag[^"]*">[^<]*<\/span>/gi, '')
    .replace(/<\/?(strong|b)>/gi, '**')
    .replace(/<\/?(em|i)>/gi, '*')
    .replace(/<\/?code>/gi, '`')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')).trim();
}

/** The newest update on the patch notes page, or null if the page can't be read. */
export function newestUpdate(html: string): UpdateEntry | null {
  const m = /<article class="log[^"]*" id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/.exec(html);
  if (!m) return null;
  const [, id, body] = m as unknown as [string, string, string];
  const title = toMarkdown(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(body)?.[1] ?? id);
  const label = /<div class="label">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? '';
  const date = toMarkdown([...label.matchAll(/<span>([^<]*)<\/span>/g)].map((x) => x[1]).join(' '));
  const afterTitle = body.slice(body.indexOf('</h2>') + 5);
  const firstH3 = afterTitle.search(/<h3/);
  const intro = toMarkdown((/<p>([\s\S]*?)<\/p>/.exec(firstH3 < 0 ? afterTitle : afterTitle.slice(0, firstH3))?.[1]) ?? '');
  const sections = [...afterTitle.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<ul>([\s\S]*?)<\/ul>/g)].map((x) => ({
    heading: toMarkdown(x[1]!),
    items: [...x[2]!.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((li) => toMarkdown(li[1]!))
  }));
  const lastUl = afterTitle.lastIndexOf('</ul>');
  const outro = lastUl >= 0 ? toMarkdown((/<p>([\s\S]*?)<\/p>/.exec(afterTitle.slice(lastUl))?.[1]) ?? '') : '';
  return { id, title, date, intro, sections, outro };
}

export function readNewestUpdate(file = PATCH_NOTES_FILE): UpdateEntry | null {
  try { return newestUpdate(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** The update as one tidy embed, inside Discord's limits (fields of 1,024 characters, 6,000 in all). */
export function updateEmbed(u: UpdateEntry): APIEmbed {
  const fields: { name: string; value: string }[] = [];
  let budget = 5000 - u.title.length - u.intro.length;
  for (const s of u.sections.slice(0, 20)) {
    let value = '';
    for (const it of s.items) {
      const line = `• ${it}\n`;
      if (value.length + line.length > 1000) { value += '…and more on the patch notes page.'; break; }
      value += line;
    }
    value = value.trim() || '—';
    if (budget - value.length - s.heading.length < 0) { fields.push({ name: 'More', value: `The rest is on the [patch notes page](${PATCH_NOTES_URL}#${u.id}).` }); break; }
    budget -= value.length + s.heading.length;
    fields.push({ name: s.heading.slice(0, 256), value });
  }
  return {
    title: u.title.slice(0, 256),
    url: `${PATCH_NOTES_URL}#${u.id}`,
    description: [u.intro, u.outro && `\n${u.outro}`].filter(Boolean).join('\n').slice(0, 1500) || undefined,
    color: 0xffe600,
    fields,
    footer: { text: [u.date, 'Full notes: renderproductions.github.io/patch-notes'].filter(Boolean).join(' · ') }
  };
}

export const ROLE_BUTTON_ID = 'updates:role';

/** Posts an update in the updates channel (set by the bot at startup). Returns false if posting is off. */
let poster: ((u: UpdateEntry) => Promise<boolean>) | null = null;
export const setUpdatePoster = (fn: (u: UpdateEntry) => Promise<boolean>): void => { poster = fn; };
export const postUpdate = (u: UpdateEntry): Promise<boolean> => (poster ? poster(u) : Promise.resolve(false));
