# Shared: the emoji frame (copied from rc_farm.png with the border recolored) and the palette.
from PIL import Image, ImageDraw
import os
import os
HERE=os.path.dirname(os.path.abspath(__file__))
SRC=os.path.join(HERE,'..','..','bot','emojis','rc_farm.png')
OUT=os.path.join(HERE,'out-first-pass'); os.makedirs(OUT,exist_ok=True)
BORDER=(26,188,156,255)
farm=Image.open(SRC).convert('RGBA').resize((32,32),Image.NEAREST)
OUTL=(5,7,13,255); GREEN=(124,179,66,255); BG=(13,19,34,255); HI=(21,29,51,255)
def frame():
    im=Image.new('RGBA',(32,32),(0,0,0,0))
    for y in range(32):
        for x in range(32):
            p=farm.getpixel((x,y))
            if p[3]==0: continue
            if p==OUTL: im.putpixel((x,y),OUTL)
            elif p==GREEN: im.putpixel((x,y),BORDER)
            elif p==HI or (4<=y<=5 and p!=BG): im.putpixel((x,y),HI)
            else: im.putpixel((x,y),BG)
    return im
P={'K':(5,7,13),'w':(138,90,46),'W':(90,58,34),'l':(181,121,66),'r':(196,68,58),'R':(140,44,40),
   'c':(240,226,196),'C':(196,180,146),'b':(120,200,240),'B':(178,84,60),'M':(122,58,42),'y':(255,214,90),'Y':(255,240,170),
   's':(150,160,172),'S':(96,106,120),'t':(206,214,222),'g':(255,200,61),'G':(212,160,23),'n':(124,179,66),'N':(80,130,40),
   'h':(240,236,224),'x':(214,60,60),'o':(230,126,34),'T':(26,188,156),'U':(18,120,100),'p':(155,89,182),'d':(120,80,50),'e':(60,64,72),'E':(36,40,48),'k':(255,158,203)}
def art(rows, dy=0, dx=0):
    im=frame()
    rows=[r.rstrip('\n') for r in rows]
    w=max(len(r) for r in rows); h=len(rows)
    x0=(32-w)//2+dx; y0=(32-h)//2+1+dy
    for j,r in enumerate(rows):
        for i,ch in enumerate(r):
            if ch in '. ': continue
            im.putpixel((x0+i,y0+j),P[ch]+(255,))
    return im
