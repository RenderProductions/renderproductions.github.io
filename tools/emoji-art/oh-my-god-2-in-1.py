# Oh My God, 2 in 1!: the new city buildings, landmarks and Rend-Sino emojis.
# Run: python3 tools/emoji-art/oh-my-god-2-in-1.py (writes to tools/emoji-art/out/, plus a preview sheet).
# Teal border for the city (the property section color), magenta for the Rend-Sino.
import os, math
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, '_frame.py')).read())
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
TEAL = (26, 188, 156, 255); MAGENTA = (235, 69, 158, 255)
P.update({'f': (232, 182, 132), 'F': (176, 126, 92), 'Z': (70, 80, 96), 'z': (110, 120, 136), 'm': (90, 96, 110),
          'q': (255, 230, 0), 'Q': (160, 140, 0), 'j': (110, 190, 255), 'J': (60, 120, 200), 'i': (190, 120, 255), 'I': (120, 70, 190),
          'O': (255, 140, 40), 'a': (176, 132, 84), 'A': (128, 92, 56), 'v': (36, 52, 92), 'V': (60, 84, 140), 'u': (200, 70, 60), 'L': (60, 150, 60),
          'D': (40, 110, 40), 'H': (250, 250, 250), 'X': (150, 30, 30), 'P': (110, 60, 140)})

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
    def stamp(s, x0, y0, rows):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch not in '. ': s.p(x0 + i, y0 + j, ch)
    def circle(s, cx, cy, rad, c, c2=None):
        for y in range(32):
            for x in range(32):
                d = math.hypot(x - cx, y - cy)
                if d <= rad: s.p(x, y, c2 if c2 and (x - cx) + (y - cy) > rad * 0.6 else c)

I = {}
def grass(c, y0=25, y1=26, x0=3, x1=28):
    c.r(x0, y0, x1, y1, 'n')
    for x in range(x0, x1 + 1):
        if x % 3 == 0: c.p(x, y0, 'N')
        if x % 4 == 1: c.p(x, y1, 'N')

# ---- Station: a platform with a canopy and a little engine
c = C(); grass(c, 26, 26)
c.r(4, 23, 27, 25, 's'); c.r(4, 23, 27, 23, 't'); c.r(4, 25, 27, 25, 'S')
for x in range(4, 28, 3): c.p(x, 24, 'S')
c.r(5, 9, 26, 10, 'u'); c.r(5, 9, 26, 9, 'x'); c.r(6, 11, 25, 11, 'X')
c.r(7, 12, 7, 22, 'S'); c.r(24, 12, 24, 22, 'S')
c.r(13, 4, 18, 8, 'c'); c.r(14, 5, 17, 7, 'h'); c.p(15, 6, 'K'); c.p(16, 5, 'K'); c.r(13, 8, 18, 8, 'C')
# the engine
c.r(9, 16, 20, 21, 'J'); c.r(9, 16, 20, 16, 'j'); c.r(17, 13, 20, 16, 'J'); c.r(18, 14, 19, 15, 'b')
c.r(10, 13, 11, 15, 'e'); c.r(10, 12, 11, 12, 'E')
for x in (11, 15, 19): c.r(x - 1, 21, x + 1, 22, 'E'); c.p(x, 21, 'm')
c.r(21, 18, 22, 21, 'e'); c.p(8, 19, 'y')
I['prop_station'] = c

# ---- Factory: saw-tooth roof, a smokestack and smoke
c = C(); grass(c)
c.r(5, 15, 26, 25, 'B'); c.r(25, 15, 26, 25, 'M')
for i, x0 in enumerate((5, 12, 19)):
    for k in range(5): c.r(x0 + k, 15 - k, x0 + k, 15, 'S'); c.p(x0 + k, 15 - k, 't')
    c.r(x0 + 5, 10, x0 + 6, 15, 'b'); c.p(x0 + 5, 10, 'h')
for y in range(17, 25):
    for x in range(5, 25):
        if (y % 3 == 0 and x % 4 == 0) or (y % 3 == 1 and x % 4 == 2): c.p(x, y, 'M')
