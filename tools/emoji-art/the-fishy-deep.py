# The Fishy Deep: the new fish, Old Barnaby's gear, and the docks.
# Run: python3 tools/emoji-art/the-fishy-deep.py (writes to tools/emoji-art/out/, plus a preview sheet).
# Blue border like the original fish; gold for legendaries (like the Koi).
import os, math
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, '_frame.py')).read())
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
BLUE = (59, 167, 242, 255); GOLD = (255, 200, 61, 255)

class C:
    def __init__(s, border=BLUE):
        global BORDER
        BORDER = border
        s.im = frame()
    def p(s, x, y, c):
        if 0 <= x < 32 and 0 <= y < 32 and c: s.im.putpixel((int(x), int(y)), tuple(c) + (255,) if len(c) == 3 else c)
    def r(s, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): s.p(x, y, c)
    def ell(s, cx, cy, rx, ry, c, belly=None, shade=None):
        for y in range(32):
            for x in range(32):
                d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
                if d <= 1:
                    col = c
                    if shade and y < cy - ry * 0.45: col = shade
                    if belly and y > cy + ry * 0.25: col = belly
                    s.p(x, y, col)

def dark(c, f=0.6): return tuple(int(v * f) for v in c)
def light(c, f=0.45): return tuple(int(v + (255 - v) * f) for v in c)
K = (5, 7, 13)

def fish(body, belly=None, size=1.0, tail=None, fin=True, stripes=None, spots=None, eye=(240, 240, 240), border=BLUE, long=1.0):
    c = C(border)
    rx, ry = 8.5 * size * long, 5.2 * size
    cx, cy = 14 - (long - 1) * 2, 16
    tail = tail or dark(body, 0.7)
    tx = cx + rx - 1
    for i in range(int(6 * size)):   # tail fan
        for y in range(int(cy - 1 - i * 0.9), int(cy + 2 + i * 0.9)): c.p(tx + i, y, tail)
    if fin:
        for i in range(int(4 * size)): c.r(int(cx - 1 + i), int(cy - ry - 2 + i * 0.7), int(cx - 1 + i), int(cy - ry + 1), dark(body, 0.75))
    c.ell(cx, cy, rx, ry, body, belly or light(body, 0.5), light(body, 0.25))
    if stripes:
        for sx in range(int(cx - rx * 0.4), int(cx + rx * 0.7), 3):
            for y in range(int(cy - ry + 1), int(cy + ry * 0.3)): c.p(sx, y, stripes)
    if spots:
        for (dx, dy) in ((-3, -1), (1, -2), (4, 0), (-1, 1), (3, 2)): c.p(cx + dx, cy + dy, spots)
    ex, ey = int(cx - rx * 0.6), int(cy - ry * 0.25)
    c.r(ex, ey, ex + 1, ey + 1, eye); c.p(ex, ey + 1, K)
    c.p(int(cx - rx + 1), int(cy + 1), dark(body, 0.5))   # mouth
    return c

