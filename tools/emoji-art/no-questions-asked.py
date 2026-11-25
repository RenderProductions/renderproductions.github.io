# No Questions Asked: the black market's emojis. Run: python3 tools/emoji-art/no-questions-asked.py
# (writes to tools/emoji-art/out/). Violet border: the Underground's section color.
import os, math
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, '_frame.py')).read())
BORDER = (142, 68, 173, 255)
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
P.update({'f': (232, 182, 132), 'F': (176, 126, 92), 'a': (176, 132, 84), 'A': (128, 92, 56), 'v': (58, 34, 78), 'V': (142, 68, 173), 'Z': (70, 80, 96),
          'q': (255, 230, 0), 'Q': (160, 140, 0), 'j': (110, 190, 255), 'J': (60, 120, 200), 'i': (190, 120, 255), 'O': (255, 140, 40), 'm': (90, 96, 110), 'P': (110, 60, 140)})
class C:
    def __init__(s): s.im = frame()
    def p(s, x, y, c):
        if 0 <= x < 32 and 0 <= y < 32 and c: s.im.putpixel((x, y), P[c] + (255,))
    def r(s, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): s.p(x, y, c)
    def stamp(s, x0, y0, rows):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch not in '. ': s.p(x0 + i, y0 + j, ch)
    def disc(s, cx, cy, rad, c):
        for y in range(32):
            for x in range(32):
                if (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad: s.p(x, y, c)
I = {}
FLAME = ["..O.", ".OO.", "OxOO", "OxxO", ".OO."]   # the 'hot' mark on stolen goods
CUBE = [".QQQQQQ.", "QVVVVVVQ", "QqqVVqqQ", "QqqQQqqQ", ".QQQQQQ."]
P['V2'] = (255, 242, 122)
# ---- Mr. Glaz: a red robe with the hood pulled over his face; in the shadow, one white eye (his left)
P.update({'e1': (255, 255, 255), 'e2': (190, 200, 225), 'r1': (205, 40, 48), 'r2': (140, 22, 30), 'r3': (238, 84, 84), 'hd': (14, 10, 18)})
c = C()
for y in range(19, 28):                                                            # the robe, wider toward the hem
    w = 9 + (y - 19) // 2 + 2
    c.r(16 - w, y, 15 + w, y, 'r1'); c.p(16 - w, y, 'r2'); c.p(15 + w, y, 'r2')
for x in (8, 12, 19, 23): c.r(x, 23, x, 27, 'r2')                                  # folds
for y in range(3, 21):                                                             # the hood: a pointed cowl
    half = min(9, 2 + (y - 3) * 0.75) if y < 12 else 9 - max(0, y - 18)
    c.r(int(16 - half), y, int(15 + half), y, 'r1')
    c.p(int(16 - half), y, 'r2'); c.p(int(15 + half), y, 'r3')
for y in range(8, 20):                                                             # the opening, all shadow
    half = 5 if 10 <= y <= 17 else 3 if y in (8, 9, 18) else 2
    c.r(16 - half, y, 15 + half, y, 'hd')
c.r(10, 7, 21, 7, 'r3'); c.r(9, 19, 22, 20, 'r2')                                  # the hood's edge, the drape at the neck
c.r(17, 12, 19, 13, 'e1'); c.p(18, 13, 'K'); c.p(16, 12, 'e2'); c.p(20, 13, 'e2')  # one white eye, wide open (his left)
c.p(18, 11, 'e2')
c.r(14, 17, 17, 17, 'e1'); c.p(13, 16, 'e1'); c.p(18, 16, 'e1')                  # a small smile
# one pixel down, and the frame's border drawn back over the robe so he sits inside it
base = frame(); drawn = c.im.copy(); c.im = frame()
for y in range(31, -1, -1):
    for x in range(32):
        px = drawn.getpixel((x, y))
        if px != base.getpixel((x, y)) and y + 1 < 32: c.im.putpixel((x, y + 1), px)
for y in range(32):
    for x in range(32):
        bp = base.getpixel((x, y))
        if bp[3] and bp[:3] not in (BG[:3], HI[:3]): c.im.putpixel((x, y), bp)
I['connector'] = c
# ---- the Underground: a steel door with an eye slot
c = C()
c.r(7, 4, 24, 27, 'Z'); c.r(8, 5, 23, 27, 'S'); c.r(8, 5, 23, 5, 't')
for (x, y) in ((9, 7), (22, 7), (9, 25), (22, 25), (9, 16), (22, 16)): c.p(x, y, 't')
c.r(10, 9, 21, 13, 'K'); c.r(10, 9, 21, 9, 'E')
c.r(12, 11, 13, 11, 'i'); c.r(18, 11, 19, 11, 'i'); c.p(12, 11, 'h'); c.p(18, 11, 'h')
c.r(20, 18, 22, 20, 'g'); c.p(20, 18, 'Y')                 # the handle
c.r(5, 27, 26, 27, 'E')
I['underground'] = c
# ---- Heat: a wanted star (lit) and an empty one
def star(cx, cy, R, r_, fill, edge):
    c = C(); pts = []
    for k in range(10):
        ang = -math.pi / 2 + k * math.pi / 5
        rad = R if k % 2 == 0 else r_
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    def inside(x, y):
        n = False
        for i in range(10):
            (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % 10]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: n = not n
        return n
    for y in range(32):
        for x in range(32):
            if inside(x + .5, y + .5):
                edge_px = not all(inside(x + .5 + dx, y + .5 + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                c.p(x, y, edge if edge_px else fill)
    return c
c = star(15.5, 17, 12.5, 5.2, 'O', 'x'); c.r(14, 10, 15, 13, 'y'); c.p(15, 9, 'Y'); I['heat'] = c
I['heat_off'] = star(15.5, 17, 12.5, 5.2, 'E', 'm')
# ---- a raid: TODD's siren (a dome, red on the left, blue on the right, flashing)
c = C()
for y in range(32):
    for x in range(32):
        if y <= 20 and (x - 15.5) ** 2 + ((y - 20.5) * 0.8) ** 2 <= 9.2 ** 2: c.p(x, y, 'x' if x < 16 else 'J')
c.r(9, 12, 10, 16, 'k'); c.r(11, 11, 12, 12, 'k'); c.r(20, 12, 21, 16, 'j'); c.r(19, 11, 20, 11, 'j')
c.r(5, 21, 26, 24, 'E'); c.r(5, 21, 26, 21, 'm'); c.r(7, 25, 24, 26, 'K')
for (x, y, col) in ((3, 9, 'x'), (4, 10, 'x'), (2, 14, 'x'), (3, 14, 'x'), (6, 6, 'x'), (28, 9, 'j'), (27, 10, 'j'), (29, 14, 'j'), (28, 14, 'j'), (25, 6, 'j'), (15, 5, 'Y'), (16, 5, 'Y'), (15, 4, 'Y')): c.p(x, y, col)
I['raid'] = c
# ---- the password: a folded note with asterisks and a violet seal
c = C()
c.r(6, 8, 25, 24, 'h'); c.r(6, 24, 25, 24, 'C'); c.r(25, 8, 25, 24, 'C'); c.r(6, 16, 25, 16, 'C')
c.stamp(9, 10, ["x.x..x.x..x.x", ".x....x....x.", "x.x..x.x..x.x"])
c.r(9, 19, 17, 19, 's'); c.r(9, 21, 14, 21, 's')
c.disc(21, 21, 3.2, 'V'); c.r(20, 20, 22, 22, 'i'); c.p(21, 21, 'V')
I['password'] = c
# ---- hot loot (each with the little flame)
def hot(c): c.stamp(23, 21, FLAME); return c
c = C()
for y in range(32):
    for x in range(32):
        d = (x - 15.5) ** 2 + (y - 19) ** 2
        if 30 <= d <= 58: c.p(x, y, 'g' if y < 19 else 'G')
c.stamp(12, 6, ["..jjjj..", ".jhjjjj.", "jjjjjJJj", ".JjjjJJ.", "..JJJJ..", "...JJ..."])
I['hot_ring'] = hot(c)
c = C()
c.r(5, 8, 25, 26, 'w'); c.r(5, 8, 25, 9, 'l'); c.r(5, 26, 25, 26, 'W')
for y in (13, 18, 22): c.r(5, y, 25, y, 'W')
for x in (5, 25): c.r(x, 8, x, 26, 'A')
for i in range(19): c.p(6 + i, 25 - i * 16 // 18, 'A'); c.p(6 + i, 24 - i * 16 // 18, 'l')
for (x, y) in ((5, 8), (24, 8), (5, 25), (24, 25)): c.r(x, y, x + 1, y + 1, 's')
c.r(8, 14, 15, 16, 'x'); c.r(9, 15, 14, 15, 'h')
I['hot_crate'] = hot(c)
c = C()
c.r(5, 6, 26, 25, 'g'); c.r(5, 6, 26, 6, 'Y'); c.r(5, 25, 26, 25, 'G'); c.r(8, 9, 23, 22, 'j')
c.r(8, 17, 23, 22, 'n'); c.r(8, 20, 23, 22, 'N'); c.disc(19, 12, 2.2, 'y')
for x in range(9, 17): c.p(x, 17 - (x - 9) // 2, 'S'); c.r(x, 17 - (x - 9) // 2, x, 17, 'S')
I['hot_art'] = hot(c)
c = C()
c.stamp(6, 8, ["....hhhhhhhhhhh....", "...hjjjhjjjhjjjh...", "..hjjjhjjjjjhjjjh..", ".JJJJJJJJJJJJJJJJJ.", "..jjjjjjjjjjjjjJJ..", "...jjjjjjjjjjjJJ...",
                 "....jjjjjjjjjJJ....", ".....jjjjjjjJJ.....", "......jjjjjJJ......", ".......jjjJJ.......", "........jJJ........", ".........J........."])
I['hot_gem'] = hot(c)
# ---- contraband
c = C()
c.r(14, 6, 26, 18, 'C'); c.r(14, 6, 26, 6, 'h'); c.r(26, 6, 26, 18, 's')     # the die behind
for (x, y) in ((16, 8), (24, 8), (20, 12), (16, 16), (24, 16)): c.r(x, y, x + 1, y + 1, 'R')
c.r(5, 13, 18, 26, 'h'); c.r(5, 26, 18, 26, 'C'); c.r(18, 13, 18, 26, 'C'); c.r(5, 13, 18, 13, 'Y')   # the die in front
for (x, y) in ((7, 15), (15, 15), (11, 19), (7, 23), (15, 23)): c.r(x, y, x + 1, y + 1, 'x')
c.p(19, 27, 'm'); c.r(20, 25, 26, 27, 'm'); c.r(20, 25, 26, 25, 's')                  # a lead weight
I['loaded_dice'] = c
c = C()
c.r(4, 9, 27, 24, 'c'); c.r(4, 9, 27, 11, 'V'); c.r(4, 24, 27, 24, 'C')
c.r(6, 13, 12, 22, 'j'); c.disc(9, 16, 2, 'F'); c.r(7, 19, 11, 22, 'v')
c.r(14, 14, 25, 14, 's'); c.r(14, 17, 23, 17, 's'); c.r(14, 20, 21, 20, 's')
c.stamp(19, 16, ["..xxx..", ".x...x.", "....x..", "...x...", ".......", "...x..."])
I['fake_id'] = c
c = C()
c.r(5, 15, 17, 26, 'g'); c.r(5, 15, 17, 15, 'Y'); c.r(5, 26, 17, 26, 'G')
for y in range(6, 15):
    c.p(7, y, 'S'); c.p(15, y, 'S')
c.r(7, 6, 15, 7, 'S'); c.r(8, 8, 14, 8, None)
c.r(10, 19, 12, 21, 'K'); c.r(11, 22, 11, 24, 'K')
for i in range(13): c.p(13 + i, 22 - i, 't'); c.p(13 + i, 23 - i, 's')
c.r(24, 8, 26, 10, 't'); c.p(26, 8, 'h')
for i in range(10): c.p(15 + i, 26 - i, 'm')
I['lockpick'] = c
c = C()
c.r(10, 3, 26, 18, 'h'); c.r(10, 3, 26, 3, 't'); c.r(26, 3, 26, 18, 'C')          # the tip card
pts = [(12, 12), (14, 10), (16, 11), (18, 8), (20, 9), (22, 6)]
for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
    for k in range(max(abs(x1 - x0), abs(y1 - y0)) + 1):
        t = k / max(1, max(abs(x1 - x0), abs(y1 - y0)))
        x = round(x0 + (x1 - x0) * t); y = round(y0 + (y1 - y0) * t); c.p(x, y, 'n'); c.p(x, y + 1, 'N')
c.stamp(21, 4, ["nnn", ".nn", "n.n"])
c.r(4, 14, 22, 27, 'c'); c.r(4, 27, 22, 27, 'C'); c.r(22, 14, 22, 27, 'C')           # the envelope
for i in range(10): c.p(4 + i, 14 + i * 7 // 10, 'C'); c.p(22 - i, 14 + i * 7 // 10, 'C')
c.disc(13, 21.5, 1.8, 'V')
I['insider_tip'] = c
c = C()
c.r(5, 8, 24, 25, 'h'); c.r(24, 8, 25, 25, 'C'); c.r(5, 25, 25, 25, 'C')
c.r(7, 10, 22, 13, 'K'); c.stamp(8, 11, ["h.h.hh.h.hh.h.", "hhh.h..hhh..h."]) 
c.r(7, 15, 13, 21, 's'); c.r(15, 15, 22, 15, 'm'); c.r(15, 17, 22, 17, 'm'); c.r(15, 19, 22, 19, 'm'); c.r(15, 21, 20, 21, 'm')
c.r(7, 23, 22, 23, 'm')
c.r(25, 5, 27, 12, 'x'); c.r(25, 14, 27, 15, 'x')
I['rumor_mill'] = c
c = C()
c.disc(14, 19, 8, 'E'); c.disc(12, 17, 3, 'm'); c.p(11, 16, 's')
c.r(18, 10, 20, 12, 'S')
c.stamp(19, 4, ["....Y..", "..yOy..", ".OyYO..", "..OxO..", "...W...", "...W...", "..W...."])
for (cx, cy, rr) in ((24, 21, 3), (25, 16, 2.5), (8, 26, 2.2)): c.disc(cx, cy, rr, 's'); c.disc(cx - .7, cy - .7, rr - 1.2, 't')
I['smoke_bomb'] = c
c = C()
for (x0, col, colD) in ((4, 'p', 'P'), (16, 'o', 'A')):
    c.r(x0 + 1, 8, x0 + 10, 11, col); c.r(x0 + 1, 11, x0 + 10, 12, colD)
    c.r(x0 + 1, 13, x0 + 10, 19, 'f'); c.r(x0 + 9, 13, x0 + 10, 19, 'F')
    c.r(x0 + 3, 15, x0 + 4, 15, 'K'); c.r(x0 + 7, 15, x0 + 8, 15, 'K')
    c.r(x0 + 4, 18, x0 + 7, 18, 'W')
    c.r(x0, 20, x0 + 11, 27, 'a' if x0 == 16 else 'v')
c.r(13, 21, 15, 27, 'x'); c.r(13, 21, 18, 22, 'x'); c.p(18, 23, 'x')   # a crowbar
I['squatter_crew'] = c
c = C()
c.r(22, 5, 22, 17, 'S'); c.stamp(23, 6, ["xxx.", "xxxx", "xxx."])               # mast and flag
c.r(7, 11, 13, 17, 'w'); c.r(7, 11, 13, 11, 'l'); c.r(7, 14, 13, 14, 'W')         # crates
c.r(14, 13, 19, 17, 'a'); c.r(14, 13, 19, 13, 'C'); c.p(16, 15, 'A')
c.stamp(3, 18, ["WWWWWWWWWWWWWWWWWWWWWWWWWW", ".wwwwwwwwwwwwwwwwwwwwwwww.", "..wwwwwwwwwwwwwwwwwwwwww..", "...WWWWWWWWWWWWWWWWWWWW..."])   # hull
c.r(3, 21, 28, 27, 'J')                                                           # the lake, over the bottom of the hull
for x in range(3, 29):
    if x % 4 in (0, 1): c.p(x, 21, 'j')
for x in range(3, 29, 4): c.p(x + 1, 24, 'j'); c.p(x + 3, 26, 'j')
c.r(5, 21, 26, 21, 'j'); c.stamp(4, 20, ["j..........................", ])
c.disc(6.5, 6.5, 2.4, 'Y'); c.p(7, 5, 'E'); c.p(8, 6, 'E')
I['smuggle'] = c
c = C()
c.r(5, 4, 26, 27, 't'); c.r(5, 4, 26, 4, 'h'); c.r(26, 4, 26, 27, 's'); c.r(5, 27, 26, 27, 's')
c.r(5, 9, 26, 9, 's'); c.r(7, 6, 12, 7, 'm'); c.disc(22, 6.5, 1.3, 'n')
c.disc(15.5, 18, 7.5, 'S'); c.disc(15.5, 18, 6, 'J'); c.disc(15.5, 18, 5, 'j')
c.stamp(12, 15, CUBE); c.p(13, 13, 'h'); c.p(14, 13, 'h')
I['launder'] = c
# the snitch: a rat, side on, whispering
c = C()
for y in range(32):
    for x in range(32):
        if ((x - 13) / 8.5) ** 2 + ((y - 19) / 5.5) ** 2 <= 1: c.p(x, y, 's')        # body
        if ((x - 13) / 7.5) ** 2 + ((y - 21) / 3.2) ** 2 <= 1 and y > 19: c.p(x, y, 't')   # belly
for x in range(19, 27):                                                           # the snout tapers to a point
    h = max(0, 4 - (x - 19) // 2)
    c.r(x, 17 - h // 2, x, 17 + h // 2 + 1, 's')
c.r(26, 17, 27, 18, 'k')                                                          # nose
c.disc(18, 12.5, 2.8, 's'); c.disc(18, 12.5, 1.6, 'k')                            # ear
c.r(21, 16, 21, 16, 'K'); c.p(21, 15, 'h')                                        # eye
for (x, y) in ((25, 19), (26, 20), (24, 20)): c.p(x, y, 'h')                      # whiskers
c.p(24, 15, 'h'); c.p(25, 14, 'h')
c.r(9, 24, 10, 25, 'k'); c.r(16, 24, 17, 25, 'k')                                 # feet
tail = [(4, 20), (3, 21), (3, 22), (3, 23), (4, 24), (5, 25), (6, 25), (7, 26), (8, 26), (9, 27)]
for (x, y) in tail: c.p(x, y, 'k')
c.stamp(19, 4, [".hhhhhhh.", "hhKhKhKhh", ".hhhhhhh.", "..h......"])               # whispering "..."
I['snitch'] = c
I['snitch'] = c
names = list(I)
for k, cv in I.items(): cv.im.resize((128, 128), Image.NEAREST).save(os.path.join(OUT, f'rc_{k}.png'))
cols = 10; cell = 118
sheet = Image.new('RGBA', (cols * cell + 30, 330), (49, 51, 56, 255)); d = ImageDraw.Draw(sheet)
d.text((15, 10), 'No Questions Asked - black market emojis (first pass)', fill=(240, 240, 240))
for i, k in enumerate(names):
    t = I[k].im.resize((96, 96), Image.NEAREST); x = 15 + (i % cols) * cell; y = 35 + (i // cols) * 125
    sheet.paste(t, (x, y), t); d.text((x, y + 99), k, fill=(180, 180, 180))
d.text((15, 290), 'Chat size:', fill=(240, 240, 240))
for i, k in enumerate(names):
    t = I[k].im.resize((128, 128), Image.NEAREST).resize((22, 22), Image.LANCZOS); sheet.paste(t, (90 + i * 26, 286), t)
sheet.save(os.path.join(OUT, 'preview.png'))
print(len(names))
