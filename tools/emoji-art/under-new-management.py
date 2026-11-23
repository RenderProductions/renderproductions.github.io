# Under New Management: City Hall, the ballot box and an NPC worker.
# Run: python3 tools/emoji-art/under-new-management.py (writes to tools/emoji-art/out/, plus a preview sheet).
# Teal border for the city (the property section color), blue for companies (the market color).
import os, math
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, '_frame.py')).read())
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
TEAL = (26, 188, 156, 255); BLUE = (52, 152, 219, 255)
P.update({'q': (255, 230, 0), 'Q': (160, 140, 0), 'v': (36, 52, 92), 'V': (60, 84, 140), 'm': (90, 96, 110), 'f': (232, 182, 132), 'F': (176, 126, 92), 'j': (110, 190, 255), 'J': (60, 120, 200)})

class C:
    def __init__(s, border=TEAL):
        global BORDER
        BORDER = border
        s.im = frame()
    def p(s, x, y, c):
        if 0 <= x < 32 and 0 <= y < 32 and c: s.im.putpixel((x, y), P[c] + (255,))
    def r(s, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): s.p(x, y, c)
    def circle(s, cx, cy, rad, c, c2=None):
        for y in range(32):
            for x in range(32):
                d = math.hypot(x - cx, y - cy)
                if d <= rad: s.p(x, y, c2 if c2 and (x - cx) + (y - cy) > rad * 0.6 else c)

I = {}
# ---- City Hall: steps, columns, a pediment and a gold dome with a flag
c = C()
c.r(4, 24, 27, 26, 's'); c.r(4, 24, 27, 24, 't'); c.r(6, 22, 25, 23, 't'); c.r(6, 23, 25, 23, 's')
c.r(6, 13, 25, 21, 'c'); c.r(24, 13, 25, 21, 'C')
for x in (7, 11, 15, 19, 23):
    c.r(x, 14, x + 1, 21, 'h'); c.p(x + 1, 14, 'C'); c.p(x + 1, 21, 'C')
c.r(15, 17, 16, 21, 'W')   # the door
for k in range(5): c.r(5 + k * 2, 12 - k, 26 - k * 2, 12 - k, 'c' if k else 'C')
c.r(5, 12, 26, 12, 'C')
for y in range(3, 9):
    for x in range(10, 22):
        d = ((x - 15.5) / 5.6) ** 2 + ((y - 8.5) / 5.2) ** 2
        if d <= 1 and y <= 8: c.p(x, y, 'g' if (x - 15.5) < 1.5 else 'G')
c.r(15, 0, 15, 3, 'S'); c.r(16, 0, 18, 1, 'x')
I['city_hall'] = c

# ---- Ballot box: a box with a slot and a ballot going in
c = C()
c.r(6, 15, 25, 26, 'V'); c.r(6, 15, 25, 16, 'j'); c.r(22, 15, 25, 26, 'v')
c.r(11, 15, 20, 15, 'E')   # the slot
c.r(10, 19, 21, 22, 'h'); c.r(11, 20, 12, 21, 'T'); c.r(14, 20, 20, 20, 'S'); c.r(14, 21, 18, 21, 'S')   # a label
c.r(12, 4, 19, 14, 'h'); c.r(18, 4, 19, 14, 'C')   # the ballot
c.r(13, 6, 14, 7, 'K'); c.p(14, 8, 'K'); c.p(15, 7, 'K'); c.p(16, 6, 'K'); c.p(17, 5, 'K')   # a check mark
c.r(13, 10, 17, 10, 'S'); c.r(13, 12, 16, 12, 'S')
I['ballot'] = c

# ---- An NPC worker: hard hat, smile, overalls
c = C(BLUE)
c.circle(15.5, 13, 5.2, 'f', 'F')
c.r(9, 7, 22, 9, 'q'); c.r(11, 5, 20, 7, 'q'); c.r(8, 9, 23, 10, 'Q'); c.r(14, 4, 17, 6, 'g')
c.p(13, 13, 'K'); c.p(18, 13, 'K'); c.r(14, 16, 17, 16, 'W'); c.p(13, 15, 'W'); c.p(18, 15, 'W')
c.r(8, 20, 23, 27, 'J'); c.r(8, 20, 23, 20, 'j'); c.r(12, 19, 19, 21, 'f')
c.r(12, 21, 13, 27, 'V'); c.r(18, 21, 19, 27, 'V'); c.r(12, 23, 19, 27, 'V'); c.p(13, 23, 'q'); c.p(18, 23, 'q')
I['worker'] = c

for k, cv in I.items(): cv.im.resize((128, 128), Image.NEAREST).save(os.path.join(OUT, f'rc_{k}.png'))
sheet = Image.new('RGBA', (3 * 118 + 30, 180), (49, 51, 56, 255)); d = ImageDraw.Draw(sheet)
for i, k in enumerate(I):
    t = I[k].im.resize((96, 96), Image.NEAREST); x = 15 + i * 118
    sheet.paste(t, (x, 15), t); d.text((x, 115), k, fill=(180, 180, 180))
    s = I[k].im.resize((128, 128), Image.NEAREST).resize((22, 22), Image.LANCZOS); sheet.paste(s, (x, 140), s)
sheet.save(os.path.join(OUT, 'preview-unm.png'))
print('wrote', len(I), 'emojis')
