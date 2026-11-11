// Sit Back and Relax: limit orders and brokers. Both act on their own, once per market tick.
//   Limit orders:  r!order buy RRM 10 at 2.00 · r!order sell BNW all at 15 · r!order sell BLU all below 5
//   Brokers:       hired for a sign-on bonus (1.25x more each time you hire), paid a daily salary plus a cut
//                  of their profits; they follow your rules (buy until, sell at, stop at) with up to 25 shares
//                  per company. Miss a payday and they quit, handing back what they hold.
const config = require('./config');
const reserve = require('./reserve');
const receipts = require('./receipts');
const A = require('./achievements');
const { amt, have, day } = require('./format');

// ---------------------------------------------------------------- shared
const priceOf = (m, t) => Math.round(Number(m.prices[t]) * 100);
const isOpen = (market, m) => m && !market.closedReason(m);
const fake = (deps, guildId, userId) => ({ db: deps.db, guildId, user: { id: userId }, client: deps.client, market: deps.market, notes: [] });

// Shares a player owns in a real company (after any bankruptcy wipe)
function owned(deps, m, guildId, userId, t) { return require('./economy').shares(fake(deps, guildId, userId), m, t, userId); }

// The house sells shares to a player / buys them back (same as r!buy and r!sell)
function buyShares(db, guildId, userId, t, qty, price, have) {
  db.updateHolding(guildId, userId, t, { shares: have + qty });
  db.logTrade(guildId, userId, t, qty, price);
  db.addLot(guildId, userId, t, qty, price);
}
function sellShares(db, guildId, userId, t, qty, price, have) {
  db.updateHolding(guildId, userId, t, { shares: have - qty });
  db.logTrade(guildId, userId, t, -qty, price);
  db.takeLots(guildId, userId, t, qty);
}

// ---------------------------------------------------------------- limit orders
const ORDERS = { max: 10, expireMs: 7 * 24 * 3600 * 1000 };

