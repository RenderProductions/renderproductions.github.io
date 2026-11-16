# RendConomy emojis

The bot's own emojis, drawn for RendConomy: 32×32 pixel art saved at 128×128. Each rim matches the embed color of its system.
See `preview.png` and `preview-set.png` for the whole set.

## Answers

| File | Stands for | Replaces |
|---|---|---|
| `rc_yes.png` | Correct, done | ✅ |
| `rc_no.png` | Wrong, refused | ❌ |
| `rc_time.png` | Time ran out, expired | ⌛ |

## Slot reels

| File | Stands for | Replaces |
|---|---|---|
| `rc_cherry.png` | Cherry (3x) | 🍒 |
| `rc_lemon.png` | Lemon (5x) | 🍋 |
| `rc_bell.png` | Bell (8x) | 🔔 |
| `rc_triangle.png` | Triangle (10x) | 🔺 |
| `rc_diamond.png` | Diamond (25x) | 💎 |

## Roulette pockets

`rc_r0.png` to `rc_r36.png`: each pocket with its number, on its colour (green 0, red and black), with a wooden rim like the wheel.

## Cards

`rc_c<rank><suit>.png` for all 52: rank `2`–`10`, `j`, `q`, `k`, `a`; suit `h`earts, `d`iamonds, `s`pades, `c`lubs (so `rc_cah` is the ace of hearts, `rc_c10s` the ten of spades). `rc_cardback.png` is the back, for TODD's hidden card.

## Minesweeper

`rc_tile.png` is a hidden tile. Opened tiles use `rc_diamond`, bombs use `rc_mines`.

## Update posts

| File | Stands for | Replaces |
|---|---|---|
| `rc_new.png` | New in an update | 🆕 |
| `rc_changed.png` | Changed in an update | 🔧 |
| `rc_fixed.png` | Fixed in an update | 🩹 |
| `rc_hotfix.png` | A hotfix update | 🔥 |
| `rc_removed.png` | Removed in an update | 🗑️ |

## Money

| File | Stands for | Replaces |
|---|---|---|
| `rc_polygon.png` | Polygons | ⬡ |
| `rc_daily.png` | The daily allowance | 🌅 |
| `rc_reserve.png` | The Polygon Reserve | 🏦 |
| `rc_savings.png` | Savings | 🐷 |
| `rc_receipt.png` | Receipts | 🧾 |

## Work

| File | Stands for | Replaces |
|---|---|---|
| `rc_work.png` | Jobs and shifts | 💼 |
| `rc_gig.png` | Gigs | 🛠️ |
| `rc_promoted.png` | Promotions | 🎉 |

## Market

| File | Stands for | Replaces |
|---|---|---|
| `rc_stonks.png` | Prices up, buying | 📈 |
| `rc_crash.png` | Prices down, selling, demotions | 📉 |
| `rc_company.png` | Player companies | 🏢 |
| `rc_broker.png` | Brokers | 👔 |

## Rend-Sino

| File | Stands for | Replaces |
|---|---|---|
| `rc_slots.png` | Slots | 🎰 |
| `rc_coinflip.png` | Coinflip | 🪙 |
| `rc_dice.png` | Dice | 🎲 |
| `rc_roulette.png` | Roulette | 🎡 |
| `rc_blackjack.png` | Blackjack | 🃏 |
| `rc_mines.png` | Minesweeper | 💣 |
| `rc_rocket.png` | Rocket | 🚀 |
| `rc_hilo.png` | Higher or Lower | 🔼 |

## Around town

| File | Stands for | Replaces |
|---|---|---|
| `rc_fishing.png` | Fishing | 🎣 |
| `rc_shop.png` | Marquez's shop | 🛍️ |
| `rc_todd.png` | TODD | 🖥️ |

## People

| File | Stands for | Replaces |
|---|---|---|
| `rc_gift.png` | Gifts | 🎁 |
| `rc_loan.png` | Loans | 📜 |
| `rc_heist.png` | Heists | 🦹 |
| `rc_lottery.png` | The lottery | 🎟️ |

## Progress

| File | Stands for | Replaces |
|---|---|---|
| `rc_achievement.png` | Achievements | 🏆 |
| `rc_leaderboard.png` | Leaderboards | 🏅 |
| `rc_event.png` | World events | 🌐 |

## Adding them to the bot

**Automatic:** on startup the bot uploads every `rc_*.png` here that its application doesn't have yet, then uses them. Add a new PNG to this folder, push, restart: done. (`EMOJI_SYNC=0` in `.env` turns this off.) The update post waits for the uploads, so it can use the new emojis.

**By hand**, if you prefer: Discord Developer Portal → the application → **Emojis**, upload each PNG with its file name as the emoji name, then restart.

Application emojis work in every server the bot is in. Until one is uploaded, the bot keeps using the standard emoji.
Discord shows custom emojis in message text and embed text, but not in embed titles, footers or button labels, so those keep standard emojis.

## Big numbers

Frameless gold digits for numbers Discord shows at jumbo size (a message that is only emojis): the Rocket's multiplier, big casino wins, dice rolls and the lottery pot.

| File | Stands for |
|---|---|
| `rc_n0.png` to `rc_n9.png` | 0–9 |
| `rc_ndot.png` | . |
| `rc_nx.png` | x (multiplier) |
| `rc_npct.png` | % |
| `rc_nplus.png` | + (green) |
| `rc_nminus.png` | - (red) |
| `rc_nk.png`, `rc_nm.png` | K and M (thousands, millions) |