for wx in (7, 12, 17): c.r(wx, 18, wx + 2, 20, 'y'); c.p(wx, 18, 'Y')
c.r(21, 20, 24, 25, 'W'); c.r(22, 21, 23, 25, 'd')
c.r(22, 4, 24, 14, 'S'); c.r(22, 4, 22, 14, 's'); c.r(22, 6, 24, 6, 'x'); c.r(22, 9, 24, 9, 'x')
for (x, y, col) in ((23, 3, 'z'), (24, 2, 'z'), (21, 2, 'm'), (25, 3, 'm'), (20, 3, 'z'), (26, 2, 'z')): c.p(x, y, col)
I['prop_factory'] = c

# ---- Barn: red barn with the white cross doors
c = C(); grass(c)
for i, y in enumerate(range(6, 12)):
    c.r(16 - 3 - i * 2, y, 15 + 3 + i * 2, y, 'x')
c.r(14, 4, 17, 5, 'x'); c.r(4, 12, 27, 12, 'h')
c.r(5, 13, 26, 25, 'x'); c.r(24, 13, 26, 25, 'R')
for x in range(5, 24, 3): c.r(x, 13, x, 25, 'R')
c.r(10, 16, 21, 25, 'h'); c.r(11, 17, 20, 25, 'R')
for k in range(9): c.p(11 + k, 17 + k, 'h'); c.p(20 - k, 17 + k, 'h')
c.r(14, 8, 17, 10, 'h'); c.r(15, 8, 16, 10, 'W')
c.r(3, 22, 4, 25, 'g'); c.r(27, 21, 28, 25, 'g'); c.p(3, 21, 'G'); c.p(28, 20, 'G')
I['prop_barn'] = c

# ---- Bank Branch: columns and a gold polygon
c = C()
for i, y in enumerate(range(4, 10)):
    c.r(16 - 2 - i * 2, y, 15 + 2 + i * 2, y, 'c')
    c.p(15 + 2 + i * 2, y, 'C')
c.r(13, 6, 18, 8, 'g'); c.r(14, 6, 17, 6, 'Y'); c.p(13, 8, 'G'); c.p(18, 8, 'G')
c.r(4, 10, 27, 11, 'C'); c.r(4, 10, 27, 10, 'h')
for x in (6, 11, 16, 21):
    c.r(x, 12, x + 2, 23, 'c'); c.r(x + 2, 12, x + 2, 23, 'C'); c.r(x, 12, x + 2, 12, 'h')
c.r(26, 12, 26, 23, 'C'); c.r(5, 12, 5, 23, 'C')
c.r(4, 24, 27, 24, 'C'); c.r(3, 25, 28, 26, 's'); c.r(3, 25, 28, 25, 't')
I['prop_bank'] = c

# ---- Warehouse: a long shed with a roll-up door and crates
c = C(); grass(c)
c.r(4, 11, 27, 11, 'S'); c.r(4, 10, 27, 10, 't')
for i, y in enumerate(range(7, 10)): c.r(6 + i * 2, y, 25 - i * 2, y, 's')
c.r(4, 12, 27, 25, 'z'); c.r(26, 12, 27, 25, 'Z')
for x in range(4, 26, 2): c.r(x, 12, x, 25, 'm')
c.r(8, 15, 19, 25, 'S'); c.r(9, 16, 18, 25, 's')
for y in range(17, 26, 2): c.r(9, y, 18, y, 'S')
c.r(21, 20, 25, 25, 'a'); c.r(21, 20, 25, 20, 'l'); c.r(25, 20, 25, 25, 'A'); c.p(23, 22, 'A'); c.p(22, 23, 'A'); c.p(24, 23, 'A')
c.r(22, 16, 25, 19, 'a'); c.r(22, 16, 25, 16, 'l'); c.r(25, 16, 25, 19, 'A')
I['prop_warehouse'] = c

