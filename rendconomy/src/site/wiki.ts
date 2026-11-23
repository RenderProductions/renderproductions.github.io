// The wiki's numbers (/wiki/data.json), built straight from the bot's own tables so they can never go stale.
// Regenerate with `npm run wiki` (a test fails if the committed file doesn't match the code).
import fs from 'node:fs';
import path from 'node:path';
import { ACHIEVEMENTS, CATEGORIES, RARITY } from '../achievements/list';
import { CASINO, JACKPOT, NAMES, ODDS, VIP } from '../casino/core';
import { commands } from '../commands';
import { SECTIONS } from '../commands/general';
import { CLOSE, CO, LEVELS, PAY_PRICE, TAKEOVER } from '../companies/companies';
import { economy } from '../config';
import { RESERVE_RULES } from '../core/economy';
import { ESTATE, KINDS, KIND_ORDER, taxRate } from '../estate/estate';
import { LANDMARKS } from '../estate/landmarks';
import { EVENTS } from '../events/world';
import { CROPS, FARMING, GRADES, MARKET, MUTATIONS, PRICE_SWING } from '../farming/farming';
import { CATCH, FISHING, SIZE_NAMES, TABLES } from '../fishing/fishing';
import { HEIST, ROLES, TARGETS } from '../heists/heists';
import { LOANS } from '../loans/loans';
import { BROKERS, ORDERS, SHORTS, TRAITS } from '../market/schemes';
import { MOD_SLASH } from '../discord/router';
import { COLLECTIBLES, ITEMS, SHELVES } from '../shop/items';
import { SELL_BACK, SHOP_RULES } from '../shop/shop';
import { BULK_MAX, MYSTERY } from '../shop/use';
import { BEG } from '../commands/beg';
import { COLLECT } from '../loans/collect';
import { WHOLESALE } from '../estate/wholesale';
import { CHATTER } from '../social/chatter';
import { SAVINGS } from '../social/savings';
import { CONTRABAND, LOOT, UG } from '../underground/underground';
import { COMPANIES, JOB_RULES, RANK_PAY } from '../work/jobs';

export const WIKI_DATA_FILE = path.join(__dirname, '..', '..', '..', '..', 'wiki', 'data.json');
export const EMOJI_DIR = path.join(__dirname, '..', '..', '..', '..', 'bot', 'emojis');
const p = (cents: number): number => cents / 100;   // Polygons, for the page
const hours = (ms: number): number => ms / 3_600_000;

