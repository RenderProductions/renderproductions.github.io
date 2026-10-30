#!/usr/bin/env node
// Advances every company's price by one step and rewrites prices.json
// in the repo root. Run by .github/workflows/update-prices.yml, or by hand:
//   node .github/scripts/tick.js
//
// Companies also set goals. A goal is announced in the news, and when its
// deadline passes the company either hits it (price jumps up) or misses it
// (price drops). Odds lean on how the stock did while the goal was running.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'prices.json');
const POINTS = 288; // history length kept per company (24 hours at 5 min per tick)

// ---------- Goal tuning ----------
const GOAL_HOURS = [6, 18];     // how long a company has to reach a goal
const COOLDOWN_HOURS = [2, 8];  // quiet time before the next goal is announced
const JUMP = [0.15, 0.35];      // success/failure moves the price 15% to 35%
const MAX_NEWS = 12;            // how many news items prices.json keeps

// To add, remove, or rename a company, edit this list.
// volatility = how far a price can move in one tick (0.04 = up to 4%)
const COMPANIES = [
  { id: 'RRM',  name: 'Render Room',              description: 'The server itself, publicly traded.',  start: 120.00, volatility: 0.016 },
  { id: 'NACH', name: 'De Nacho',                 description: 'Nachos, at scale.',                     start: 45.50,  volatility: 0.020 },
  { id: 'BLU',  name: "Builder's League United",  description: 'Building things together, allegedly.',  start: 78.25,  volatility: 0.014 },
  { id: 'BNW',  name: 'Business Numbers Working', description: 'Numbers. Business. Working, mostly.',   start: 12.80,  volatility: 0.025 }
];

// Goals per company. goal = the announcement, win/lose = the outcome headlines.
// Add as many as you like; a company never picks the same goal twice in a row.
const GOALS = {
  RRM: [
    { goal: 'Render Room aims to hit a new member record.', win: 'Render Room smashes its member record!', lose: 'Render Room falls short of its member record.' },
    { goal: 'Render Room promises a server-wide event with zero outages.', win: 'Render Room event goes off without a hitch!', lose: 'Render Room event crashes halfway through.' },
    { goal: 'Render Room plans to launch a new season on schedule.', win: 'New season launches right on time!', lose: 'New season delayed. Again.' }
  ],
  NACH: [
    { goal: 'De Nacho is opening three new nacho stands.', win: 'De Nacho opens three stands, lines around the block!', lose: 'De Nacho stands fail their health inspection.' },
    { goal: "De Nacho attempts the world's largest nacho.", win: "De Nacho builds the world's largest nacho!", lose: "World's largest nacho collapses under its own cheese." },
    { goal: 'De Nacho vows to survive the cheese shortage.', win: 'De Nacho secures a secret cheese supply!', lose: 'Cheese shortage hits De Nacho hard.' }
  ],
  BLU: [
    { goal: "Builder's League United starts work on a community megabuild.", win: 'BLU finishes the megabuild, and it is magnificent!', lose: 'BLU megabuild abandoned after a dispute over the roof.' },
    { goal: "Builder's League United tries to agree on a single blueprint.", win: 'BLU agrees on a blueprint. Historians stunned.', lose: 'BLU blueprint talks end in shouting.' },
    { goal: "Builder's League United pledges to fix the old bridge.", win: 'BLU fixes the bridge. It holds!', lose: 'BLU bridge repair somehow makes the bridge worse.' }
  ],
  BNW: [
    { goal: 'Business Numbers Working sets out to make the numbers work.', win: 'BNW confirms: the numbers are working!', lose: 'BNW admits the numbers are not working.' },
    { goal: 'Business Numbers Working promises a quarterly report on time.', win: 'BNW publishes its report, and it adds up!', lose: 'BNW report missing several pages and most of the numbers.' },
    { goal: 'Business Numbers Working is hiring a real accountant.', win: 'BNW hires an accountant, investors relieved!', lose: 'BNW accountant quits on day one.' }
  ]
};

const HOUR = 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const between = (lo, hi) => lo + Math.random() * (hi - lo);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Random move, with a gentle pull back toward the starting price
// so nothing drifts to zero or runs away forever.
function step(price, c) {
  const shock = (Math.random() - 0.5) * 2 * c.volatility;
  const pull = ((c.start - price) / c.start) * 0.0035;
  return Math.max(1, round2(price * (1 + shock + pull)));
}

let old = {};
try {
  old = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
} catch (e) {
  // No file yet (or unreadable): every company starts fresh below.
}
const existing = {};
(old.companies || []).forEach((c) => { existing[c.id] = c; });

const now = Date.now();
const nowIso = new Date(now).toISOString();
let news = Array.isArray(old.news) ? old.news.slice() : [];

const unix = (ms) => Math.floor(ms / 1000);

