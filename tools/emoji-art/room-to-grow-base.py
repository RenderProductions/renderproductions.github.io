import os
HERE=os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE,'_frame.py')).read())
P.update({'f':(232,182,132),'F':(196,140,96),'P':(110,60,140),'Z':(70,80,96),'a':(170,120,80)})
OUT2=os.path.join(HERE,'out'); os.makedirs(OUT2,exist_ok=True)
class C:
    def __init__(s): s.im=frame()
    def p(s,x,y,c):
        if 0<=x<32 and 0<=y<32 and c: s.im.putpixel((x,y),P[c]+(255,))
    def r(s,x0,y0,x1,y1,c):
        for y in range(y0,y1+1):
            for x in range(x0,x1+1): s.p(x,y,c)
    def stamp(s,x0,y0,rows):
        for j,row in enumerate(rows):
            for i,ch in enumerate(row):
                if ch not in '. ': s.p(x0+i,y0+j,ch)
I={}
def grass(c,y0=25,y1=26,x0=3,x1=28):
    c.r(x0,y0,x1,y1,'n')
    for x in range(x0,x1+1):
        if x%3==0: c.p(x,y0,'N')
        if x%4==1: c.p(x,y1,'N')
# ---- Shack
c=C(); grass(c)
c.r(6,15,25,24,'w')
for x in range(6,26):
    if x%3==0: c.r(x,15,x,24,'W')
    elif x%3==1: c.r(x,16,x,24,'l')
c.r(6,15,25,15,'W')
for i,y in enumerate(range(8,14)):
    hw=3+i*3; c.r(max(3,16-hw),y,min(28,15+hw),y,'s')
    for x in range(max(3,16-hw),min(28,15+hw)+1):
        if x%3==0 and y>=10: c.p(x,y,'S')
        if x<16-hw+3 and y<=11: c.p(x,y,'t')
c.r(3,14,28,14,'S')
c.r(8,17,12,21,'l'); c.r(9,18,11,20,'b'); c.p(9,18,'h'); c.p(10,18,'h')
c.r(18,17,22,24,'W'); c.r(19,18,21,24,'d'); c.p(21,21,'g')
I['prop_shack']=c
# ---- Apartment
c=C()
c.r(7,7,21,25,'B'); c.r(22,7,24,25,'M')
for y in range(8,26):
    for x in range(7,22):
        if (y%4==0 and x%4==0) or (y%4==2 and x%4==2): c.p(x,y,'M')
c.r(6,5,25,6,'S'); c.r(6,5,25,5,'t')
lit={(9,9),(17,14),(13,19),(9,19)}
for wy in (9,14):
    for wx in (9,13,17):
        col='y' if (wx,wy) in lit else 'b'
        c.r(wx,wy,wx+2,wy+2,col); c.p(wx,wy,'Y' if col=='y' else 'h'); c.r(wx,wy+3,wx+2,wy+3,'t')
for wx in (9,17):
    col='y' if (wx,19) in lit else 'b'
    c.r(wx,19,wx+2,21,col); c.p(wx,19,'Y' if col=='y' else 'h'); c.r(wx,22,wx+2,22,'t')
c.r(13,20,15,25,'W'); c.r(14,21,14,25,'d'); c.p(15,23,'g'); c.r(12,19,16,19,'U')
for wy in (9,14,19):
    c.r(23,wy,23,wy+2,'b')
