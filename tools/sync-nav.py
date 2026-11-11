#!/usr/bin/env python3
"""Keeps the top bar the same on every page. Edit LINKS here, then run:  python3 tools/sync-nav.py
Pages with the standard bar (<nav class="nav"> or the Discord page's <nav class="topnav">) get these links,
with aria-current on the section the page belongs to. Use --check to only report pages that are out of sync."""
import re, subprocess, sys

LINKS = [('/', 'Home'), ('/rend-conomy/', 'Rend-Conomy'), ('/bot/', 'Bot'), ('/profile/', 'Profile'),
         ('/games/', 'Games'), ('/face/', 'Face'), ('/patch-notes/', 'Patch Notes'), ('/discord/', 'Discord')]

def section(path):
    """Which link is "this page": the longest link the page's URL starts with ('/' only for the homepage)."""
    url = '/' + re.sub(r'index\.html$', '', path)
    best = None
    for href, _ in LINKS:
        if href == '/' and url != '/':
            continue
        if url.startswith(href) and (best is None or len(href) > len(best)):
            best = href
    return best

def render(path, indent):
    cur = section(path)
    sub = cur and ('/' + re.sub(r'index\.html$', '', path)) != cur  # a page inside a section, not the section's front page
    items = []
    for href, label in LINKS:
        attr = (' aria-current="true"' if sub else ' aria-current="page"') if href == cur else ''
        items.append(f'{indent}  <li><a href="{href}"{attr}>{label}</a></li>')
    return f'{indent}<ul>\n' + '\n'.join(items) + f'\n{indent}</ul>'

check = '--check' in sys.argv
bad = []
files = subprocess.run(['git', 'ls-files', '*.html'], capture_output=True, text=True).stdout.split()
for f in files:
    if f.startswith('engine/'):
        continue
    s = open(f, encoding='utf-8').read()
    m = re.search(r'(<nav class="(?:nav|topnav)" aria-label="Main">\s*<a class="brand"[^>]*>[^<]*</a>\s*)(\s*)(<ul>.*?</ul>)', s, re.S)
    if not m:
        continue
    indent = re.search(r'\n([ \t]*)<ul>', m.group(0)).group(1)
    new = render(f, indent)
    if m.group(3) == new.strip():
        continue
    bad.append(f)
    if not check:
        s = s[:m.start(3)] + new.lstrip() + s[m.end(3):]
        open(f, 'w', encoding='utf-8').write(s)
print(('Out of sync: ' if check else 'Updated: ') + (', '.join(bad) if bad else 'nothing'))
sys.exit(1 if check and bad else 0)
