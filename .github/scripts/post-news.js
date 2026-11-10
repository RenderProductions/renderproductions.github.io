#!/usr/bin/env node
// Posts this tick's market news to Discord through one or more webhooks.
// Run by .github/workflows/update-prices.yml right after prices.json is pushed,
// so Discord never announces something the site didn't save.
//
// Setup: save the webhook URL as a repository secret named DISCORD_WEBHOOK.
// More than one server? Put several URLs in the secret, one per line or comma-separated.
// No secret, or nothing queued: does nothing.
//
// Test the message without posting:  DRY_RUN=1 node .github/scripts/post-news.js queue.json

const fs = require('fs');
const path = require('path');

const NAME = 'Rend-Conomy Market';
const AVATAR = 'https://renderproductions.github.io/bot/market-icon.png';
const BOARD = 'https://renderproductions.github.io/rend-conomy/';

const COLORS = {
  success: 0x57f287,
  fail: 0xff6b6b,
  mixed: 0xf0b232,
  goal: 0xffe600,
  good: 0x57f287,
  bad: 0xff6b6b,
  rumor: 0x8a93ab,
  confirmed: 0x57f287,
  denied: 0x8a93ab,
  market: 0x5865f2,
  crossover: 0xeb459e,
  dividend: 0x2ecc71,
  crash: 0x992d22,
  boom: 0x57f287,
  halt: 0xe67e22,
  brink: 0xf0b232,
  bankrupt: 0x23272a,
  appeal: 0x8a93ab,
  appealDenied: 0xff6b6b,
  bailout: 0x57f287,
  recovered: 0x57f287,
  open: 0xffe600,
  closed: 0x8a93ab,
  up: 0xffe600,
  down: 0xff6b6b
};

const queueFile = process.argv[2] ||
  (process.env.RUNNER_TEMP && path.join(process.env.RUNNER_TEMP, 'market-posts.json'));
const dryRun = !!process.env.DRY_RUN;
const hooks = (process.env.DISCORD_WEBHOOK || '').split(/[\s,]+/).filter(Boolean);

let posts = [];
try { posts = JSON.parse(fs.readFileSync(queueFile, 'utf8')); } catch (e) { /* nothing queued */ }
if (!posts.length) { console.log('No market news to post.'); process.exit(0); }
if (!hooks.length && !dryRun) { console.log('DISCORD_WEBHOOK is not set; skipping ' + posts.length + ' post(s).'); process.exit(0); }

const ts = (iso, style) => '<t:' + Math.floor(Date.parse(iso) / 1000) + ':' + style + '>';
const money = (n) => '⬡ ' + Number(n).toFixed(2); // ⬡ = a price in Polygons

function embed(p) {
  if (p.kind === 'market') {
    if (p.status === 'open') {
      return { color: COLORS.open, description: '🔔 **Opening bell!** Trading is open until ' + ts(p.nextChange, 't') + '.\nGet to `r!work`, and maybe `r!market`.' };
    }
    if (p.status === 'after-hours') {
      return { color: COLORS.closed, description: '🌙 **Closing bell.** Trading is closed for the night. Prices drift until the market reopens ' + ts(p.nextOpen, 'R') + '.' };
    }
    return { color: COLORS.closed, description: '⛔ **Market closed today.** Prices are frozen until ' + ts(p.nextOpen, 'F') + '.' };
  }
  if (p.kind === 'swing') {
    const up = p.move >= 0;
    const verb = up ? 'surges' : 'tumbles';
    return {
      color: up ? COLORS.up : COLORS.down,
      description: (up ? '📈' : '📉') + ' **BIG MOVE** · `' + p.id + '`\n' + p.name + ' ' + verb + ' ' +
        Math.abs(p.move).toFixed(2) + '% in the last hour. Now ' + money(p.price) + '.'
    };
  }
  // News: reuse the ready-made line from the engine, plus the price after the news.
  // Market-wide and crossover stories already list every company's move, so no single price is added.
  const tail = p.price != null ? '\n`' + p.id + '` now ' + money(p.price) : '';
  return { color: COLORS[p.type] || COLORS.goal, description: p.discord + tail };
}

// Discord takes up to 10 embeds per message.
const embeds = posts.map(embed);
const batches = [];
for (let i = 0; i < embeds.length; i += 10) batches.push(embeds.slice(i, i + 10));

async function main() {
  let failed = 0;
  for (const batch of batches) {
    batch[batch.length - 1].footer = { text: 'Live board: ' + BOARD };
    const body = JSON.stringify({ username: NAME, avatar_url: AVATAR, embeds: batch, allowed_mentions: { parse: [] } });
    if (dryRun) { console.log(JSON.stringify(JSON.parse(body), null, 2)); continue; }
    for (const url of hooks) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (!res.ok) { failed++; console.log('Webhook replied ' + res.status + ': ' + (await res.text()).slice(0, 200)); }
      } catch (e) {
        failed++;
        console.log('Webhook request failed: ' + e.message);
      }
    }
  }
  // A Discord hiccup shouldn't mark the price update as failed; the log says what happened.
  console.log('Posted ' + posts.length + ' item(s) to ' + hooks.length + ' webhook(s)' + (failed ? ', ' + failed + ' failed.' : '.'));
}

main();
