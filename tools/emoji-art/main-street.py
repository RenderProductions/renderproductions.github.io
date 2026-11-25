# Main Street: the street sign, the delivery truck, the Black Friday tag, the daily deal, the loyalty card,
# the wishlist star, a player's store stall and the back-room door.
# Run: python3 tools/emoji-art/main-street.py (writes to tools/emoji-art/out/, plus a preview sheet).
# Green border: the shop's section color.
import os, math
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, '_frame.py')).read())
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
GREEN = (46, 204, 113, 255)
P.update({'q': (255, 230, 0), 'Q': (160, 140, 0), 'v': (36, 52, 92), 'V': (60, 84, 140), 'm': (90, 96, 110), 'f': (232, 182, 132), 'F': (176, 126, 92),
          'j': (110, 190, 255), 'J': (60, 120, 200), 'z': (30, 32, 38), 'Z': (60, 62, 70), 'a': (46, 204, 113), 'A': (24, 130, 70), 'i': (255, 250, 220)})

class C:
    def __init__(s, border=GREEN):
        global BORDER
        BORDER = border
        s.im = frame()
    def p(s, x, y, c):
        if 0 <= x < 32 and 0 <= y < 32 and c: s.im.putpixel((int(x), int(y)), P[c] + (255,))
    def r(s, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): s.p(x, y, c)
    def circle(s, cx, cy, rad, c, c2=None):
        for y in range(32):
            for x in range(32):
                d = math.hypot(x - cx, y - cy)
                if d <= rad: s.p(x, y, c2 if c2 and (x - cx) + (y - cy) > rad * 0.6 else c)

I = {}
# ---- Main Street: two green street signs on a post, crossed, with white borders and an arrow
c = C()
c.r(15, 10, 16, 28, 'S'); c.r(15, 10, 15, 28, 't'); c.r(12, 27, 19, 28, 'S')
c.r(3, 5, 28, 11, 'h'); c.r(4, 6, 27, 10, 'a'); c.r(4, 6, 27, 6, 'n'); c.r(4, 10, 27, 10, 'A')
c.r(7, 8, 22, 8, 'h'); c.r(20, 7, 21, 9, 'h'); c.p(22, 8, 'h'); c.p(19, 6, 'a'); c.r(23, 8, 23, 8, 'h'); c.r(21, 7, 22, 7, 'h'); c.r(21, 9, 22, 9, 'h')   # an arrow
c.r(9, 13, 22, 18, 'h'); c.r(10, 14, 21, 17, 'a'); c.r(10, 14, 21, 14, 'n'); c.r(10, 17, 21, 17, 'A')
c.r(12, 15, 13, 16, 'h'); c.r(15, 15, 16, 16, 'h'); c.r(18, 15, 19, 16, 'h')   # little dots for letters
I['main_street'] = c

# ---- The delivery truck: a box truck with Marquez's green stripe
c = C()
c.r(3, 9, 20, 22, 'h'); c.r(3, 9, 20, 10, 't'); c.r(19, 9, 20, 22, 'C'); c.r(3, 15, 20, 16, 'a')
c.r(21, 13, 28, 22, 'V'); c.r(22, 14, 26, 17, 'j'); c.r(27, 18, 28, 21, 'J'); c.r(21, 13, 28, 13, 'j'); c.p(28, 20, 'y')
c.r(2, 22, 29, 23, 'e')
for cx in (8, 24):
    c.circle(cx, 24, 2.8, 'z', 'E'); c.r(cx - 1, 23, cx, 24, 's')
c.r(5, 18, 9, 19, 'S')   # a crate on the side, painted
I['truck'] = c

