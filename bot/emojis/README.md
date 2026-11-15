# RendConomy emojis

The bot's own emojis, drawn for RendConomy (32×32 pixel art, saved at 128×128).

| File | Stands for | Replaces |
|---|---|---|
| `rc_new.png` | New in an update | 🆕 |
| `rc_changed.png` | Changed in an update | 🔧 |
| `rc_fixed.png` | Fixed in an update | 🩹 |
| `rc_hotfix.png` | A hotfix update | 🔥 |
| `rc_removed.png` | Removed in an update | 🗑️ |

## Adding them to the bot

1. Discord Developer Portal → the RendConomy application → **Emojis**.
2. Upload each PNG. Keep the file name as the emoji name (`rc_new`, `rc_changed`, …).
3. Restart the bot. The console lists the emojis it found; update posts use them from then on.

Application emojis work in every server the bot is in, and the bot needs no extra permissions to use them.
Until one is uploaded, the bot keeps using the standard emoji in the table.
