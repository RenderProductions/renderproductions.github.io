// Helpers for message buttons. Discord allows 5 buttons per row and 5 rows per message.
const { ButtonStyle, ComponentType } = require('discord.js');

const STYLE = { primary: ButtonStyle.Primary, grey: ButtonStyle.Secondary, green: ButtonStyle.Success, red: ButtonStyle.Danger };

// button('Ban', 'work:123:ab:0', 'red')
function button(label, id, style = 'grey', disabled = false) {
  return { type: ComponentType.Button, style: STYLE[style] || STYLE.grey, label: String(label).slice(0, 80), custom_id: id, disabled };
}

// Packs buttons into rows of 5 (at most 5 rows)
function rows(buttons) {
  const out = [];
  for (let i = 0; i < buttons.length && out.length < 5; i += 5) {
    out.push({ type: ComponentType.ActionRow, components: buttons.slice(i, i + 5) });
  }
  return out;
}

// A short random id so old buttons can't answer a newer question
const nonce = () => Math.random().toString(36).slice(2, 8);

module.exports = { button, rows, nonce };
