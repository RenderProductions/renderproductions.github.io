// Loans between players (idea by KorbedOut).
//
//   r!loan @lender 1000 4  -> asks @lender for 1,000 Polygons at 4% a day. They get Accept/Decline buttons.
//   Interest compounds once a day on what's still owed, until the loan is due (7 days).
//   After that interest stops, and half of the borrower's earnings (work, daily, dividends)
//   go to the lender automatically until it's paid. r!payback pays early.
//
// Loans are per server, like balances.

const RULES = {
  maxRate: 25,                       // percent per day
  termMs: 7 * 24 * 60 * 60 * 1000,   // due a week after it's taken
  dayMs: 24 * 60 * 60 * 1000,
  garnishShare: 0.5,                 // share of earnings taken for overdue loans
  requestMs: 10 * 60 * 1000          // how long a request waits for the lender
};

// ---- requests waiting for the lender's answer (kept in memory; they only last 10 minutes) ----
const requests = new Map();
let nextId = 1;
function addRequest(req) {
  const id = `${Date.now().toString(36)}${(nextId++).toString(36)}`;
  requests.set(id, { ...req, id, expires: Date.now() + RULES.requestMs });
  return id;
}
function takeRequest(id) {
  const r = requests.get(id);
  if (!r) return null;
  requests.delete(id);
  return r;
}

// ---- reading ----

// Adds any daily interest that's due (only up to the due date) and saves it.
function accrue(db, loan, now = Date.now()) {
  if (loan.status !== 'active') return loan;
  const until = Math.min(now, loan.due_at);
  const days = Math.floor((until - loan.last_accrual) / RULES.dayMs);
  if (days <= 0) return loan;
  const owed = Math.round(loan.owed * Math.pow(1 + loan.rate / 100, days));
  const last = loan.last_accrual + days * RULES.dayMs;
  db.raw.prepare('UPDATE loans SET owed = ?, last_accrual = ? WHERE id = ?').run(owed, last, loan.id);
  return { ...loan, owed, last_accrual: last };
}

function active(db, guildId, { borrower, lender } = {}, now = Date.now()) {
  let sql = "SELECT * FROM loans WHERE guild_id = ? AND status = 'active'";
  const args = [guildId];
  if (borrower) { sql += ' AND borrower_id = ?'; args.push(borrower); }
  if (lender) { sql += ' AND lender_id = ?'; args.push(lender); }
  return db.raw.prepare(sql + ' ORDER BY due_at, id').all(...args).map((l) => accrue(db, l, now));
}

// The active loan between two players, in either direction
function between(db, guildId, a, b, now = Date.now()) {
  const l = db.raw.prepare(`SELECT * FROM loans WHERE guild_id = ? AND status = 'active'
    AND ((lender_id = ? AND borrower_id = ?) OR (lender_id = ? AND borrower_id = ?))`).get(guildId, a, b, b, a);
  return l ? accrue(db, l, now) : null;
}

const totalOwed = (db, guildId, userId, now) => active(db, guildId, { borrower: userId }, now).reduce((s, l) => s + l.owed, 0);
const totalLent = (db, guildId, userId, now) => active(db, guildId, { lender: userId }, now).reduce((s, l) => s + l.owed, 0);
const overdue = (l, now = Date.now()) => now >= l.due_at;

// ---- writing ----

function create(db, { guildId, lender, borrower, amount, rate }, now = Date.now()) {
  return db.tx(() => {
    db.player(guildId, lender);
    db.player(guildId, borrower);
    db.addCash(guildId, lender.id, -amount);
    db.addCash(guildId, borrower.id, amount);
    const r = db.raw.prepare(`INSERT INTO loans (guild_id, lender_id, lender_name, borrower_id, borrower_name, principal, rate, owed, created_at, due_at, last_accrual)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(guildId, lender.id, lender.username || null, borrower.id, borrower.username || null,
      amount, rate, amount, now, now + RULES.termMs, now);
    return Number(r.lastInsertRowid);
  });
}

// Moves cents from the borrower's earnings or wallet to the lender. Returns how much went in.
function pay(db, loan, cents, now = Date.now(), { fromWallet = true } = {}) {
  const amount = Math.min(cents, loan.owed);
  if (amount <= 0) return 0;
  const left = loan.owed - amount;
  if (fromWallet) db.addCash(loan.guild_id, loan.borrower_id, -amount);
  db.player(loan.guild_id, { id: loan.lender_id });
  db.addCash(loan.guild_id, loan.lender_id, amount);
  db.raw.prepare('UPDATE loans SET owed = ?, status = ?, paid_at = ? WHERE id = ?')
    .run(left, left <= 0 ? 'paid' : 'active', left <= 0 ? now : null, loan.id);
  return amount;
}

// The lender lets it go: nothing more is owed
function forgive(db, loan, now = Date.now()) {
  db.raw.prepare("UPDATE loans SET status = 'forgiven', owed = 0, paid_at = ? WHERE id = ?").run(now, loan.id);
}

// Earnings with overdue loans get split: half goes to lenders (oldest first), the rest is kept.
// Call this instead of adding the cents yourself. Returns { kept, taken, note }.
function garnish(db, guildId, userId, cents, now = Date.now()) {
  const due = active(db, guildId, { borrower: userId }, now).filter((l) => overdue(l, now));
  let pool = due.length ? Math.floor(cents * RULES.garnishShare) : 0;
  const paidTo = [];
  for (const l of due) {
    if (pool <= 0) break;
    const went = pay(db, l, pool, now, { fromWallet: false });
    pool -= went;
    if (went > 0) paidTo.push({ name: l.lender_name || 'a lender', cents: went, cleared: went >= l.owed });
  }
  const taken = paidTo.reduce((s, p) => s + p.cents, 0);
  db.addCash(guildId, userId, cents - taken);
  return { kept: cents - taken, taken, paidTo };
}

module.exports = { RULES, requests, addRequest, takeRequest, accrue, active, between, totalOwed, totalLent, overdue, create, pay, forgive, garnish };
