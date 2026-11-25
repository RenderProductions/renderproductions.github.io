// Site Care: the wiki's Featured page, picked by the players. Anyone can vote once a week (r!wiki vote <page>);
// the page with the most votes is featured on the wiki's home page all next week. With no votes, the last
// featured page stays up (or, the first time, one is picked for the week).
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../core/db';
import { DAY } from '../core/time';
import { weekOf } from '../city/state';

export const WIKI_INDEX = path.join(__dirname, '..', '..', '..', '..', 'wiki', 'search.json');
export interface WikiPage { slug: string; title: string; summary: string; section: string; url: string }

let cached: { file: string; at: number; pages: WikiPage[] } | null = null;
/** Every wiki page (not its sections), from the wiki's search index. */
export function wikiPages(file = WIKI_INDEX): WikiPage[] {
  try {
    const at = fs.statSync(file).mtimeMs;
    if (cached && cached.file === file && cached.at === at) return cached.pages;
    const list = JSON.parse(fs.readFileSync(file, 'utf8')) as { title: string; section: string; url: string; summary: string }[];
    const pages = list.filter((e) => /^\/wiki\/[a-z0-9-]+\/$/.test(e.url)).map((e) => ({ slug: e.url.split('/')[2]!, title: e.title, summary: e.summary, section: e.section, url: `https://renderproductions.github.io${e.url}` }));
    cached = { file, at, pages };
    return pages;
  } catch { return []; }
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function findPage(text: string, pages = wikiPages()): WikiPage | undefined {
  const t = norm(text);
  if (!t) return undefined;
  return pages.find((p) => p.slug === t.replace(/ /g, '-') || norm(p.title) === t) ?? pages.find((p) => t.length >= 3 && (norm(p.title).startsWith(t) || p.slug.startsWith(t.replace(/ /g, '-'))));
}

export function vote(db: Db, userId: string, page: WikiPage, now: number): { changed: boolean } {
  const week = weekOf(now);
  const before = db.get<{ page: string }>('SELECT page FROM wiki_votes WHERE week = ? AND user_id = ?', week, userId)?.page;
  db.run('INSERT INTO wiki_votes (week, user_id, page, at) VALUES (?, ?, ?, ?) ON CONFLICT (week, user_id) DO UPDATE SET page = excluded.page, at = excluded.at', week, userId, page.slug, now);
  return { changed: !!before && before !== page.slug };
}
export const myVote = (db: Db, userId: string, now: number): string | null =>
  db.get<{ page: string }>('SELECT page FROM wiki_votes WHERE week = ? AND user_id = ?', weekOf(now), userId)?.page ?? null;

/** The votes for a week, most first (a tie goes to the page that got its first vote earliest). */
export function tally(db: Db, week: string): { page: string; votes: number }[] {
  return db.all<{ page: string; votes: number }>('SELECT page, COUNT(*) AS votes, MIN(at) AS first FROM wiki_votes WHERE week = ? GROUP BY page ORDER BY votes DESC, first ASC', week);
}

export interface Featured { page: WikiPage; votes: number; week: string; by: 'vote' | 'held' | 'pick' }
/** This week's featured page (decided once, the first time anyone asks this week). */
export function featured(db: Db, now: number, pages = wikiPages()): Featured | null {
  if (!pages.length) return null;
  const week = weekOf(now);
  const stored = db.meta(`wiki.featured:${week}`);
  if (stored) {
    try { const f = JSON.parse(stored) as { slug: string; votes: number; by: Featured['by'] }; const page = pages.find((p) => p.slug === f.slug); if (page) return { page, votes: f.votes, week, by: f.by }; } catch { /* decide again */ }
  }
  const last = tally(db, weekOf(now - 7 * DAY))[0];
  let slug: string | undefined, votes = 0, by: Featured['by'] = 'vote';
  if (last && pages.some((p) => p.slug === last.page)) { slug = last.page; votes = last.votes; }
  else {
    const held = db.meta('wiki.featured.last');
    if (held && pages.some((p) => p.slug === held)) { slug = held; by = 'held'; }
    else { let h = 0; for (const c of week) h = (h * 31 + c.charCodeAt(0)) >>> 0; slug = pages[h % pages.length]!.slug; by = 'pick'; }
  }
  db.setMeta(`wiki.featured:${week}`, JSON.stringify({ slug, votes, by }));
  db.setMeta('wiki.featured.last', slug);
  return { page: pages.find((p) => p.slug === slug)!, votes, week, by };
}

/** For the site (the live feed): what's featured, and how next week's race looks. */
export function wikiSnapshot(db: Db, now: number) {
  const f = featured(db, now);
  const pages = wikiPages();
  const race = tally(db, weekOf(now)).slice(0, 5).map((r) => ({ slug: r.page, title: pages.find((p) => p.slug === r.page)?.title ?? r.page, votes: r.votes }));
  return f ? { featured: { slug: f.page.slug, title: f.page.title, summary: f.page.summary, votes: f.votes, by: f.by }, week: f.week, race } : null;
}
