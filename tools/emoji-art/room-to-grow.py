# Room to Grow's 17 property emojis. Run: python3 tools/emoji-art/room-to-grow.py (writes to tools/emoji-art/out/)
import os
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'room-to-grow-base.py')).read())
import math
P.update({"Q":(160,140,0),"q":(255,230,0),"V":(255,242,122)})
HEX=["...QQQ...",".QQVVVQQ.","QVVVVVVVQ","QqqVVVqqQ","QqqqQqqqQ",".QQqQqQQ.","...QQQ..."]
OLD=["...gggg...","..gYgggg..",".gYggggggg","gggggggggg","gggggggggG",".GgggggggG","..GGGGGG.."]
c=I['prop_shop']; c.r(5,7,26,9,'U'); c.r(5,7,26,7,'T')
c.stamp(12,6,[".QQQQQQ.","QVVVVVVQ","QqqVVqqQ","QqqQQqqQ",".QQQQQQ."])
for x in (7,8,9,22,23,24): c.p(x,8,'h')
c=I['lot_forsale']; c.r(8,6,23,12,'h'); c.stamp(11,6,HEX)
c=I['squatter']
c.r(10,10,21,17,'f'); c.r(20,10,21,17,'F')
c.r(12,12,13,13,'K'); c.r(18,12,19,13,'K'); c.p(12,12,'h'); c.p(18,12,'h')
c.p(12,15,'W'); c.p(19,15,'W'); c.r(13,16,18,16,'W'); c.p(11,14,'k'); c.p(20,14,'k')
c=C(); r2=math.sqrt(2)
for x in range(32):
    for y in range(32):
        s=((x-11.5)-(y-10.5))/r2; t=((x-11.5)+(y-10.5))/r2
        if abs(s)<=5.6 and abs(t)<=2.6:
            col='w'
            if 3.4<=abs(s)<=4.4: col='g'
            elif t<-1.4: col='l'
            elif t>1.4: col='W'
            if abs(s)>5.0: col='W'
            c.p(x,y,col)
        elif 2.6<t<=15 and abs(s)<=1.0:
            c.p(x,y,'l' if s<0 else 'w')
c.r(8,23,23,24,'w'); c.r(8,23,23,23,'l'); c.r(6,25,25,26,'W'); c.r(6,25,25,25,'w')
I['auction']=c
c=I['bid']; c.r(13,15,20,20,'h'); c.stamp(11,14,HEX)
for k,cv in I.items(): cv.im.resize((128,128),Image.NEAREST).save(f'{OUT2}/rc_{k}.png')
names=['prop_shack','prop_apartment','prop_shop','prop_lighthouse','prop_mansion','property','lot_forsale','lot_condemned','squatter','repair','tax','bid','auction','sold','key','fullset','evict']
cols=9; cell=118
sheet=Image.new('RGBA',(cols*cell+30,330),(49,51,56,255)); d=ImageDraw.Draw(sheet)
d.text((15,10),'Room to Grow - property emojis',fill=(240,240,240))
for i,k in enumerate(names):
    t=I[k].im.resize((96,96),Image.NEAREST); x=15+(i%cols)*cell; y=35+(i//cols)*125
    sheet.paste(t,(x,y),t); d.text((x,y+99),k,fill=(180,180,180))
d.text((15,290),'Chat size:',fill=(240,240,240))
for i,k in enumerate(names):
    t=I[k].im.resize((128,128),Image.NEAREST).resize((22,22),Image.LANCZOS); sheet.paste(t,(90+i*26,286),t)
sheet.save(os.path.join(HERE,'out','preview.png'))
z=Image.new('RGBA',(4*260,260),(49,51,56,255))
for i,k in enumerate(['prop_shop','auction','lot_forsale','squatter']):
    im=I[k].im.resize((256,256),Image.NEAREST); z.paste(im,(i*260,0),im)

