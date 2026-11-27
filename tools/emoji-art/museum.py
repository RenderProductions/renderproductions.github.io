# The museum: rc_museum (a columned hall). Run: python3 tools/emoji-art/museum.py (writes to tools/emoji-art/out/).
import os
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, '_frame.py')).read())
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
BORDER = (255, 200, 61, 255)
im = frame()
def p(x, y, c): im.putpixel((x, y), c + (255,))
STONE = (226, 220, 206); SHADE = (176, 168, 150); DARKS = (120, 112, 98); GOLD = (255, 200, 61)
for y in range(7, 13):                       # the pediment
    w = (y - 7) * 2 + 1
    for x in range(16 - w, 16 + w): p(x, y, STONE if y < 12 else SHADE)
p(15, 9, GOLD); p(16, 9, GOLD); p(15, 10, GOLD); p(16, 10, GOLD)   # a gold Polygon in the gable
for x in range(5, 27): p(x, 13, SHADE); p(x, 14, STONE)
for cx in (7, 12, 17, 22):                   # four columns
    for y in range(15, 24):
        p(cx, y, STONE); p(cx + 1, y, STONE); p(cx + 2, y, SHADE)
for x in range(5, 27): p(x, 24, STONE); p(x, 25, SHADE)
for x in range(4, 28): p(x, 26, DARKS)
im.resize((128, 128), Image.NEAREST).save(os.path.join(OUT, 'rc_museum.png'))
print('wrote rc_museum')