function place(ctx, m, { side, kind, ticker, qty, price }) {
  const db = ctx.db;
  const open = db.raw.prepare('SELECT COUNT(*) AS n FROM orders WHERE guild_id = ? AND user_id = ?').get(ctx.guildId, ctx.user.id).n;
  if (open >= ORDERS.max) return { error: `📋 You can have up to ${ORDERS.max} orders at once. Cancel one with \`${config.prefix}order cancel <#>\`.` };
  let reserved = 0;
  if (side === 'buy') {
    reserved = qty * price;
    const p = db.player(ctx.guildId, ctx.user);
    if (p.cash < reserved) return { error: `📋 That order sets aside ${amt(reserved)} until it fills. You have ${have(p.cash)}.` };
  }
  const id = db.tx(() => {
    if (reserved) { db.addCash(ctx.guildId, ctx.user.id, -reserved); }
    return db.raw.prepare('INSERT INTO orders (guild_id, user_id, ticker, side, kind, qty, price, reserved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.guildId, ctx.user.id, ticker, side, kind, qty, price, reserved, Date.now()).lastInsertRowid;
  });
  return { id: Number(id), reserved };
}

const list = (db, guildId, userId) => db.raw.prepare('SELECT * FROM orders WHERE guild_id = ? AND user_id = ? ORDER BY id').all(guildId, userId);

function cancel(db, order) {
  db.tx(() => {
    if (order.reserved) db.addCash(order.guild_id, order.user_id, order.reserved);
    db.raw.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
  });
}

function describe(o) {
  const n = o.qty == null ? 'all' : o.qty;
  if (o.side === 'buy') return `Buy ${n} ${o.ticker} at ${amt(o.price)} or less`;
  return o.kind === 'stop' ? `Sell ${n} ${o.ticker} if it falls to ${amt(o.price)}` : `Sell ${n} ${o.ticker} at ${amt(o.price)} or more`;
}

// Fills whatever orders the latest prices reach. Returns what filled (for logs and tests).
function checkOrders(deps, m) {
  const db = deps.db;
  const done = [];
  for (const o of db.raw.prepare('SELECT * FROM orders').all()) {
    if (Date.now() - o.created_at > ORDERS.expireMs) {
      cancel(db, o);
      receipts.send(fake(deps, o.guild_id, o.user_id), { title: 'Order expired', userId: o.user_id, lines: [['Order', describe(o)], ['Returned', o.reserved ? amt(o.reserved) : 'Nothing was set aside']] });
      continue;
    }
    if (!m.prices || m.prices[o.ticker] == null || (m.statuses && m.statuses[o.ticker] === 'bankrupt')) continue;
    const p = priceOf(m, o.ticker);
    if (p <= 0) continue;
    const hit = o.side === 'buy' ? p <= o.price : o.kind === 'stop' ? p <= o.price : p >= o.price;
    if (!hit) continue;
    const ctx = fake(deps, o.guild_id, o.user_id);
    let line;
    db.tx(() => {
      const held = owned(deps, m, o.guild_id, o.user_id, o.ticker);
      if (o.side === 'buy') {
        const cost = o.qty * p;
        buyShares(db, o.guild_id, o.user_id, o.ticker, o.qty, p, held);
        reserve.take(db, cost);
        db.addCash(o.guild_id, o.user_id, o.reserved - cost); // the rest of what was set aside comes back
        line = [['Bought', `${o.qty} ${o.ticker}`], ['Price', amt(p)], ['Total', amt(cost)], ['Returned', amt(o.reserved - cost)]];
      } else {
        const qty = Math.min(o.qty == null ? held : o.qty, held);
        if (qty > 0) {
          sellShares(db, o.guild_id, o.user_id, o.ticker, qty, p, held);
          db.addCash(o.guild_id, o.user_id, qty * p);
          reserve.spend(db, qty * p);
          line = [['Sold', `${qty} ${o.ticker}`], ['Price', amt(p)], ['Total', amt(qty * p)]];
        } else line = [['Nothing sold', `You don't own any ${o.ticker} anymore`]];
      }
      db.raw.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
    });
    A.award(ctx, 'set_and_forget', o.user_id);
    receipts.send(ctx, { title: `${o.kind === 'stop' ? 'Stop' : 'Limit'} order filled`, userId: o.user_id, lines: [['Order', describe(o)], ...line] });
    done.push({ id: o.id, user: o.user_id, ticker: o.ticker, side: o.side, price: p });
  }
  return done;
}

// ---------------------------------------------------------------- brokers
const BROKERS = { cap: 25, baseBonus: 1000_00, growth: 1.25, loyaltyMs: 7 * 24 * 3600 * 1000, logSize: 8 };
const TRAITS = {
  steady:     { emoji: '😐', label: 'Steady',     salary: 100_00, cut: 0.10, perTick: 5,  wait: 0, wild: 0,    desc: 'Does exactly what you say. No surprises.' },
  cautious:   { emoji: '🐢', label: 'Cautious',   salary: 75_00,  cut: 0.08, perTick: 3,  wait: 1, wild: 0,    desc: 'Cheaper, but waits a tick to be sure before acting, so trades land a little late.' },
  aggressive: { emoji: '🐺', label: 'Aggressive', salary: 150_00, cut: 0.15, perTick: 10, wait: 0, wild: 0,    desc: 'Buys fast and big. Takes a bigger cut for the trouble.' },
  gambler:    { emoji: '🎲', label: 'Gambler',    salary: 60_00,  cut: 0.10, perTick: 5,  wait: 0, wild: 0.08, desc: 'The cheapest. Every so often makes a trade you never asked for.' }
};
const NAMES = ['Chad Bullworth', 'Penny Pincher', 'Vinnie "The Ticker"', 'Margaret Ledger', 'Trent Hedgely', 'Dot Com', 'Barry Bearish',
  'Sally Shortsworth', 'Gus Greenbacks', 'Wendy Windfall', 'Hank Hedgefund', 'Ivy Index', 'Duke Dividend', 'Polly Polygon'];

const row = (db, g, u) => db.raw.prepare('SELECT * FROM brokers WHERE guild_id = ? AND user_id = ?').get(g, u);
const get = (db, g, u) => { const b = row(db, g, u); return b && b.active ? b : null; };
const bonus = (hires) => Math.round(BROKERS.baseBonus * Math.pow(BROKERS.growth, hires || 0));
const nextBonus = (db, g, u) => bonus((row(db, g, u) || {}).hires || 0);
const rules = (db, g, u) => db.raw.prepare('SELECT * FROM broker_rules WHERE guild_id = ? AND user_id = ? ORDER BY ticker').all(g, u);
const holdings = (db, g, u) => db.raw.prepare('SELECT * FROM broker_holdings WHERE guild_id = ? AND user_id = ? AND shares > 0 ORDER BY ticker').all(g, u);
function holding(db, g, u, t, m) {
  const h = db.raw.prepare('SELECT * FROM broker_holdings WHERE guild_id = ? AND user_id = ? AND ticker = ?').get(g, u, t) || { shares: 0, cost: 0, wipe_seen: 0 };
  const wipes = Number((m && m.wipes && m.wipes[t]) || 0);
  if (m && h.shares > 0 && wipes > h.wipe_seen) { setHolding(db, g, u, t, 0, 0, wipes); return { shares: 0, cost: 0, wipe_seen: wipes }; } // bankruptcy wipes broker shares too
  return h;
}
function setHolding(db, g, u, t, shares, cost, wipeSeen) {
  db.raw.prepare(`INSERT INTO broker_holdings (guild_id, user_id, ticker, shares, cost, wipe_seen) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, user_id, ticker) DO UPDATE SET shares = excluded.shares, cost = excluded.cost, wipe_seen = COALESCE(?, wipe_seen)`)
    .run(g, u, t, shares, cost, wipeSeen ?? 0, wipeSeen ?? null);
}
// What the broker's shares are worth now (for net worth)
function value(db, g, u, m) {
  if (!m || !m.prices) return 0;
  return holdings(db, g, u).reduce((s, h) => s + (Number((m.wipes || {})[h.ticker] || 0) > h.wipe_seen ? 0 : h.shares * priceOf(m, h.ticker)), 0);
}

// Three people looking for work, new ones every hour
function candidates(userId, now = Date.now()) {
  let seed = [...`${userId}:${Math.floor(now / 3600000)}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  const traits = Object.keys(TRAITS);
  const names = NAMES.slice();
  return [0, 1, 2].map(() => ({ name: names.splice(Math.floor(rnd() * names.length), 1)[0], trait: traits[Math.floor(rnd() * traits.length)] }));
}

function hire(ctx, cand) {
  const db = ctx.db, g = ctx.guildId, u = ctx.user.id;
  if (get(db, g, u)) return { error: '💼 You already have a broker. One at a time.' };
  const cost = nextBonus(db, g, u);
  const p = db.player(g, ctx.user);
  if (p.cash < cost) return { error: `💼 The sign-on bonus is ${amt(cost)}. You have ${have(p.cash)}.` };
  const prev = row(db, g, u);
  db.tx(() => {
    db.addCash(g, u, -cost);
    reserve.take(db, cost);
    db.raw.prepare(`INSERT INTO brokers (guild_id, user_id, active, name, trait, hired_at, paid_day, hires, loyal_at, profit, fees, log)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?, '[]')
      ON CONFLICT (guild_id, user_id) DO UPDATE SET active = 1, name = excluded.name, trait = excluded.trait, hired_at = excluded.hired_at,
        paid_day = excluded.paid_day, hires = excluded.hires, loyal_at = excluded.loyal_at, profit = 0, fees = excluded.fees, log = '[]'`)
      .run(g, u, cand.name, cand.trait, Date.now(), day(Date.now()), ((prev && prev.hires) || 0) + 1, Date.now(), cost);
  });
  A.award(ctx, 'hired_help');
  return { cost, next: bonus(((prev && prev.hires) || 0) + 1) };
}

function setRule(db, g, u, t, field, price) {
  db.raw.prepare('INSERT OR IGNORE INTO broker_rules (guild_id, user_id, ticker) VALUES (?, ?, ?)').run(g, u, t);
  db.raw.prepare(`UPDATE broker_rules SET ${field} = ?, waiting = 0 WHERE guild_id = ? AND user_id = ? AND ticker = ?`).run(price, g, u, t);
}
const clearRules = (db, g, u, t) => db.raw.prepare(`DELETE FROM broker_rules WHERE guild_id = ? AND user_id = ?${t ? ' AND ticker = ?' : ''}`).run(...(t ? [g, u, t] : [g, u]));

function log(db, b, line) {
  let l = [];
  try { l = JSON.parse(b.log || '[]'); } catch (e) { l = []; }
  l.unshift([Date.now(), line]);
  b.log = JSON.stringify(l.slice(0, BROKERS.logSize));
  db.raw.prepare('UPDATE brokers SET log = ? WHERE guild_id = ? AND user_id = ?').run(b.log, b.guild_id, b.user_id);
}

// The broker leaves: what they hold goes back to the player, at what it cost
function leave(deps, b, m, why) {
  const db = deps.db, g = b.guild_id, u = b.user_id;
  const returned = [];
  db.tx(() => {
    for (const h of holdings(db, g, u)) {
      const hh = holding(db, g, u, h.ticker, m);
      if (hh.shares > 0) {
        const mine = m ? owned(deps, m, g, u, h.ticker) : db.holding(g, u, h.ticker).shares;
        db.updateHolding(g, u, h.ticker, { shares: mine + hh.shares });
        db.addLot(g, u, h.ticker, hh.shares, Math.round(hh.cost / hh.shares));
        returned.push(`${hh.shares} ${h.ticker}`);
      }
      setHolding(db, g, u, h.ticker, 0, 0);
    }
    db.raw.prepare('UPDATE brokers SET active = 0 WHERE guild_id = ? AND user_id = ?').run(g, u);
    clearRules(db, g, u);
  });
  return returned;
}

function fire(deps, ctx, m) {
  const b = get(ctx.db, ctx.guildId, ctx.user.id);
  if (!b) return null;
  return { broker: b, returned: leave(deps, b, m, 'fired') };
}

// One market tick for one broker: payday first, then trades
function work(deps, b, m, random = Math.random) {
  const db = deps.db, g = b.guild_id, u = b.user_id;
  const tr = TRAITS[b.trait] || TRAITS.steady;
  const ctx = fake(deps, g, u);
  const today = day(Date.now());
  if (b.paid_day !== today) {
    const p = db.player(g, { id: u });
    if (p.cash < tr.salary) {
      const back = leave(deps, b, m, 'unpaid');
      A.award(ctx, 'youre_fired', u);
      receipts.send(ctx, { title: `${b.name} quit`, userId: u, lines: [['Why', `You couldn't make payday (${amt(tr.salary)})`], ['Handed back', back.join(', ') || 'Nothing'],
        ['Rehiring costs', amt(bonus(b.hires))]] });
      return { quit: true };
    }
    db.tx(() => {
      db.addCash(g, u, -tr.salary);
      reserve.take(db, tr.salary);
      let hires = b.hires, loyal = b.loyal_at || b.hired_at;
      if (hires > 0 && Date.now() - loyal >= BROKERS.loyaltyMs) { hires -= 1; loyal = Date.now(); } // a week of loyalty eases the bonus back a step
      db.raw.prepare('UPDATE brokers SET paid_day = ?, fees = fees + ?, hires = ?, loyal_at = ? WHERE guild_id = ? AND user_id = ?').run(today, tr.salary, hires, loyal, g, u);
      b.hires = hires;
    });
    const hs = holdings(db, g, u);
    receipts.send(ctx, { title: `${b.name}'s daily report`, userId: u, lines: [['Paid', `${amt(tr.salary)} salary`],
      ['Holding', hs.map((h) => `${h.shares} ${h.ticker}`).join(', ') || 'Nothing right now'],
      ['Profit so far', `${b.profit >= 0 ? '+' : '−'}${amt(Math.abs(b.profit))}`]] });
  }
  if (!isOpen(deps.market, m)) return { traded: [] };

  const traded = [];
  for (const r of rules(db, g, u)) {
    if (!m.prices || m.prices[r.ticker] == null || (m.statuses && m.statuses[r.ticker] === 'bankrupt')) continue;
    const p = priceOf(m, r.ticker);
    if (p <= 0) continue;
    const h = holding(db, g, u, r.ticker, m);
    // What the rules say to do
    let act = null;
    if (h.shares > 0 && r.stop != null && p <= r.stop) act = 'stop';
    else if (h.shares > 0 && r.sell != null && p >= r.sell) act = 'sell';
    else if (r.buy != null && p <= r.buy && h.shares < BROKERS.cap) act = 'buy';
    // A gambler sometimes goes off script
    let wild = false;
    if (tr.wild && random() < tr.wild) { wild = true; act = h.shares > 0 && random() < 0.5 ? 'sell' : 'buy'; }
    // A cautious broker waits a tick to be sure
    if (act && !wild && tr.wait) {
      if (r.waiting < tr.wait) { db.raw.prepare('UPDATE broker_rules SET waiting = waiting + 1 WHERE guild_id = ? AND user_id = ? AND ticker = ?').run(g, u, r.ticker); continue; }
    }
    if (r.waiting && (!act || wild || !tr.wait)) db.raw.prepare('UPDATE broker_rules SET waiting = 0 WHERE guild_id = ? AND user_id = ? AND ticker = ?').run(g, u, r.ticker);
    if (!act) continue;

    if (act === 'buy') {
      const cash = db.player(g, { id: u }).cash;
      const qty = Math.min(wild ? 1 + Math.floor(random() * 5) : tr.perTick, BROKERS.cap - h.shares, Math.floor(cash / p));
      if (qty <= 0) continue;
      db.tx(() => {
        db.addCash(g, u, -qty * p);
        reserve.take(db, qty * p);
        setHolding(db, g, u, r.ticker, h.shares + qty, h.cost + qty * p);
      });
      const line = `${wild ? '🎲 Off script: ' : ''}Bought ${qty} ${r.ticker} at ${amt(p)}`;
      log(db, b, line);
      traded.push(line);
    } else {
      const qty = wild ? Math.min(h.shares, 1 + Math.floor(random() * 5)) : h.shares;
      const basis = Math.round((h.cost / h.shares) * qty);
      const proceeds = qty * p;
      const gain = proceeds - basis;
      const cut = gain > 0 ? Math.round(gain * tr.cut) : 0;
      db.tx(() => {
        db.addCash(g, u, proceeds - cut);
        reserve.spend(db, proceeds);
        if (cut) reserve.take(db, cut);
        setHolding(db, g, u, r.ticker, h.shares - qty, h.cost - basis);
        db.raw.prepare('UPDATE brokers SET profit = profit + ?, fees = fees + ? WHERE guild_id = ? AND user_id = ?').run(gain, cut, g, u);
      });
      b.profit += gain;
      const line = `${wild ? '🎲 Off script: ' : act === 'stop' ? '🛑 Stop hit: ' : ''}Sold ${qty} ${r.ticker} at ${amt(p)} (${gain >= 0 ? '+' : '−'}${amt(Math.abs(gain))}${cut ? `, cut ${amt(cut)}` : ''})`;
      log(db, b, line);
      traded.push(line);
      if (b.profit >= 10000_00) A.award(ctx, 'retirement_plan', u);
    }
  }
  return { traded };
}

// Everything that runs once per market tick
function tick(deps, m, random = Math.random) {
  if (!m || !m.prices) return { orders: [], brokers: 0 };
  const orders = isOpen(deps.market, m) ? checkOrders(deps, m) : [];
  let n = 0;
  for (const b of deps.db.raw.prepare('SELECT * FROM brokers WHERE active = 1').all()) {
    try { work(deps, b, m, random); n++; } catch (e) { console.error('[broker]', e); }
  }
  return { orders, brokers: n };
}

module.exports = { ORDERS, BROKERS, TRAITS, NAMES, place, list, cancel, describe, checkOrders, get, row, bonus, nextBonus, rules, holdings, holding,
  value, candidates, hire, fire, setRule, clearRules, work, tick, priceOf };
