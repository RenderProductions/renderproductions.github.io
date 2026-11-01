#!/usr/bin/env node
// Copies the Discord server's banner to og/discord.png, the link-preview
// image for /discord/. Run by .github/workflows/discord-banner.yml.
// If the server has no banner (it needs Boost Level 2), the file is left alone.

const fs = require('fs');
const path = require('path');

const INVITE = 'D2v4EsuZBU';
const OUT = path.join(__dirname, '..', '..', 'og', 'discord.png');

async function main() {
  const res = await fetch('https://discord.com/api/v10/invites/' + INVITE + '?with_counts=true');
  if (!res.ok) { console.log('Invite lookup failed: HTTP ' + res.status + '. Leaving the preview as is.'); return; }
  const g = (await res.json()).guild || {};
  if (!g.id || !g.banner) { console.log('The server has no banner. Leaving the preview as is.'); return; }

  // Always the still PNG, even for animated banners: previews don't animate.
  const url = 'https://cdn.discordapp.com/banners/' + g.id + '/' + g.banner + '.png?size=1024';
  const img = await fetch(url);
  if (!img.ok) { console.log('Banner download failed: HTTP ' + img.status + '.'); return; }
  const buf = Buffer.from(await img.arrayBuffer());

  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT) : null;
  if (old && old.equals(buf)) { console.log('Banner unchanged.'); return; }
  fs.writeFileSync(OUT, buf);
  console.log('Saved the new banner (' + buf.length + ' bytes) to og/discord.png.');
}

main().catch((e) => { console.log('Banner sync error: ' + e.message); });