c.r(4,26,27,26,'s'); c.p(8,26,'t'); c.p(19,26,'t')
I['prop_apartment']=c
# ---- Corner shop
c=C()
c.r(5,12,26,25,'c'); c.r(25,12,26,25,'C')
c.r(4,5,27,5,'W'); c.r(5,6,26,10,'U'); c.r(5,6,26,6,'T')
c.stamp(8,7,["g.g.ggg.g.g.ggg.g", "ggg..g..ggg..g..g", "g.g.ggg.g.g.ggg.g"])
for x in range(4,28):
    col='T' if (x//2)%2==0 else 'h'
    c.p(x,11,col); c.p(x,12,col)
    if x%2==0: c.p(x,13,col)
c.r(7,15,16,23,'l'); c.r(8,16,15,22,'b'); c.p(9,17,'h'); c.p(10,16,'h'); c.p(9,16,'h')
c.p(9,22,'x'); c.p(10,22,'x'); c.p(12,22,'o'); c.p(13,21,'g'); c.p(13,22,'g'); c.p(14,22,'n')
c.r(19,15,24,25,'l'); c.r(20,16,23,25,'w'); c.r(20,16,23,19,'b'); c.p(20,16,'h'); c.p(23,21,'g')
c.r(4,26,27,26,'s'); c.p(10,26,'t'); c.p(21,26,'t')
I['prop_shop']=c
# ---- Lighthouse
c=C()
c.r(15,3,16,3,'x'); c.r(14,4,17,4,'x'); c.r(13,5,18,5,'R')
c.r(13,6,18,8,'y'); c.r(15,6,16,8,'Y'); c.p(13,6,'S'); c.p(18,6,'S'); c.p(13,8,'S'); c.p(18,8,'S')
for x,y in ((11,6),(10,7),(8,7),(9,7),(20,6),(21,7),(22,7),(23,7)): c.p(x,y,'Y' if x in (11,20) else 'y')
c.r(11,9,20,9,'S'); c.r(11,9,20,9,'s'); c.p(11,9,'S'); c.p(20,9,'S')
for y in range(10,24):
    hw=3+(y-10)//4; x0=16-hw; x1=15+hw
    band=((y-10)//3)%2
    c.r(x0,y,x1,y,'h' if band==0 else 'x')
    c.r(x1-1,y,x1,y,'C' if band==0 else 'R')
c.r(15,12,16,13,'b'); c.p(15,12,'h'); c.r(15,20,16,23,'W'); c.p(16,22,'g')
c.r(8,24,23,26,'S'); c.r(9,24,22,24,'s'); c.p(10,24,'t'); c.p(18,24,'t'); c.p(8,24,None); c.p(23,24,None)
for x in (6,7,24,25):
    c.p(x,26,'b'); 
c.r(3,26,7,26,'b'); c.r(24,26,28,26,'b'); c.p(4,26,'h'); c.p(26,26,'h')
I['prop_lighthouse']=c
# ---- Mansion
c=C()
for x0 in (4,22):
    c.r(x0,12,x0+5,25,'c'); c.r(x0,10,x0+5,11,'U'); c.r(x0,10,x0+5,10,'T')
    c.r(x0+1,14,x0+2,16,'y'); c.r(x0+1,19,x0+2,21,'y'); c.p(x0+1,14,'Y'); c.p(x0+1,19,'Y')
    c.r(x0+4,14,x0+4,16,'b'); c.r(x0+4,19,x0+4,21,'b')
c.r(9,12,9,25,'C'); c.r(27,12,27,25,'C')
for i,y in enumerate(range(4,9)):
    c.r(14-2*i+1,y,17+2*i-1,y,'c')
    c.p(17+2*i-1,y,'C')
c.r(10,8,21,8,'c'); c.r(15,6,16,6,'g')
c.r(10,9,21,10,'g'); c.r(10,10,21,10,'G')
c.r(10,11,21,25,'C')
for x in (11,14,17,20):
    c.r(x,11,x,23,'h'); c.r(x+1,11,x+1,23,'c')
c.r(10,24,21,24,'t')
c.r(15,19,16,23,'W'); c.p(16,21,'g'); c.r(15,19,16,19,'G')
c.r(12,25,19,25,'t'); c.r(13,26,18,26,'s')
c.r(3,26,12,26,'n'); c.r(19,26,28,26,'n'); c.p(5,26,'N'); c.p(9,26,'N'); c.p(22,26,'N'); c.p(26,26,'N')
I['prop_mansion']=c
# ---- Property (section icon)
c=C(); grass(c)
c.r(21,6,22,10,'B'); c.r(21,6,22,6,'M')
for i,y in enumerate(range(5,12)):
    x0=14-2*i; x1=17+2*i; x0=max(x0,3); x1=min(x1,28)
    c.r(x0,y,x1,y,'T'); c.r(16,y,x1,y,'U') if y>6 else None
c.r(15,5,16,5,'T')
c.r(4,12,27,12,'U')
c.r(7,13,24,24,'c'); c.r(23,13,24,24,'C')
c.r(9,15,12,18,'y'); c.p(9,15,'Y'); c.r(10,15,10,18,'G'); c.r(9,16,12,16,'G')
c.r(19,15,22,18,'b'); c.p(19,15,'h'); c.r(20,15,20,18,'s'); c.r(19,16,22,16,'s')
c.r(14,17,17,24,'w'); c.r(14,17,17,17,'W'); c.p(16,21,'g')
I['property']=c
# ---- For sale lot
c=C(); grass(c,y0=21,y1=26)
for y in range(22,27):
    for x in range(3,29):
        if (x*7+y*3)%9==0: c.p(x,y,'N')
c.r(15,13,16,22,'w'); c.r(16,13,16,22,'W')
c.r(7,5,24,13,'x'); c.r(8,6,23,12,'h')
hexr=["..gggg..",".gGGGGg.","gG....Gg","gG....Gg",".gGGGGg.","..gggg.."]
c.stamp(12,6,["..gggggg..",".gg....gg.","gg......gg","gg......gg",".gg....gg.","..gggggg.."])
c.r(8,6,23,6,'h')
I['lot_forsale']=c
# ---- Condemned
c=C()
c.r(3,25,28,26,'d'); 
for x in range(3,29):
    if x%3==0: c.p(x,25,'W')
c.r(6,15,25,24,'e')
for x in range(6,26):
    if x%3==0: c.r(x,15,x,24,'E')
for i,y in enumerate(range(8,14)):
    hw=3+i*3; c.r(max(3,16-hw),y,min(28,15+hw),y,'Z')
    for x in range(max(3,16-hw),min(28,15+hw)+1):
        if x%3==0: c.p(x,y,'E')
c.r(3,14,28,14,'E')
for x,y in ((18,10),(19,10),(19,11),(20,11),(18,11),(19,12)): c.p(x,y,None); c.im.putpixel((x,y),(13,19,34,255))
c.r(8,17,12,21,'E')
for i in range(5): c.p(8+i,17+i,'a'); c.p(12-i,17+i,'a')
c.r(18,17,22,24,'E')
for y in (18,21): c.r(17,y,23,y,'a'); c.r(17,y+1,23,y+1,'w')
c.r(4,22,27,23,'x')
for x in range(4,28):
    if x%4 in (0,1): c.p(x,22,'g'); c.p(x,23,'g')
I['lot_condemned']=c
# ---- Squatter
c=C()
c.r(10,5,21,8,'p'); c.r(10,8,21,9,'P'); c.r(15,4,16,4,'P')
c.r(10,10,21,17,'f'); c.r(20,10,21,17,'F')
c.r(12,12,13,12,'K'); c.r(18,12,19,12,'K')
c.r(12,11,13,11,'F'); c.r(18,11,19,11,'F')
c.r(14,15,17,15,'F'); 
for x in (11,13,18,20): c.p(x,16,'F')
c.r(6,18,25,26,'o'); c.r(6,18,25,18,'a')
for y in (20,23): c.r(6,y,25,y,'x')
c.r(22,18,25,26,'a'); c.r(9,21,10,22,'f'); c.r(21,21,22,22,'f')
I['squatter']=c
# ---- Repair (hammer, no outline)
c=C()
for x in range(32):
    for y in range(32):
        u=(y-12)-(x-19); v=(x-19)+(y-12)
        if 0<=u<=26 and -1<=v<=0: c.p(x,y,'w' if v==0 else 'l')
for x in range(32):
    for y in range(32):
        b=(x-21)+(y-10); a=(x-21)-(y-10)
        if -3<=a<=2 and -12<=b<=12: c.p(x,y,'t' if a>=2 else ('S' if a<=-3 else 's'))
I['repair']=c
# ---- Tax
c=C()
c.r(8,5,23,26,'h'); c.r(22,5,23,6,None)
for (x,y) in ((22,5),(23,5),(23,6)): c.im.putpixel((x,y),(13,19,34,255))
c.p(22,6,'C'); c.r(8,26,23,26,'C'); c.r(23,7,23,26,'C')
c.r(10,8,17,8,'S'); c.r(10,10,20,10,'s')
c.stamp(11,13,["xx.....x","xx....x.",".....x..","....x...","...x....","..x.....",".x....xx","x.....xx"])
c.r(10,23,14,23,'s'); c.r(17,22,21,24,'g'); c.r(18,23,20,23,'G')
I['tax']=c
# ---- Bid (envelope with a gold seal)
c=C()
c.r(5,9,26,23,'h'); c.r(5,23,26,23,'C'); c.r(26,9,26,23,'C')
for i in range(11):
    c.p(5+i,9+i,'C'); c.p(26-i,9+i,'C')
for i in range(10):
    c.r(6+i,9+i,25-i,9+i,'t') if i<10 else None
c.stamp(13,15,["..gggg..",".gGGGGg.","gGg..gGg","gGg..gGg",".gGGGGg.","..gggg.."])
I['bid']=c
# ---- Auction (gavel, no outline)
c=C()
for x in range(32):
    for y in range(32):
        a=(x-12)-(y-9); b=(x-12)+(y-9)
        if -4<=a<=4 and -3<=b<=3:
            c.p(x,y,'G' if abs(a)==2 else ('l' if b<=-2 else ('W' if b>=2 else 'w')))
for x in range(32):
    for y in range(32):
        u=(x-15)+(y-12); v=(x-15)-(y-12)
        if 0<=v<=14 and 0<=u<=1: c.p(x,y,'w' if u==0 else 'W')
c.r(8,23,23,24,'w'); c.r(8,23,23,23,'l'); c.r(6,25,25,26,'W'); c.r(6,25,25,25,'w')
I['auction']=c
# ---- Sold
c=C(); grass(c,y0=24)
c.r(8,16,9,24,'w'); c.r(22,16,23,24,'w'); c.r(9,16,9,24,'W'); c.r(23,16,23,24,'W')
c.r(4,6,27,16,'U'); c.r(5,7,26,15,'T'); c.r(5,7,26,7,'h')
c.stamp(7,9,["hhh.hhh.h...hh.","h...h.h.h...h.h","hhh.h.h.h...h.h","..h.h.h.h...h.h","hhh.hhh.hhh.hh."])
I['sold']=c
# ---- Key
c=C()
c.stamp(4,10,[".gggg.","gggggg","gG..Gg","gG..Gg","gggggg",".GGGG."])
c.r(10,12,26,13,'g'); c.r(10,14,26,14,'G'); c.r(10,12,26,12,'Y')
c.r(20,15,21,18,'G'); c.r(24,15,25,17,'G'); c.r(20,15,20,18,'g'); c.r(24,15,24,17,'g')
c.p(5,10,'Y'); c.p(4,11,'Y')
I['key']=c
# ---- Full set (crown over a house)
c=C(); grass(c,y0=26,y1=26)
c.stamp(7,4,["g.........g......g","gg.......ggg....gg"[:18]])
crown=["g.......gg.......g","gg.....gggg.....gg","ggg...gggggg...ggg","gggggggggggggggggg","ggxgggggbgggggxggg","GGGGGGGGGGGGGGGGGG"]
c=C(); grass(c,y0=26,y1=26)
c.stamp(7,4,crown)
for x in (7,16,24): c.p(x,3,'Y')
for i,y in enumerate(range(12,17)):
    c.r(15-2*i,y,16+2*i,y,'T'); c.r(16,y,16+2*i,y,'U')
c.r(8,17,23,25,'c'); c.r(22,17,23,25,'C')
c.r(10,19,12,21,'y'); c.r(19,19,21,21,'y'); c.r(14,20,17,25,'w'); c.p(16,23,'g')
I['fullset']=c
# ---- Evict
c=C()
c.r(4,6,14,26,'W'); c.r(6,8,12,26,'E'); c.r(4,6,14,6,'w')
c.r(13,8,15,26,'l'); c.r(15,9,15,26,'w')    # the door swung open
c.p(13,17,'g')
c.stamp(17,11,["......x....","......xx...","xxxxxxxxx..","xxxxxxxxxx.","xxxxxxxxxxx","xxxxxxxxxx.","xxxxxxxxx..","......xx...","......x...."])
c.r(17,15,26,15,'R'); 
I['evict']=c