// Each news item also carries a ready-made Discord line, so the bot
// (which can't loop or format easily) just prints it.
// <t:UNIX:R> shows as a live "in 5 hours" / "2 hours ago" in Discord.
function discordLine(item) {
  const tag = item.type === 'success' ? '🟢 **SUCCESS**' : item.type === 'fail' ? '🔴 **FAILED**' : '📢 **NEW GOAL**';
  let extra;
  if (typeof item.move === 'number') {
    extra = (item.move >= 0 ? '▲ +' : '▼ ') + item.move.toFixed(2) + '% on the news';
  } else if (item.deadline) {
    extra = 'Deadline <t:' + unix(Date.parse(item.deadline)) + ':R>';
  }
  return tag + ' · `' + item.id + '` · <t:' + unix(Date.parse(item.time)) + ':R>\n' +
    item.headline + (extra ? '\n*' + extra + '*' : '');
}

function addNews(item) {
  const full = Object.assign({ time: nowIso }, item);
  full.discord = discordLine(full);
  news.unshift(full);
}

const companies = COMPANIES.map((c) => {
  const prev = existing[c.id] || {};
  let history = Array.isArray(prev.history) ? prev.history.slice() : null;

  if (!history || history.length === 0) {
    // New company: build a believable past so the chart isn't empty.
    history = [c.start];
    while (history.length < POINTS) history.push(step(history[history.length - 1], c));
  } else {
    history.push(step(history[history.length - 1], c));
  }

  // ---------- Goals ----------
  const pool = GOALS[c.id] || [];
  let goal = prev.goal || null;
  let lastGoal = Number.isInteger(prev.lastGoal) ? prev.lastGoal : -1;
  // First run: companies announce within the next 2 hours, staggered.
  let nextGoalAt = prev.nextGoalAt || new Date(now + between(0, 2) * HOUR).toISOString();

  // Drop a goal whose template was removed from the list above.
  if (goal && !pool[goal.index]) goal = null;

  if (goal && now >= Date.parse(goal.deadline)) {
    const tpl = pool[goal.index];
    const price = history[history.length - 1];
    // 50/50 by default; a stock that rose during the goal is more likely to succeed.
    const odds = clamp(0.5 + (price / goal.startPrice - 1) * 3, 0.25, 0.75);
    const won = Math.random() < odds;
    const jump = between(JUMP[0], JUMP[1]);
    const newPrice = Math.max(1, round2(price * (won ? 1 + jump : 1 - jump)));
    history[history.length - 1] = newPrice;

    addNews({
      id: c.id,
      name: c.name,
      type: won ? 'success' : 'fail',
      headline: won ? tpl.win : tpl.lose,
      move: round2((newPrice / price - 1) * 100)
    });

    lastGoal = goal.index;
    goal = null;
    nextGoalAt = new Date(now + between(COOLDOWN_HOURS[0], COOLDOWN_HOURS[1]) * HOUR).toISOString();
  } else if (!goal && pool.length && now >= Date.parse(nextGoalAt)) {
    let index = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && index === lastGoal) index = (index + 1) % pool.length;
    const deadline = new Date(now + between(GOAL_HOURS[0], GOAL_HOURS[1]) * HOUR).toISOString();

    goal = { index, text: pool[index].goal, startPrice: history[history.length - 1], deadline };
    addNews({ id: c.id, name: c.name, type: 'goal', headline: pool[index].goal, deadline });
  }

  history = history.slice(-POINTS);
  const price = history[history.length - 1];
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    price,
    change: round2((price / history[0] - 1) * 100), // percent vs. start of history
    history,
    goal,
    lastGoal,
    nextGoalAt
  };
});

news = news.slice(0, MAX_NEWS);

// Lookup tables so the Discord bot can read a value by ticker, e.g. prices.RRM
const prices = {};
const changes = {};
companies.forEach((c) => { prices[c.id] = c.price; changes[c.id] = c.change; });

// headline = newest news item as plain text, handy for a bot command like r!news
const headline = news[0] ? news[0].headline : '';

// newsText = the 5 latest stories, already formatted for a Discord embed (r!news)
// headlineText = just the newest one, formatted (for a field in r!market)
const NEWS_IN_DISCORD = 5;
const withLines = news.map((n) => (n.discord ? n : Object.assign({}, n, { discord: discordLine(n) })));
const newsText = withLines.length
  ? withLines.slice(0, NEWS_IN_DISCORD).map((n) => n.discord).join('\n\n')
  : 'No market news yet. Check back soon.';
const headlineText = withLines[0] ? withLines[0].discord : 'No market news yet.';

const data = { updated: nowIso, prices, changes, headline, headlineText, newsText, news: withLines, companies };

// Keep each history array on one line so commits stay readable.
const text = JSON.stringify(data, null, 2).replace(
  /\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g,
  (m, inner) => '[' + inner.replace(/\s+/g, ' ') + ']'
);

fs.writeFileSync(FILE, text + '\n');
console.log('Updated ' + companies.length + ' companies at ' + data.updated +
  (news[0] && news[0].time === nowIso ? ' | NEWS: ' + news[0].headline : ''));