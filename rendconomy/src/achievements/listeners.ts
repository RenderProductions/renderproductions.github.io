// Which game events unlock which achievements. Systems announce what happened; this file decides.
// Achievements for systems not yet ported are awarded by those systems when they arrive.
import { economy } from '../config';
import { onNewPlayer, payFromReserve } from '../core/economy';
import { on } from '../core/events';
import { wallet } from '../core/ledger';
import { format } from '../core/money';
import { currentRequest } from '../core/request';
import { polygons } from '../core/money';
import { DAY } from '../core/time';
import { load as loadMarket } from '../market/market';
import { sharesOf } from '../market/trading';
import { netWorth } from '../social/worth';
import { COMPANIES } from '../work/jobs';
import { awardHere, bump, payoutValue } from './achievements';

let installed = false;

function checkMillionaire(guildId: string, userId: string): void {
  const req = currentRequest();
  if (!req) return;
  if (netWorth(req.db, loadMarket(req.db), guildId, userId) >= polygons(1_000_000)) awardHere('millionaire', userId);
}

export function installAchievementListeners(): void {
  if (installed) return;
  installed = true;

  // The fresh start after the reset: a new account in a server pays out the achievements unlocked there again
  onNewPlayer((db, guildId, userId, now) => {
    const value = payoutValue(db, guildId, userId);
    if (value <= 0) return;
    const paid = payFromReserve(db, economy.reserveStart, { to: wallet(guildId, userId), cents: value, reason: 'achievement.restart', guildId, actorId: userId, now });
    const req = currentRequest();
    if (paid > 0 && req && req.userId === userId) req.notes.push(`Fresh start: your achievements from this server paid out again, ${format(paid)}.`);
  });

  on('daily.claimed', (e) => { awardHere('day_one', e.userId); checkMillionaire(e.guildId, e.userId); });

  on('stock.bought', (e) => {
    awardHere('shareholder', e.userId);
    const req = currentRequest();
    if (!req) return;
    const m = loadMarket(req.db);
    if (!m) return;
    const crash = m.crash as { phase?: string } | null | undefined;
    if (crash && (crash.phase === 'crash' || crash.phase === 'tremor')) awardHere('buy_the_dip', e.userId);
    if (m.companies.every((c) => sharesOf(req.db, m, e.guildId, e.userId, c.id) > 0)) awardHere('diversified', e.userId);
  });

  on('stock.sold', (e) => {
    const req = currentRequest();
    if (e.lots.some((l) => e.priceCents <= l.price_cents / 2)) awardHere('paper_hands', e.userId);
    if (req && e.lots.some((l) => req.now - l.bought_at >= 7 * DAY && e.priceCents > l.price_cents)) awardHere('time_well_spent', e.userId);
    checkMillionaire(e.guildId, e.userId);
  });

  on('stock.wiped', (e) => awardHere('wiped_out', e.userId));

  on('dividends.claimed', (e) => {
    const req = currentRequest();
    if (req && bump(req.db, e.userId, 'dividends', e.cents) >= polygons(1000)) awardHere('dividend_collector', e.userId);
  });

  on('work.shift', (e) => {
    const req = currentRequest();
    if (!req) return;
    if (e.rush === 0) awardHere('first_paycheck', e.userId);
    if (e.rush >= 5 && e.result === 'pass') awardHere('rush_hour', e.userId);
    if (e.team && bump(req.db, e.userId, 'team_shifts') >= 10) awardHere('team_player', e.userId);
    const worked = req.db.all<{ ticker: string }>('SELECT ticker FROM careers WHERE guild_id = ? AND user_id = ? AND shifts > 0', e.guildId, e.userId).map((r) => r.ticker);
    if (Object.keys(COMPANIES).every((t) => worked.includes(t) || t === e.ticker)) awardHere('jack_of_all_trades', e.userId);
    checkMillionaire(e.guildId, e.userId);
  });

  on('work.review', (e) => {
    if (e.outcome === 'promoted') awardHere('promoted', e.userId);
    if (e.rank === 3) awardHere('top_of_the_ladder', e.userId);
    if (e.score >= 10) awardHere('perfect_review', e.userId);
  });

  on('work.gig', (e) => {
    const req = currentRequest();
    if (req && bump(req.db, e.userId, 'gigs') >= 25) awardHere('gig_economy', e.userId);
  });

  on('work.laidoff', (e) => awardHere('pink_slip', e.userId));

  on('gift.sent', (e) => {
    const req = currentRequest();
    if (req && bump(req.db, e.fromId, 'gifted', e.cents) >= polygons(1000)) awardHere('generous', e.fromId);
  });

  on('savings.matured', (e) => awardHere('nest_egg', e.userId));
}