I = {}
# the River
I['fish_shiner'] = fish((220, 190, 80), (250, 235, 170), 0.75)
I['fish_smallmouth'] = fish((140, 120, 70), (220, 205, 160), 1.0, stripes=(95, 80, 45))
I['fish_walleye'] = fish((170, 150, 80), (235, 225, 190), 1.0, eye=(250, 250, 200), long=1.15)
gar = fish((120, 130, 70), (200, 205, 150), 1.05, border=GOLD, long=1.35, spots=(70, 80, 40))
gar.r(1, 15, 6, 16, (120, 130, 70)); gar.r(1, 17, 5, 17, (90, 100, 50))   # long snout
I['fish_gar'] = gar
# the Pier
I['fish_sardine'] = fish((120, 150, 190), (220, 230, 245), 0.7, long=1.2)
I['fish_mackerel'] = fish((50, 120, 120), (220, 230, 230), 0.9, stripes=(20, 60, 70), long=1.2)
I['fish_snapper'] = fish((220, 80, 70), (250, 180, 160), 1.05)
I['fish_tuna'] = fish((40, 60, 120), (200, 210, 230), 1.15, tail=(230, 200, 60))
sw = fish((70, 90, 140), (200, 210, 230), 1.0, long=1.15)
for x in range(0, 8): sw.p(x + 1, 15, (180, 185, 200))
I['fish_swordfish'] = sw
hh = fish((120, 135, 150), (215, 220, 225), 1.1, border=GOLD, long=1.25, fin=True)
hh.r(2, 11, 4, 21, (120, 135, 150)); hh.p(2, 11, K); hh.p(2, 21, K)   # the hammer
I['fish_hammerhead'] = hh
# the Deep
an = fish((60, 50, 70), (90, 75, 100), 1.0, eye=(250, 220, 120))
for i in range(6): an.p(9 - i // 2, 9 - i, (120, 110, 130))
an.r(5, 2, 7, 4, (255, 240, 140)); an.p(6, 3, (255, 255, 255))
for x in (6, 8, 10): an.p(x, 18, (240, 240, 240))
I['fish_anglerfish'] = an
oar = C()
for x in range(3, 30):
    y = 16 + math.sin(x / 3.2) * 3
    for dy in range(-2, 3): oar.p(x, y + dy, (200, 210, 225) if dy < 1 else (160, 170, 190))
    if x % 2: oar.p(x, y - 3, (220, 60, 60))
oar.r(4, 14, 5, 15, (240, 240, 240)); oar.p(4, 15, K)
I['fish_oarfish'] = oar
sq = C(GOLD)
sq.ell(16, 10, 6, 7, (200, 70, 80), None, (230, 110, 120))
for i, x0 in enumerate((10, 12, 14, 16, 18, 20, 22)):
    for y in range(16, 28):
        sq.p(x0 + int(math.sin((y + i) / 2) * 1.2), y, (180, 60, 70) if y < 26 else (220, 100, 110))
sq.r(13, 11, 14, 12, (255, 255, 255)); sq.p(13, 12, K); sq.r(18, 11, 19, 12, (255, 255, 255)); sq.p(19, 12, K)
I['fish_squid'] = sq
# the Sewer
I['fish_sludge'] = fish((110, 140, 60), (160, 190, 90), 0.7, spots=(70, 90, 30))
carp = fish((170, 140, 60), (220, 200, 130), 1.05, spots=(120, 100, 40))
carp.r(9, 12, 10, 13, (240, 240, 240)); carp.p(10, 13, K); carp.r(12, 11, 13, 12, (240, 240, 240)); carp.p(12, 12, K)   # the third eye
I['fish_carp'] = carp
eel = C()
for x in range(3, 29):
    y = 16 + math.sin(x / 2.6) * 4
    for dy in range(-2, 2): eel.p(x, y + dy, (90, 255, 140) if dy == -2 else (40, 200, 110))
eel.r(3, 14, 4, 15, (255, 255, 255)); eel.p(3, 15, K)
for x in range(6, 28, 4): eel.p(x, 16 + math.sin(x / 2.6) * 4 - 3, (200, 255, 210))
I['fish_eel'] = eel
gat = C(GOLD)
gat.r(3, 15, 27, 21, (70, 120, 60)); gat.r(3, 19, 27, 21, (110, 150, 80)); gat.r(3, 13, 12, 15, (70, 120, 60))
for x in range(4, 26, 3): gat.p(x, 14, (40, 80, 35))
for x in range(4, 12, 2): gat.p(x, 16, (240, 240, 230))
gat.r(10, 12, 11, 13, (240, 220, 80)); gat.p(11, 13, K)
for x in (8, 18): gat.r(x, 22, x + 2, 24, (60, 100, 50))
gat.r(27, 17, 29, 19, (70, 120, 60))
I['fish_gator'] = gat
# Ice fishing
I['fish_cisco'] = fish((150, 170, 190), (230, 235, 245), 0.75)
I['fish_whitefish'] = fish((210, 220, 230), (245, 248, 252), 0.9, eye=(180, 220, 255))
I['fish_char'] = fish((150, 90, 70), (240, 120, 80), 1.0, spots=(250, 220, 200))
pk = fish((180, 230, 255), (240, 250, 255), 1.05, border=GOLD, spots=(255, 255, 255))
for (x, y) in ((6, 5), (25, 7), (24, 25)): pk.p(x, y, (255, 255, 255))
I['fish_polarkoi'] = pk

# ---- gear
def rod(color, tip):
    c = C()
    for i in range(22): c.p(5 + i, 27 - i, color); c.p(6 + i, 27 - i, dark(color, 0.75))
    c.r(7, 21, 10, 23, (90, 96, 110)); c.p(8, 22, (200, 200, 210))   # reel
    for y in range(6, 20): c.p(27, y, (230, 230, 230))
    c.r(25, 19, 27, 20, (200, 200, 210)); c.p(25, 18, (200, 200, 210))   # hook
    c.p(27, 5, tip); c.p(26, 5, tip)
    return c
I['rod_fiberglass'] = rod((240, 210, 90), (255, 255, 255))
I['rod_carbon'] = rod((50, 55, 65), (59, 167, 242))
I['rod_polygon'] = rod((255, 200, 61), (255, 255, 255))
for k in ('rod_polygon',):
    for (x, y) in ((8, 8), (20, 25), (14, 6)): I[k].p(x, y, (255, 255, 200))
co = C()
co.r(5, 12, 26, 26, (59, 140, 220)); co.r(5, 12, 26, 13, (120, 190, 250)); co.r(5, 24, 26, 26, (40, 100, 170))
co.r(5, 9, 26, 11, (240, 240, 245)); co.r(12, 6, 19, 8, (200, 205, 215)); co.r(12, 6, 13, 9, (200, 205, 215)); co.r(18, 6, 19, 9, (200, 205, 215))
co.r(13, 16, 18, 18, (240, 240, 245))
I['cooler'] = co
bt = C()
for y in range(17, 25):
    w = 12 - (y - 17)
    bt.r(16 - w - 1, y, 16 + w + 2, y, (240, 240, 245) if y < 20 else (200, 60, 60))
bt.r(12, 11, 20, 16, (240, 240, 245)); bt.r(13, 12, 19, 14, (110, 190, 255))
for x in range(4, 29): bt.p(x, 26 + (x % 4 == 0), (59, 167, 242)); bt.p(x, 27, (40, 110, 180))
I['boat'] = bt
wm = C()
for x in range(6, 26):
    y = 16 + math.sin(x / 2.2) * 4
    for dy in range(-1, 2): wm.p(x, y + dy, (230, 140, 150) if dy < 1 else (190, 100, 110))
wm.r(24, 12, 26, 14, (230, 140, 150)); wm.p(25, 12, K)
I['worm'] = wm

for k, cv in I.items(): cv.im.resize((128, 128), Image.NEAREST).save(os.path.join(OUT, f'rc_{k}.png'))
names = list(I); cols = 9; cell = 118
rows = (len(names) + cols - 1) // cols
sheet = Image.new('RGBA', (cols * cell + 30, rows * 125 + 40), (49, 51, 56, 255)); d = ImageDraw.Draw(sheet)
for i, k in enumerate(names):
    t = I[k].im.resize((96, 96), Image.NEAREST); x = 15 + (i % cols) * cell; y = 15 + (i // cols) * 125
    sheet.paste(t, (x, y), t); d.text((x, y + 99), k.replace('fish_', ''), fill=(180, 180, 180))
sheet.save(os.path.join(OUT, 'preview-fishy-deep.png'))
print('wrote', len(names), 'emojis')
