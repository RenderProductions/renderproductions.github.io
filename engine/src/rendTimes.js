// The Rend Times: a vague tip about one company's hidden market state (mood, health, secrets, fair value).
// Only the bot's own market has the hidden state to read; otherwise the presses are down.
const jobs = require('./jobs');

function tip(db, random = Math.random) {
  let state, prices;
  try { state = JSON.parse(db.meta('mk_state') || 'null'); prices = JSON.parse(db.meta('mk_old') || 'null'); } catch (e) { state = null; }
  if (!state || !state.co) return 'The presses are down today. Nobody is printing anything. (Try again later.)';
  const ids = Object.keys(state.co).filter((id) => jobs.COMPANIES[id]);
  const id = ids[Math.floor(random() * ids.length)];
  const s = state.co[id];
  const name = jobs.COMPANIES[id].name;
  const hints = [];
  const trend = s.mood ? s.mood.trend : 0;
  if (trend > 0.05) hints.push(`Insiders at **${name}** are quietly optimistic.`);
  else if (trend < -0.05) hints.push(`People leaving **${name}** headquarters look nervous.`);
  else hints.push(`It's a quiet week at **${name}**. Maybe too quiet.`);
  if (typeof s.health === 'number') {
    if (s.health > 0.3) hints.push('Word is the books look healthy.');
    else if (s.health < -0.3) hints.push('Someone saw an accountant crying in the parking lot.');
  }
  if (s.secret) hints.push(s.secret.leakDir > 0 ? 'Rumor has it something good is brewing behind closed doors.' : s.secret.leakDir < 0 ? 'Rumor has it someone is about to get some bad news.' : 'Something is going on behind closed doors.');
  const price = prices && prices.prices ? Number(prices.prices[id]) : NaN;
  if (Number.isFinite(price) && price > 0 && typeof s.lnFair === 'number') {
    const ratio = Math.exp(s.lnFair) / price;
    if (ratio > 1.2) hints.push('One analyst thinks the stock is a bargain.');
    else if (ratio < 0.8) hints.push('One analyst thinks the stock is overpriced.');
  }
  return hints.slice(0, 2 + (random() < 0.5 ? 1 : 0)).join(' ') + '\n-# The Rend Times is not responsible for your trades.';
}

module.exports = { tip };