# ---- Price tags: a body with a pointed left end, a hole and a string
def tag(body, edge, shade, mark, outline=None):
    c = C()
    if outline:
        for y in range(8, 25):
            k = abs(y - 16)
            for x in range(3 + k * 6 // 7, 29): c.p(x, y, outline)
    for y in range(9, 24):
        k = abs(y - 16)
        for x in range(4 + k * 6 // 7, 28): c.p(x, y, body)
    c.r(9, 9, 27, 9, edge); c.r(26, 9, 27, 23, shade); c.r(9, 23, 27, 23, shade)
    c.circle(10, 16, 1.6, 'K')
    c.r(4, 15, 8, 15, 'C'); c.r(2, 12, 3, 14, 'C'); c.r(1, 9, 2, 11, 'C')   # the string
    mark(c)
    return c
def pct(c):   # a gold %
    c.r(14, 12, 16, 14, 'g'); c.r(21, 18, 23, 20, 'g')
    for k in range(10): c.p(23 - k, 11 + k, 'q'); c.p(24 - k, 11 + k, 'q')
def hexa(c):  # a Polygon (hexagon) stamped on the tag
    for y in range(11, 22):
        for x in range(13, 25):
            dx, dy = abs(x - 18.5), abs(y - 16)
            if dy <= 5 and dx <= 5.5 - max(0, dy - 2.5) * 0.9: c.p(x, y, 'Q' if (dx > 3.8 - max(0, dy - 2.5) * 0.9 or dy > 3.5) else 'g')
I['black_friday'] = tag('z', 'Z', 'E', pct, outline='m')
I['deal'] = tag('g', 'Y', 'G', hexa)

# ---- The loyalty card: a punch card with holes
c = C()
c.r(3, 8, 28, 24, 'c'); c.r(3, 8, 28, 9, 'h'); c.r(27, 8, 28, 24, 'C'); c.r(3, 24, 28, 24, 'C')
c.r(5, 11, 26, 12, 'a'); c.r(5, 11, 14, 11, 'A')
for i, x in enumerate((6, 11, 16, 21)):
    c.circle(x + 1.5, 18.5, 2.0, 'E' if i < 3 else 'C', None)
    if i < 3: c.p(x + 1, 18, 'z')
c.r(23, 15, 25, 16, 'r'); c.r(22, 16, 26, 17, 'r'); c.r(23, 18, 25, 18, 'r'); c.p(24, 19, 'r')   # a heart
I['loyalty_card'] = c

# ---- The wishlist: a gold star with a sparkle
c = C()
cx, cy = 15.5, 16.5
pts = []
for k in range(10):
    ang = -math.pi / 2 + k * math.pi / 5
    rad = 11 if k % 2 == 0 else 4.6
    pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
def inside(px, py):
    n, ins = len(pts), False
    for i in range(n):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % n]
        if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1) + x1: ins = not ins
    return ins
for y in range(32):
    for x in range(32):
        if inside(x + 0.5, y + 0.5): c.p(x, y, 'G' if (x - cx) + (y - cy) > 3 else 'g')
c.r(13, 12, 14, 13, 'Y')
c.p(26, 5, 'h'); c.p(25, 6, 'h'); c.p(27, 6, 'h'); c.p(26, 7, 'h'); c.p(26, 6, 'Y')
I['wishlist'] = c

# ---- A player's store: a stall with a striped awning and goods
c = C()
for i in range(6): c.r(3 + i * 4, 6, 6 + i * 4, 11, 'a' if i % 2 == 0 else 'h')
for i in range(6): c.r(3 + i * 4, 12, 6 + i * 4, 12, 'A' if i % 2 == 0 else 'C')
c.r(4, 13, 5, 27, 'w'); c.r(26, 13, 27, 27, 'w')
c.r(4, 20, 27, 22, 'l'); c.r(4, 22, 27, 22, 'W')
c.circle(10, 18, 2, 'r', 'R'); c.r(14, 16, 17, 19, 'j'); c.r(14, 16, 17, 16, 'h'); c.circle(22, 18, 2, 'q', 'Q')
c.r(12, 24, 19, 27, 'c'); c.r(13, 25, 18, 25, 'S'); c.r(13, 26, 16, 26, 'S')   # a price card
I['stall'] = c

# ---- The back room: a door left ajar, light spilling out, a KEEP OUT-ish sign
c = C()
c.r(7, 4, 24, 28, 'W'); c.r(8, 5, 23, 28, 'z')
c.r(16, 5, 23, 28, 'y'); c.r(18, 5, 23, 28, 'Y')   # the light inside
c.r(9, 5, 16, 28, 'w'); c.r(9, 5, 9, 28, 'l'); c.r(15, 5, 16, 28, 'd')   # the door, open a crack
c.p(14, 17, 'g'); c.p(14, 18, 'G')
c.r(10, 9, 14, 12, 'c'); c.r(11, 10, 13, 10, 'x'); c.r(11, 11, 12, 11, 'x')
c.r(19, 20, 22, 27, 'l'); c.r(19, 20, 22, 20, 'W'); c.r(20, 16, 22, 19, 'h'); c.r(20, 16, 22, 16, 't')   # boxes back there
I['back_room'] = c

for k, cv in I.items(): cv.im.resize((128, 128), Image.NEAREST).save(os.path.join(OUT, f'rc_{k}.png'))
n = len(I)
sheet = Image.new('RGBA', (n * 118 + 30, 180), (49, 51, 56, 255)); d = ImageDraw.Draw(sheet)
for i, k in enumerate(I):
    t = I[k].im.resize((96, 96), Image.NEAREST); x = 15 + i * 118
    sheet.paste(t, (x, 15), t); d.text((x, 115), k, fill=(180, 180, 180))
    s = I[k].im.resize((128, 128), Image.NEAREST).resize((22, 22), Image.LANCZOS); sheet.paste(s, (x, 140), s)
sheet.save(os.path.join(OUT, 'preview-main-street.png'))
print('wrote', n, 'emojis')
