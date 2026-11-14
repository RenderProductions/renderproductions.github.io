// Every achievement. Ids are kept from the old bot so unlocks carry over through the reset.
import { polygons, type Cents } from '../core/money';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export const RARITY: Record<Rarity, { label: string; emoji: string; order: number; pay: Cents }> = {
  common: { label: 'Common', emoji: '⚪', order: 0, pay: polygons(250) },
  rare: { label: 'Rare', emoji: '🔵', order: 1, pay: polygons(1000) },
  epic: { label: 'Epic', emoji: '🟣', order: 2, pay: polygons(2500) },
  legendary: { label: 'Legendary', emoji: '🟡', order: 3, pay: polygons(7500) },
  mythic: { label: 'Mythic', emoji: '🌈', order: 4, pay: polygons(250_000) }
};

export const CATEGORIES = {
  start: { label: 'Getting started', emoji: '🌱' },
  market: { label: 'Market', emoji: '📈' },
  jobs: { label: 'Jobs', emoji: '💼' },
  casino: { label: 'Rend-Sino', emoji: '🎰' },
  social: { label: 'Social', emoji: '🤝' },
  companies: { label: 'Companies', emoji: '🏢' },
  heists: { label: 'Heists & Schemes', emoji: '🦹' },
  fishing: { label: 'Fishing', emoji: '🎣' },
  mastery: { label: 'Mastery', emoji: '🌈' },
  secret: { label: 'Secret', emoji: '❓' }
} as const;
export type Category = keyof typeof CATEGORIES;

export interface Achievement { id: string; name: string; desc: string; cat: Category; rarity: Rarity; secret: boolean }

