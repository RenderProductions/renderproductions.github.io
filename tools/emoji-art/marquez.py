# Marquez's own emoji, from the backstage art (backstage/marquez/art/marquez.svg): green shaggy fur, a brown
# pinched fedora with a dark band, glasses with one fogged lens and one black eye, a small mustache, the grey fur
# collar and the brown double-breasted coat with gold buttons. Head and shoulders, no counter.
# Run: python3 tools/emoji-art/marquez.py (writes to tools/emoji-art/out/, plus a preview).
import os
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, '_frame.py')).read())
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
BORDER = (46, 204, 113, 255)   # the shop's green
C = {
    'hl': (156, 104, 62), 'hm': (120, 76, 40), 'hd': (78, 48, 24), 'hb': (110, 62, 22),     # hat light, mid, dark, band
    'g1': (88, 172, 96), 'g2': (62, 150, 72), 'g3': (40, 104, 52), 'g0': (24, 70, 34),       # fur, light to dark
    'ln': (154, 170, 186), 'fr': (74, 46, 22), 'ey': (8, 8, 10),                            # fogged lens, frames, his eye
    'f1': (190, 184, 168), 'f2': (150, 144, 130), 'f3': (110, 104, 94),                    # the fur collar
    'c1': (140, 92, 52), 'c2': (112, 72, 38), 'c3': (80, 50, 26), 'bt': (176, 158, 64)     # the coat, buttons
}
im = frame()
def p(x, y, c):
    if 0 <= x < 32 and 0 <= y < 32: im.putpixel((x, y), C[c] + (255,))
def r(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1): p(x, y, c)

# simple shapes, like Mr. Glaz: the coat, the fur collar, a green face, the glasses, the fedora
for y in range(22, 32):                                                   # the coat
    r(7 - (y - 22) // 2, y, 24 + (y - 22) // 2, y, 'c1')
r(15, 24, 16, 31, 'c3'); p(13, 27, 'bt'); p(18, 27, 'bt'); p(13, 30, 'bt'); p(18, 30, 'bt')
for y in range(17, 25):                                                   # the fur collar
    w = 10 + (y - 17) if y < 21 else 13 - (y - 21) * 2
    r(16 - w, y, 15 + w, y, 'f1')
for x in (4, 8, 12, 19, 23, 27): p(x, 24, 'f1')                            # a few tufts
r(9, 10, 22, 20, 'g2'); r(19, 10, 22, 20, 'g3')                           # the green face
r(10, 21, 21, 21, 'g2'); r(19, 21, 21, 21, 'g3')
r(9, 12, 14, 14, 'ln'); r(9, 11, 14, 11, 'fr')                            # a fogged lens
r(16, 11, 21, 11, 'fr'); r(16, 12, 21, 14, 'g3'); r(18, 12, 19, 13, 'ey') # the other lens, his eye
p(15, 12, 'fr')
r(12, 17, 19, 17, 'g0'); p(11, 16, 'g0'); p(20, 16, 'g0')                 # the mustache
r(10, 3, 21, 9, 'hl'); r(15, 3, 16, 3, 'hm'); r(19, 2, 21, 2, 'hl')        # the fedora's crown, pinched
r(10, 7, 21, 8, 'hb')                                                     # the band
r(6, 9, 25, 10, 'hd')                                                     # the brim
# the frame's border drawn back over him, so he sits inside it
base = frame()
for y in range(32):
    for x in range(32):
        bp = base.getpixel((x, y))
        if bp[3] and bp[:3] not in (BG[:3], HI[:3]): im.putpixel((x, y), bp)

im.resize((128, 128), Image.NEAREST).save(os.path.join(OUT, 'rc_marquez.png'))
sheet = Image.new('RGBA', (180, 150), (49, 51, 56, 255))
big = im.resize((128, 128), Image.NEAREST); sheet.paste(big, (10, 0), big)
sm = big.resize((22, 22), Image.LANCZOS); sheet.paste(sm, (150, 120), sm)
sheet.save(os.path.join(OUT, 'preview-marquez.png'))
print('wrote rc_marquez')