export function wikiData(): Record<string, unknown> {
  const visible = commands.filter((c) => !c.hidden);
  return {
    economy: { startingCash: p(economy.startingCash), daily: p(economy.dailyAmount), reserve: p(economy.reserveStart), shrinkBelow: RESERVE_RULES.shrinkBelow, minFactor: RESERVE_RULES.minFactor, startingPrices: Object.fromEntries(Object.entries(economy.startingPrices).map(([k, v]) => [k, p(v)])) },
    sections: Object.fromEntries(Object.entries(SECTIONS).map(([k, v]) => [k, { label: v.label, emoji: v.emoji, count: visible.filter((c) => c.system === k).length }])),
    commands: visible.map((c) => ({
      name: c.name, aliases: c.aliases ?? [], description: c.description, section: c.system,
      slash: c.system === 'admin' ? `/${MOD_SLASH} ${c.name}` : `/${c.name}`,
      options: (c.options ?? []).map((o) => ({ name: o.name, description: o.description, required: !!o.required }))
    })),
    items: Object.values(ITEMS).filter((i) => i.ready !== false).map((i) => ({ id: i.id, emoji: i.emoji, name: i.name, price: i.price === null ? null : p(i.price), stock: i.stock, shelf: SHELVES[i.shelf].label, desc: i.desc, passive: !!i.passive, unlock: !!i.unlock })),
    collectibles: Object.values(COLLECTIBLES).map((i) => ({ id: i.id, emoji: i.emoji, name: i.name, price: i.price === null ? null : p(i.price), stock: i.stock, shelf: SHELVES[i.shelf].label, desc: i.desc })),
    shop: { restockHours: hours(SHOP_RULES.restockMs), mystery: SHOP_RULES.mystery },
    rarity: Object.fromEntries(Object.entries(RARITY).map(([k, r]) => [k, { label: r.label, emoji: r.emoji, pay: p(r.pay) }])),
    achievements: ACHIEVEMENTS.map((a) => (a.secret
      ? { id: `secret-${ACHIEVEMENTS.indexOf(a)}`, name: '???', desc: 'A secret. Keep playing.', category: CATEGORIES[a.cat].label, rarity: a.rarity, secret: true }
      : { id: a.id, name: a.name, desc: a.desc, category: CATEGORIES[a.cat].label, rarity: a.rarity, secret: false })),
    refined: {
      mystery: { jackpotChance: MYSTERY.jackpotChance, jackpot: p(MYSTERY.jackpot), overtimeChance: MYSTERY.overtimeChance, cash: MYSTERY.cash },
      collect: { graceDays: COLLECT.graceMs / 86_400_000, fee: COLLECT.fee },
      wholesale: WHOLESALE,
      payPrice: PAY_PRICE, sellBack: SELL_BACK, bulkMax: BULK_MAX, closeFee: CLOSE.fee, refoundDays: CLOSE.refoundMs / 86_400_000, salvage: ESTATE.salvage, sellBackEstate: ESTATE.sellBack,
      beg: { coins: BEG.coins, coinChance: BEG.chances.coins, trinketChance: BEG.chances.trinket, caught: BEG.caught.map((c) => ({ above: p(c.above), chance: c.chance })), fineShare: BEG.fineShare, fineMax: p(BEG.fineMax), cooldownMinutes: BEG.cooldownMs / 60_000 }
    },
    work: { companies: Object.values(COMPANIES).map((c) => ({ ticker: c.ticker, name: c.name, role: c.role, ranks: c.ranks })), rankPay: RANK_PAY, basePay: p(JOB_RULES.basePay), workMinutes: JOB_RULES.workCooldownMs / 60_000, gigMinutes: JOB_RULES.gigCooldownMs / 60_000, gigShare: JOB_RULES.gigShare, review: JOB_RULES.review, team: { each: JOB_RULES.team.each, max: JOB_RULES.team.max }, rushChance: JOB_RULES.rushChance, maxRush: JOB_RULES.maxRush, tipMax: JOB_RULES.tipMax, missShare: JOB_RULES.missShare, quitLockHours: hours(JOB_RULES.quitLockMs) },
    chatter: { min: p(CHATTER.chat.min), max: p(CHATTER.chat.max), perDay: p(CHATTER.chat.perDay), dropChance: CHATTER.drop.chance },
    savings: { plans: SAVINGS.plans, min: p(SAVINGS.min), maxTotal: p(SAVINGS.maxTotal), maxAccounts: SAVINGS.maxAccounts },
    loans: { toddLend: p(LOANS.todd.lend), toddOwe: p(LOANS.todd.owe), toddBelow: p(LOANS.todd.brokeBelow), maxRate: LOANS.maxRate, termDays: LOANS.termMs / 86_400_000, garnish: LOANS.garnishShare },
    market: { orders: { max: ORDERS.max, expireDays: ORDERS.expireMs / 86_400_000 }, shorts: SHORTS, brokers: { cap: BROKERS.cap, traits: Object.values(TRAITS).map((t) => ({ label: t.label, emoji: t.emoji, salary: p(t.salary), cut: t.cut, desc: t.desc })) } },
    companies: { levels: LEVELS.map((l) => ({ name: l.name, cost: p(l.cost), upkeep: p(l.upkeep), payMult: l.payMult })), ipoLevel: CO.ipoLevel, listingFee: p(CO.listingFee), totalShares: CO.totalShares, float: CO.float, takeover: TAKEOVER },
    casino: { games: Object.entries(NAMES).map(([id, name]) => ({ id, name, odds: ODDS[id as keyof typeof ODDS], maxBet: p(CASINO.maxBet[id as keyof typeof CASINO.maxBet]) })), minBet: p(CASINO.minBet), hotStreak: CASINO.hotStreak, banHours: hours(CASINO.banMs), jackpot: { seed: p(JACKPOT.seed), cut: JACKPOT.cut, happyCut: JACKPOT.happyCut }, vip: VIP.map((v) => ({ name: v.name, emoji: v.emoji, at: p(v.at), spin: p(v.spin) })) },
    heists: { roles: Object.values(ROLES).map((r) => ({ label: r.label, emoji: r.emoji, odds: r.odds, haul: r.haul })), targets: Object.entries(TARGETS).map(([id, t]) => ({ id, label: t.label, emoji: t.emoji, odds: t.odds, stake: p(t.stake), haul: t.haul.map(p), needs: t.needs })), rules: { minCrew: HEIST.minCrew, maxCrew: HEIST.maxCrew, playerGapHours: hours(HEIST.playerGapMs), serverGapHours: hours(HEIST.serverGapMs), fine: HEIST.fine, getaway: HEIST.getaway } },
    fishing: { cooldownMinutes: FISHING.cooldownMs / 60_000, bait: p(FISHING.bait), lureCasts: FISHING.lureCasts, bagMax: FISHING.bagMax, sizes: SIZE_NAMES, catch: Object.entries(CATCH).map(([id, c]) => ({ id, emoji: c.emoji, name: c.name, size: SIZE_NAMES[c.size], value: p(c.value) })), tables: TABLES },
    farming: { startPlots: FARMING.startPlots, maxPlots: FARMING.maxPlots, barnPlots: FARMING.barnPlots, plotPrices: FARMING.plotPrices.map(p), wage: p(FARMING.farmhandWage),
      crops: Object.values(CROPS).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, seed: c.seedPrice, value: p(c.value), growHours: Math.round(hours(c.growMs) * 10) / 10, harvests: c.harvests })),
      mutations: Object.entries(MUTATIONS).map(([id, m]) => ({ id, label: m.label, emoji: m.emoji, mult: m.mult, chance: m.chance })),
      grades: Object.entries(GRADES).map(([id, g]) => ({ id, label: g.label, band: g.band, chance: g.chance, fertChance: g.fertChance })),
      priceSwing: PRICE_SWING, octoberPumpkins: MARKET.octoberPumpkins, farmersMarket: MARKET.farmersMarket },
    city: { size: 8, land: p(ESTATE.land), levelRent: ESTATE.levelRent, levelCost: ESTATE.levelCost, tax: [1, 4, 9, 17].map((n) => ({ from: n, rate: taxRate(n) })),
      buildings: KIND_ORDER.map((k) => { const b = KINDS[k]; return { id: k, name: b.name, emoji: b.emoji, price: p(b.price), rent: p(b.rent), upkeep: p(b.upkeep), hours: b.buildHours, maxLevel: b.maxLevel, perk: b.perk, perkText: b.perkText }; }),
      landmarks: LANDMARKS.map((l) => ({ id: l.id, name: l.name, emoji: l.emoji, cost: p(l.cost), perk: l.perk })),
      freight: { bonus: ESTATE.freightBonus, goods: p(ESTATE.freightGoods), marquezGoods: p(ESTATE.goodsPrice), gapHours: hours(ESTATE.freightGapMs), minutes: ESTATE.freightMs / 60_000 } },
    underground: { contraband: Object.values(CONTRABAND).map((c) => ({ name: c.name, price: p(c.price), heat: c.heat, desc: c.desc })), loot: Object.values(LOOT).map((l) => ({ name: l.name, emoji: l.emoji, value: l.value.map(p) })), smuggle: [p(UG.smuggleMin), p(UG.smuggleMax)], snitchCost: p(UG.snitchCost) },
    events: Object.entries(EVENTS).map(([id, e]) => ({ id, emoji: e.emoji, name: e.name, desc: e.desc('a company') })),
    emojis: fs.existsSync(EMOJI_DIR) ? fs.readdirSync(EMOJI_DIR).filter((f) => /^rc_.*\.png$/.test(f)).map((f) => f.slice(3, -4)).sort() : []
  };
}

export const wikiJson = (): string => `${JSON.stringify(wikiData(), null, 1)}\n`;
export function writeWikiData(): string { fs.mkdirSync(path.dirname(WIKI_DATA_FILE), { recursive: true }); fs.writeFileSync(WIKI_DATA_FILE, wikiJson()); return WIKI_DATA_FILE; }