const RAW: [string, string, string, Category, Rarity, boolean?][] = [
  ['first_paycheck', 'First Paycheck', 'Work your first shift', 'start', 'common'],
  ['day_one', 'Day One', 'Claim a daily', 'start', 'common'],
  ['shareholder', 'Shareholder', 'Buy your first share', 'start', 'common'],
  ['diversified', 'Diversified', 'Own shares in all five companies at once', 'start', 'rare'],

  ['buy_the_dip', 'Buy the Dip', 'Buy shares during a market crash', 'market', 'rare'],
  ['diamond_hands', 'Diamond Hands', 'Hold shares from before a crash until its recovery is over', 'market', 'epic'],
  ['paper_hands', 'Paper Hands', 'Sell shares for half of what you paid, or less', 'market', 'common'],
  ['time_well_spent', 'Time Well Spent', 'Hold shares for a week, then sell them for more than you paid', 'market', 'rare'],
  ['wiped_out', 'Wiped Out', 'Lose shares to a bankruptcy', 'market', 'common'],
  ['dividend_collector', 'Dividend Collector', 'Collect ⬡1,000 in dividends', 'market', 'rare'],
  ['millionaire', 'Millionaire', 'Reach a net worth of ⬡1,000,000', 'market', 'legendary'],
  ['bear', 'Bear', 'Open a short', 'market', 'common'],
  ['big_short', 'The Big Short', 'Make ⬡1,000 on one short', 'market', 'epic'],
  ['margin_call', 'Margin Call', 'Get a short covered for you', 'market', 'rare'],
  ['nest_egg', 'Nest Egg', 'Let a savings account run to the end', 'market', 'common'],
  ['hired_help', 'Hired Help', 'Hire a broker', 'market', 'common'],
  ['set_and_forget', 'Set It and Forget It', 'Have a limit order fill', 'market', 'common'],
  ['youre_fired', "You're Fired", "Have a broker quit because you couldn't pay them", 'market', 'rare'],

  ['promoted', 'Promoted', 'Get promoted at a performance review', 'jobs', 'common'],
  ['top_of_the_ladder', 'Top of the Ladder', 'Reach the top rank at a company', 'jobs', 'epic'],
  ['perfect_review', 'Perfect Review', 'Score 10/10 at a performance review', 'jobs', 'rare'],
  ['rush_hour', 'Rush Hour', 'Clear 5 rush rounds in a row', 'jobs', 'epic'],
  ['team_player', 'Team Player', 'Work 10 team shifts', 'jobs', 'rare'],
  ['solidarity', 'Solidarity', 'Join a strike', 'jobs', 'common'],
  ['scab', 'Scab', 'Cross a picket line', 'jobs', 'common'],
  ['pink_slip', 'Pink Slip', 'Get laid off', 'jobs', 'common'],
  ['jack_of_all_trades', 'Jack of All Trades', 'Work at all five companies', 'jobs', 'rare'],
  ['gig_economy', 'Gig Economy', 'Do 25 gigs', 'jobs', 'rare'],

  ['beginners_luck', "Beginner's Luck", 'Win your first casino game', 'casino', 'common'],
  ['high_roller', 'High Roller', 'Place a maximum bet', 'casino', 'rare'],
  ['natural', 'Natural', 'Get a blackjack', 'casino', 'rare'],
  ['bus_driver', 'Bus Driver', 'Ride the Bus all four rounds', 'casino', 'epic'],
  ['field_cleared', 'Field Cleared', 'Clear a whole Minesweeper field', 'casino', 'epic'],
  ['straight_up', 'Straight Up', 'Win a roulette bet on a single number', 'casino', 'rare'],
  ['escorted_out', 'Escorted Out', 'Win so many games in a row that TODD throws you out of the Rend-Sino', 'casino', 'epic'],
  ['moon_shot', 'Moon Shot', 'Cash out a Rocket at 10x or more', 'casino', 'epic'],
  ['photo_finish', 'Photo Finish', 'Win a Polygon Derby bet', 'casino', 'rare'],
  ['jackpot', 'Jackpot', 'Win the lottery', 'casino', 'legendary'],
  ['down_bad', 'Down Bad', 'Lose 10 casino games in a row', 'casino', 'rare'],

  ['first_catch', "Gone Fishin'", 'Catch your first fish', 'fishing', 'common'],
  ['moby_dick', 'Moby Dick', 'Catch a whale', 'fishing', 'epic'],
  ['bigger_fish', "There's Always a Bigger Fish", 'Use a fish as bait and catch a bigger one', 'fishing', 'rare'],
  ['fish_in_the_sea', 'Plenty of Fish in the Sea', 'Catch 200 fish', 'fishing', 'epic'],

  ['crew_up', 'Crew Up', 'Pull off a heist', 'heists', 'common'],
  ['red_handed', 'Red-Handed', 'Get caught in a heist', 'heists', 'common'],
  ['dream_team', 'Dream Team', 'Pull off a heist with a full crew of 5 and every role', 'heists', 'epic'],
  ['inside_job', 'Inside Job', 'Rob the Polygon Reserve', 'heists', 'legendary'],
  ['hostile', 'Hostile Takeover', 'Take over a player company', 'heists', 'epic'],
  ['poison_pill', 'Poison Pill', 'Fight off a takeover of your company', 'heists', 'rare'],
  ['merger', 'Better Together', 'Merge two companies', 'heists', 'rare'],

  ['generous', 'Generous', 'Gift ⬡1,000 in total', 'social', 'rare'],
  ['loan_shark', 'Loan Shark', 'Lend Polygons at 25% a day', 'social', 'rare'],
  ['debt_free', 'Debt Free', 'Pay TODD back in full', 'social', 'common'],
  ['merciful', 'Merciful', 'Forgive a loan', 'social', 'rare'],
  ['quick_draw', 'Quick Draw', 'Win a TODD drop-in', 'social', 'common'],
  ['chatterbox', 'Chatterbox', 'Earn ⬡2,500 from chat pay', 'social', 'rare'],

  ['founder', 'Founder', 'Found a company', 'companies', 'rare'],
  ['going_public', 'Going Public', 'Take your company public', 'companies', 'epic'],
  ['conglomerate', 'Conglomerate', 'Grow your company into a Conglomerate', 'companies', 'legendary'],

  ['soon_friend', 'Soon, Friend', 'Find the number', 'secret', 'epic', true],
  ['tip_the_house', 'Tip the House', 'Try to give the house a gift', 'secret', 'rare', true],
  ['retirement_plan', 'Retirement Plan', 'Have a broker make ⬡10,000 in profit', 'secret', 'legendary', true],
  ['completionist', 'Completionist', 'Unlock every other achievement', 'mastery', 'mythic']
];

export const ACHIEVEMENTS: readonly Achievement[] = RAW.map(([id, name, desc, cat, rarity, secret = false]) => ({ id, name, desc, cat, rarity, secret }));
export const BY_ID: Readonly<Record<string, Achievement>> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