# ---- Park: two trees, a path and a bench
c = C()
c.r(3, 6, 28, 26, 'n')
for x in range(3, 29):
    for y in range(6, 27):
        if (x * 7 + y * 3) % 11 == 0: c.p(x, y, 'N')
for k in range(21): c.r(13 + k // 6, 6 + k, 17 + k // 6, 6 + k, 'a') if 6 + k <= 26 else None
for k in range(21): c.p(13 + k // 6, 6 + k, 'A') if 6 + k <= 26 else None
for (cx, cy) in ((8, 11), (23, 17)):
    c.r(cx, cy + 3, cx + 1, cy + 7, 'W')
    c.circle(cx + 0.5, cy, 4.6, 'L', 'D')
    c.p(cx - 1, cy - 2, 'n'); c.p(cx + 1, cy - 3, 'n')
c.r(5, 21, 10, 21, 'w'); c.r(5, 19, 10, 19, 'l'); c.p(5, 22, 'W'); c.p(10, 22, 'W')
for (x, y) in ((20, 8), (26, 10), (6, 25)): c.p(x, y, 'k'); c.p(x + 1, y, 'y')
I['prop_park'] = c

# ---- Police Station: a blue building with a light bar
c = C(); grass(c)
c.r(5, 11, 26, 25, 'V'); c.r(24, 11, 26, 25, 'v')
c.r(4, 9, 27, 10, 'v'); c.r(4, 9, 27, 9, 'J')
c.r(11, 4, 20, 7, 'h'); c.r(11, 7, 20, 8, 's'); c.r(11, 4, 15, 6, 'x'); c.r(16, 4, 20, 6, 'j'); c.p(12, 4, 'k'); c.p(17, 4, 'b')
c.r(9, 12, 22, 14, 'h'); c.stamp(10, 12, ["J.J.JJJ.J..JJJ.", "JJ..J.J.J...J..", "J...JJJ.JJJ.JJJ"])
for wx in (7, 19): c.r(wx, 16, wx + 4, 19, 'b'); c.p(wx, 16, 'h'); c.r(wx + 2, 16, wx + 2, 19, 'J')
c.r(14, 18, 17, 25, 'J'); c.r(15, 19, 16, 25, 'v'); c.p(16, 22, 'g')
c.r(3, 25, 28, 26, 's')
I['prop_police'] = c

# ---- Construction: scaffolding, a crane hook and a cone
c = C(); grass(c)
c.r(6, 10, 7, 25, 'g'); c.r(19, 10, 20, 25, 'g')
for y in (10, 15, 20): c.r(6, y, 20, y, 'G')
for k in range(5): c.p(8 + k * 2, 11 + k, 'G'); c.p(8 + k * 2, 16 + k, 'G')
c.r(9, 21, 17, 25, 'B'); c.r(9, 21, 17, 21, 'x')
for x in range(9, 18, 2): c.p(x, 23, 'M')
c.r(23, 4, 24, 25, 'O'); c.r(10, 4, 27, 5, 'O'); c.r(10, 4, 27, 4, 'g')
for x in range(11, 27, 2): c.p(x, 5, 'G')
c.r(13, 6, 13, 9, 'S'); c.r(12, 9, 14, 9, 'S'); c.p(12, 10, 'S')
c.stamp(23, 21, ["..o..", ".oho.", ".ooo.", "ohhho", "ooooo"])
I['construction'] = c

# ---- Open land (empty tile): grass with a survey stake
c = C()
c.r(3, 3, 28, 28, 'n')
for x in range(3, 29):
    for y in range(3, 29):
        if (x * 5 + y * 7) % 9 == 0: c.p(x, y, 'N')
        elif (x * 3 + y * 11) % 13 == 0: c.p(x, y, 'L')
c.r(15, 12, 16, 22, 'a'); c.r(16, 12, 16, 22, 'A'); c.r(16, 12, 21, 15, 'o'); c.r(16, 15, 21, 15, 'O')
I['tile_empty'] = c

# ---- Landmarks
c = C()   # The TODD Statue: TODD's monitor head on a plinth, in bronze
c.r(8, 21, 23, 26, 's'); c.r(8, 21, 23, 21, 't'); c.r(22, 21, 23, 26, 'S'); c.r(6, 26, 25, 27, 'S')
c.r(10, 5, 21, 15, 'G'); c.r(11, 6, 20, 14, 'g'); c.r(12, 7, 19, 13, 'G')
c.r(13, 9, 14, 10, 'Y'); c.r(17, 9, 18, 10, 'Y'); c.r(14, 12, 17, 12, 'Y')
c.r(14, 16, 17, 18, 'G'); c.r(11, 19, 20, 20, 'G'); c.r(11, 19, 20, 19, 'g')
c.r(10, 6, 10, 14, 'Y')
I['landmark_statue'] = c
c = C()   # The Stadium: an oval bowl with floodlights
for y in range(10, 25):
    for x in range(3, 29):
        d = ((x - 15.5) / 12.5) ** 2 + ((y - 17.5) / 7.2) ** 2
        if d <= 1: c.p(x, y, 'S' if d > 0.62 else ('n' if d < 0.33 else 'h'))
        if 0.62 < d <= 1 and (x + y) % 3 == 0: c.p(x, y, 'x')
        if 0.62 < d <= 1 and y > 19: c.p(x, y, 's') if (x + y) % 3 else None
c.r(13, 16, 18, 19, 'N'); c.r(15, 15, 16, 20, 'h')
for x in (5, 26): c.r(x, 4, x, 12, 'S'); c.r(x - 1, 3, x + 1, 5, 'y'); c.p(x, 3, 'Y')
I['landmark_stadium'] = c
c = C()   # The Rocket on its pad
c.r(14, 4, 17, 21, 'h'); c.r(16, 4, 17, 21, 't')
c.r(15, 2, 16, 3, 'x'); c.r(14, 4, 17, 5, 'x')
c.r(15, 9, 16, 11, 'b'); c.p(15, 9, 'H')
c.r(14, 14, 17, 14, 'x')
for k in range(4): c.r(13 - k, 17 + k, 13, 17 + k, 'x'); c.r(18, 17 + k, 18 + k, 17 + k, 'R')
c.r(14, 22, 17, 23, 'o'); c.r(15, 24, 16, 25, 'y'); c.p(15, 26, 'Y')
c.r(5, 26, 26, 27, 'S'); c.r(5, 26, 26, 26, 's'); c.r(8, 13, 9, 25, 'S'); c.r(9, 13, 12, 13, 'S')
I['landmark_rocket'] = c

# ---- Goods (a crate of factory goods), freight (a boxcar), brick (landmark donations)
c = C()
c.r(7, 9, 24, 25, 'a'); c.r(7, 9, 24, 10, 'l'); c.r(23, 9, 24, 25, 'A'); c.r(7, 24, 24, 25, 'A')
for y in (14, 19): c.r(7, y, 24, y, 'A')
for k in range(15): c.p(8 + k, 11 + k // 1.3 if False else 10 + k, None)
c.r(8, 11, 9, 23, 'A'); c.r(21, 11, 22, 23, 'A')
c.stamp(11, 15, [".JJJJJJJJ.", "JjjjjjjjJ", "JjHHHHjjJ", "JjjjjjjjJ", ".JJJJJJJJ."])
I['goods'] = c
c = C()
c.r(4, 9, 27, 21, 'x'); c.r(4, 9, 27, 10, 'u'); c.r(26, 9, 27, 21, 'R')
for x in range(4, 26, 3): c.r(x, 11, x, 21, 'R')
c.r(11, 12, 20, 21, 'R'); c.r(12, 13, 19, 20, 'X'); c.r(15, 13, 16, 20, 'R')
c.r(3, 22, 28, 22, 'S')
for x in (8, 23): c.circle(x, 24.5, 2.4, 'E'); c.p(x, 24, 's')
c.r(3, 27, 28, 27, 'S'); c.r(3, 27, 28, 27, 'a')
I['freight'] = c
c = C()
for (x0, y0) in ((5, 18), (16, 18), (10, 11), (21, 11) , (2, 11)):
    c.r(max(3, x0), y0, min(28, x0 + 10), y0 + 6, 'u'); c.r(max(3, x0), y0, min(28, x0 + 10), y0, 'x'); c.r(min(28, x0 + 10), y0, min(28, x0 + 10), y0 + 6, 'X'); c.r(max(3, x0), y0 + 6, min(28, x0 + 10), y0 + 6, 'X')
c.r(3, 25, 28, 26, 's')
I['brick'] = c

# ---- The Rend-Sino: the VIP pass, the jackpot, the table
c = C(MAGENTA)
c.r(5, 8, 26, 24, 'g'); c.r(5, 8, 26, 9, 'Y'); c.r(25, 8, 26, 24, 'G'); c.r(5, 23, 26, 24, 'G')
c.r(13, 4, 18, 8, 'S'); c.r(14, 5, 17, 7, 'E')
c.stamp(8, 13, ["P...P.PPP.PPPP.", "P...P..P..P...P", ".P.P...P..PPPP.", ".P.P...P..P....", "..P...PPP.P...."])
c.r(8, 20, 23, 20, 'G')
I['vip'] = c
c = C(MAGENTA)
for y in range(4, 28):
    for x in range(4, 28):
        dx, dy = abs(x - 15.5), y - 4
        if dy <= 6 and dx <= 4 + dy * 1.4 and dx <= 11.5: c.p(x, y, 'j' if dy < 3 else 'b')
        elif 6 < dy <= 22 and dx <= 11.5 - (dy - 6) * 0.72: c.p(x, y, 'J' if x > 15 else 'b')
for y in range(4, 11): c.p(15, y, 'H')
for k in range(12): c.p(10 + k // 2, 11 + k, 'h')
c.p(9, 7, 'H'); c.p(21, 7, 'j'); c.p(26, 3, 'Y'); c.p(5, 3, 'Y'); c.p(27, 12, 'y'); c.p(4, 14, 'y')
I['jackpot'] = c
c = C(MAGENTA)
for y in range(9, 26):
    for x in range(3, 29):
        d = ((x - 15.5) / 12.6) ** 2 + ((y - 15) / 8.5) ** 2
        if d <= 1: c.p(x, y, 'a' if d > 0.8 else ('D' if d > 0.74 else 'L'))
c.r(5, 22, 26, 25, None)
c.r(4, 21, 27, 22, 'A')
for (x, y, rot) in ((9, 12, 0), (14, 11, 1), (19, 12, 0)):
    c.r(x, y, x + 3, y + 4, 'h'); c.p(x + 1, y + 1, 'x'); c.p(x + 2, y + 3, 'x')
c.circle(16, 18, 1.6, 'x'); c.circle(11, 18, 1.4, 'b'); c.circle(21, 18, 1.4, 'g')
I['table'] = c

for k, cv in I.items(): cv.im.resize((128, 128), Image.NEAREST).save(os.path.join(OUT, f'rc_{k}.png'))
names = list(I)
cols = 9; cell = 118
sheet = Image.new('RGBA', (cols * cell + 30, 330), (49, 51, 56, 255)); d = ImageDraw.Draw(sheet)
d.text((15, 10), 'Oh My God, 2 in 1! - new emojis', fill=(240, 240, 240))
for i, k in enumerate(names):
    t = I[k].im.resize((96, 96), Image.NEAREST); x = 15 + (i % cols) * cell; y = 35 + (i // cols) * 125
    sheet.paste(t, (x, y), t); d.text((x, y + 99), k, fill=(180, 180, 180))
d.text((15, 290), 'Chat size:', fill=(240, 240, 240))
for i, k in enumerate(names):
    t = I[k].im.resize((128, 128), Image.NEAREST).resize((22, 22), Image.LANCZOS); sheet.paste(t, (90 + i * 26, 286), t)
sheet.save(os.path.join(OUT, 'preview-2in1.png'))
print('wrote', len(names), 'emojis')
