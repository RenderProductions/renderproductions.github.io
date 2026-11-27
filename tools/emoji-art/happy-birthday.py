# Happy Birthday To Me!: the cake, the Party shelf, the Party Fish and the Birthdays category.
# Run: python3 tools/emoji-art/happy-birthday.py (writes to tools/emoji-art/out/, plus a preview sheet).
# Pink border for the party.
import os, math
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, '_frame.py')).read())
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
PINK = (255, 126, 182, 255)
K = (5, 7, 13)
def dark(c, f=0.65): return tuple(int(v * f) for v in c)
def light(c, f=0.45): return tuple(int(v + (255 - v) * f) for v in c)

class C:
    def __init__(s, border=PINK):
        global BORDER
        BORDER = border
        s.im = frame()
    def p(s, x, y, c):
        if 0 <= x < 32 and 0 <= y < 32 and c: s.im.putpixel((int(x), int(y)), tuple(c) + (255,) if len(c) == 3 else c)
    def r(s, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1): s.p(x, y, c)

SPONGE = (240, 200, 140); ICING = (255, 236, 245); PINKI = (255, 150, 196); BERRY = (220, 50, 80)
WAX = [(120, 200, 255), (255, 214, 90), (140, 220, 140), (255, 150, 196), (200, 160, 255)]
FLAME = (255, 200, 61); FLAME2 = (255, 120, 40)

def flame(c, x, y):
    c.p(x, y - 2, FLAME2); c.p(x, y - 1, FLAME); c.p(x, y, FLAME); c.p(x - 1, y, FLAME2); c.p(x + 1, y, FLAME2)

def cake_body(c, x0, x1, top, bottom, layers=2):
    c.r(x0, top, x1, bottom, SPONGE)
    c.r(x0, top, x1, top + 2, ICING)                         # icing on top
    for x in range(x0, x1 + 1, 2): c.p(x, top + 3, ICING)    # drips
    mid = (top + bottom) // 2 + 1
    c.r(x0, mid, x1, mid, PINKI)                             # jam layer
    c.r(x0, bottom, x1, bottom, dark(SPONGE))
    c.r(x0 - 1, bottom + 1, x1 + 1, bottom + 1, (200, 205, 215))   # the plate
    c.r(x0, top, x0, bottom, light(SPONGE, 0.3))             # light edge

I = {}
# the whole cake with three candles: the Birthdays category, the party
b = C(); cake_body(b, 7, 24, 15, 24)
for i, x in enumerate((10, 15, 20)):
    b.r(x, 10, x + 1, 14, WAX[i]); b.p(x, 10, light(WAX[i])); flame(b, x, 8) if i != 1 else flame(b, x + 1, 8)
for x in (9, 13, 18, 22): b.p(x, 16, BERRY)
I['birthday'] = b

# a cake slice (the Party shelf item, and the Slots reel during a party)
s = C()
for y in range(12, 25):
    w = int((y - 12) * 0.9)
    s.r(9, y, 9 + 6 + w, y, SPONGE)
s.r(9, 12, 15, 13, ICING); s.p(16, 13, ICING); s.r(10, 14, 10, 15, ICING); s.r(13, 14, 13, 16, ICING)
for y in range(12, 25):
    w = int((y - 12) * 0.9); s.p(9 + 6 + w, y, light(SPONGE, 0.25))
s.r(9, 18, 23, 18, PINKI)
s.r(9, 12, 9, 24, dark(SPONGE, 0.8))
s.r(8, 25, 25, 25, (200, 205, 215))
s.p(13, 10, BERRY); s.p(14, 10, BERRY); s.p(13, 11, BERRY); s.p(14, 11, dark(BERRY)); s.p(14, 9, (80, 170, 80))
I['cake'] = s

# the party hat
h = C()
STR = [(255, 214, 90), (120, 200, 255), (255, 150, 196)]
for y in range(8, 25):
    w = int((y - 8) * 0.55)
    for x in range(16 - w, 16 + w + 1): h.p(x, y, STR[((x + y) // 3) % 3])
h.r(9, 25, 23, 25, (255, 236, 245)); h.r(10, 26, 22, 26, (230, 200, 220))
h.r(15, 5, 17, 7, (255, 200, 61)); h.p(16, 4, (255, 240, 170))       # a little Polygon on top
for (x, y) in ((7, 10), (24, 12), (6, 18), (26, 20)): h.p(x, y, STR[(x + y) % 3])
I['col_partyhat'] = h

# the numbered candles
DIG = {'1': ['.#.', '##.', '.#.', '.#.', '###'], '2': ['##.', '..#', '.#.', '#..', '###'], '3': ['##.', '..#', '.#.', '..#', '##.'],
       '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '##.', '..#', '##.']}
for n in '12345':
    c = C(); col = WAX[int(n) - 1]
    c.r(13, 12, 18, 26, col); c.r(13, 12, 13, 26, light(col, 0.35)); c.r(18, 12, 18, 26, dark(col))
    c.r(15, 9, 16, 11, (60, 60, 60)); flame(c, 15, 8); c.p(16, 7, FLAME)
    for j, row in enumerate(DIG[n]):
        for i, ch in enumerate(row):
            if ch == '#': c.p(14 + i, 16 + j, (255, 255, 255))
    for x in range(11, 21): c.p(x, 27, (200, 205, 215))
    I[f'col_candle{n}'] = c

# Chuck's Party Fish: a striped fish in a party hat
f = C((59, 167, 242, 255))
cx, cy, rx, ry = 14, 17, 8.5, 5.2
for i in range(6):
    for y in range(int(cy - 1 - i * 0.9), int(cy + 2 + i * 0.9)): f.p(cx + rx - 1 + i, y, (200, 120, 230))
for y in range(32):
    for x in range(32):
        if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1:
            f.p(x, y, [(255, 150, 196), (255, 214, 90), (120, 200, 255)][(x // 3) % 3] if y < cy + 2 else (255, 236, 245))
f.p(8, 16, (240, 240, 240)); f.p(8, 15, K)
for y in range(6, 12):     # the hat, tilted on its head
    w = (y - 6) // 2
    for x in range(10 - w, 11 + w): f.p(x, y, (255, 214, 90) if (x + y) % 2 else (120, 200, 255))
f.p(10, 5, (255, 126, 182))
I['fish_partyfish'] = f

for k, cv in I.items(): cv.im.resize((128, 128), Image.NEAREST).save(os.path.join(OUT, f'rc_{k}.png'))
names = list(I); cols = 5; cell = 118
rows = (len(names) + cols - 1) // cols
sheet = Image.new('RGBA', (cols * cell + 30, rows * 125 + 40), (49, 51, 56, 255)); d = ImageDraw.Draw(sheet)
for i, k in enumerate(names):
    t = I[k].im.resize((96, 96), Image.NEAREST); x = 15 + (i % cols) * cell; y = 15 + (i // cols) * 125
    sheet.paste(t, (x, y), t); d.text((x, y + 99), k, fill=(180, 180, 180))
sheet.save(os.path.join(OUT, 'preview-happy-birthday.png'))
print('wrote', len(names), 'emojis')
