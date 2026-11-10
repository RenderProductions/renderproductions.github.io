// Helpers for message buttons. Discord allows 5 buttons per row and 5 rows per message.
const { ButtonStyle, ComponentType } = require('discord.js');

const STYLE = { primary: ButtonStyle.Primary, grey: ButtonStyle.Secondary, green: ButtonStyle.Success, red: ButtonStyle.Danger };

const STYLE_ALIAS = { blue: 'primary' };

// button('Ban', 'work:123:ab:0', 'red') or button('cheese', id, 'grey', false, '🧀')
function button(label, id, style = 'grey', disabled = false, emoji = null) {
  const b = { type: ComponentType.Button, style: STYLE[STYLE_ALIAS[style] || style] || STYLE.grey, label: String(label).slice(0, 80), custom_id: id, disabled };
  // Discord only takes real emoji on buttons (⬢ and similar symbols are rejected), so anything else is left off
  if (emoji && /\p{Extended_Pictographic}/u.test(emoji)) b.emoji = { name: emoji };
  return b;
}

// Packs buttons into rows of 5, or of perRow (at most 5 rows)
function rows(buttons, perRow = 5) {
  const out = [];
  const n = Math.max(1, Math.min(5, perRow));
  for (let i = 0; i < buttons.length && out.length < 5; i += n) {
    out.push({ type: ComponentType.ActionRow, components: buttons.slice(i, i + n) });
  }
  return out;
}

// A short random id so old buttons can't answer a newer question
const nonce = () => Math.random().toString(36).slice(2, 8);

module.exports = { button, rows, nonce };
