#!/usr/bin/env python3
"""Builds the wiki: tools/wiki/pages/*.html -> wiki/<slug>/index.html (index.html -> wiki/index.html), plus
wiki/search.json. Each page starts with a JSON header in an HTML comment:
  <!--{"title": "The City", "section": "Systems", "icon": "property", "summary": "...", "prev": "farming", "next": "underground"}-->
The rest is the article body; its <h2 id="..."> headings become the page's contents list. Run after editing:
  python3 tools/wiki/build.py
The tables come from wiki/data.json, which the bot writes (cd rendconomy && npm run wiki)."""
import html, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'tools', 'wiki', 'pages')
OUT = os.path.join(ROOT, 'wiki')
SITE = 'https://renderproductions.github.io'

def load():
    pages = {}
    for f in sorted(os.listdir(SRC)):
        if not f.endswith('.html'):
            continue
        raw = open(os.path.join(SRC, f), encoding='utf-8').read()
        m = re.match(r'\s*<!--(\{.*?\})-->\s*', raw, re.S)
        if not m:
            raise SystemExit(f'{f}: missing the JSON header')
        meta = json.loads(m.group(1))
        meta['slug'] = f[:-5]
        meta['body'] = raw[m.end():]
        meta['url'] = '/wiki/' if meta['slug'] == 'index' else f"/wiki/{meta['slug']}/"
        pages[meta['slug']] = meta
    return pages

def text_of(body):
    t = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', body, flags=re.S)
    t = re.sub(r'<[^>]+>', ' ', t)
    return re.sub(r'\s+', ' ', html.unescape(t)).strip()

def topbar(current):
    return f'''<header class="topbar">
  <a class="brand" href="/wiki/"><i aria-hidden="true"></i>RENDER PRODUCTIONS <span>· WIKI</span></a>
  <nav aria-label="Site">
    <a href="/">Home</a><a href="/rend-conomy/">Rend-Conomy</a><a href="/play/">Play</a><a href="/patch-notes/">Patch Notes</a>
    <a href="/wiki/"{' aria-current="page"' if current == 'index' else ''}>Wiki</a>
    <div class="topsearch"><label class="sr" for="ts">Search the wiki</label><input id="ts" type="search" data-search placeholder="Search the wiki  ( / )" autocomplete="off"></div>
  </nav>
</header>'''

FOOT = '''<footer class="foot"><span>Render Productions · the Rend-Conomy Wiki</span><span>The tables on these pages are built from the bot's own code on every release.</span></footer>'''

def head(p):
    title = 'The Rend-Conomy Wiki | Render Productions' if p['slug'] == 'index' else f"{p['title']} | Rend-Conomy Wiki"
    desc = html.escape(p.get('summary', ''), quote=True)
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(title)}</title>
<meta name="description" content="{desc}">
<meta property="og:title" content="{html.escape(p['title'], quote=True)}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{SITE}{p['url']}">
<meta name="theme-color" content="#16181d">
<link rel="icon" href="/bot/emojis/rc_{p.get('icon', 'achievement')}.png">
<link rel="stylesheet" href="/wiki/wiki.css">
</head>
<body>
<div class="wrap">
{topbar(p['slug'])}'''

def article(p, pages):
    heads = re.findall(r'<h2 id="([^"]+)"[^>]*>(.*?)</h2>', p['body'], re.S)
    toc = ''.join(f'<a href="#{i}">{re.sub(r"<[^>]+>", "", re.sub(r"<span[^>]*>.*?</span>", "", t)).strip()}</a>' for i, t in heads)
    also = ''.join(f'<a href="{pages[s]["url"]}">{html.escape(pages[s]["title"])}</a>' for s in p.get('also', []) if s in pages)
    prev = pages.get(p.get('prev', ''))
    nxt = pages.get(p.get('next', ''))
    pager = f'''<div class="pager">{f'<a href="{prev["url"]}">← {html.escape(prev["title"])}</a>' if prev else '<span></span>'}<span>Something wrong or missing? Tell us in the Discord.</span>{f'<a href="{nxt["url"]}">{html.escape(nxt["title"])} →</a>' if nxt else '<span></span>'}</div>'''
    meta = ' · '.join(x for x in [p.get('meta', ''), f"<code>{p['command']}</code>" if p.get('command') else ''] if x)
    return f'''{head(p)}
<div class="crumbs"><a href="/wiki/">Wiki</a> / {html.escape(p.get('section', ''))} / {html.escape(p['title'])}</div>
<header class="ahead"><img src="/bot/emojis/rc_{p.get('icon', 'achievement')}.png" alt=""><div><h1>{html.escape(p['title'])}</h1>{f'<div class="meta">{meta}</div>' if meta else ''}</div></header>
<div class="layout">
<nav class="toc" aria-label="On this page"><div class="lbl">On this page</div>{toc}{'<hr><div class="lbl">See also</div>' + also if also else ''}</nav>
<article>
{p['body']}
{pager}
</article>
</div>
{FOOT}
</div>
<script src="/wiki/wiki.js"></script>
</body>
</html>
'''

def home(p):
    return f'''{head(p)}
{p['body']}
{FOOT}
</div>
<script src="/wiki/wiki.js"></script>
</body>
</html>
'''

def main():
    pages = load()
    index = []
    for p in pages.values():
        out = os.path.join(OUT, 'index.html') if p['slug'] == 'index' else os.path.join(OUT, p['slug'], 'index.html')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, 'w', encoding='utf-8').write(home(p) if p['slug'] == 'index' else article(p, pages))
        if p['slug'] != 'index':
            index.append({'title': p['title'], 'section': p.get('section', ''), 'url': p['url'], 'summary': p.get('summary', ''),
                          'heads': [re.sub(r'<[^>]+>', '', re.sub(r'<span[^>]*>.*?</span>', '', h)).strip() for h in re.findall(r'<h[23][^>]*>(.*?)</h[23]>', p['body'], re.S)],
                          'text': text_of(p['body'])[:6000]})
            # every section gets its own search entry too
            for i, t in re.findall(r'<h2 id="([^"]+)"[^>]*>(.*?)</h2>', p['body'], re.S):
                label = re.sub(r'<[^>]+>', '', re.sub(r'<span[^>]*>.*?</span>', '', t)).strip()
                index.append({'title': f"{label}", 'section': p['title'], 'url': f"{p['url']}#{i}", 'summary': '', 'heads': [], 'text': ''})
    json.dump(index, open(os.path.join(OUT, 'search.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'built {len(pages)} pages, {len(index)} search entries')

if __name__ == '__main__':
    main()
