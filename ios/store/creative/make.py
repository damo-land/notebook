import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
F='/Users/damo/Desktop/damo/code/20days/node_modules/@expo-google-fonts/'
DISPLAY=F+'funnel-display/600SemiBold/FunnelDisplay_600SemiBold.ttf'
SANS=F+'funnel-sans/600SemiBold/FunnelSans_600SemiBold.ttf'
SANS_R=F+'funnel-sans/400Regular/FunnelSans_400Regular.ttf'
PAPER=(246,245,241); INK=(19,19,17); FADED=(111,110,103); BLUE=(35,55,255)
SHOTS='/Users/damo/Desktop/damo/code/notebook/ios/store/screenshots/'
OUT=sys.argv[1]

def phone(name, h):
    """Screenshot as a rounded 'device' card with a soft shadow, height h."""
    im=Image.open(SHOTS+name).convert('RGB')
    w=round(im.width*h/im.height); im=im.resize((w,h), Image.LANCZOS)
    r=round(w*0.12)
    mask=Image.new('L',(w,h),0); ImageDraw.Draw(mask).rounded_rectangle([0,0,w-1,h-1],r,fill=255)
    pad=round(h*0.08)
    card=Image.new('RGBA',(w+2*pad,h+2*pad),(0,0,0,0))
    sh=Image.new('L',(w+2*pad,h+2*pad),0)
    ImageDraw.Draw(sh).rounded_rectangle([pad,pad+round(h*0.015),pad+w,pad+h+round(h*0.015)],r,fill=70)
    sh=sh.filter(ImageFilter.GaussianBlur(round(h*0.03)))
    card.paste((0,0,0,255),(0,0),sh)
    border=Image.new('RGBA',(w,h),(0,0,0,0)); ImageDraw.Draw(border).rounded_rectangle([0,0,w-1,h-1],r,outline=(19,19,17,40),width=max(2,round(w*0.004)))
    card.paste(im,(pad,pad),mask); card.alpha_composite(border,(pad,pad))
    return card, pad

def wordmark(draw, img, x, y, size):
    f=ImageFont.truetype(DISPLAY,size)
    draw.text((x,y),'stash',font=f,fill=INK,anchor='ls')
    tw=draw.textlength('stash',font=f); s=round(size*0.15)
    draw.rectangle([x+tw+round(size*0.08), y-s, x+tw+round(size*0.08)+s, y], fill=BLUE)
    return tw+round(size*0.08)+s

# ---------- Header 3840 x 1646 (safe: x 1097-2743, y 493-1154) ----------
W,H=3840,1646
img=Image.new('RGBA',(W,H),PAPER+(255,)); d=ImageDraw.Draw(img)
# decorative phones at the edges (may be cropped on narrow screens)
for name,cx,top in [('1-tasks.png',520,260),('3-note.png',3320,300)]:
    c,pad=phone(name,1500); img.alpha_composite(c,(cx-c.width//2, top-pad))
# centred wordmark + line inside the safe area
size=300; f=ImageFont.truetype(DISPLAY,size)
tw=d.textlength('stash',font=f)+round(size*0.08)+round(size*0.15)
base_y=880
wordmark(d,img,round((W-tw)/2),base_y,size)
line='Notes pile up. Tasks drift.'
fl=ImageFont.truetype(SANS,96)
d.text((W/2,base_y+190),line,font=fl,fill=FADED,anchor='ms')
img.convert('RGB').save(OUT+'/header-3840x1646.png')

# ---------- Search results 3840 x 2560 (safe: x 836-3004, y 765-1795) ----------
W,H=3840,2560
img=Image.new('RGBA',(W,H),PAPER+(255,)); d=ImageDraw.Draw(img)
ph=1750; names=['1-tasks.png','4-chat.png','3-note.png']
cards=[phone(n,ph) for n in names]
gap=90; total=sum(c.width-2*p for c,p in cards)+gap*2
x=(W-total)//2; top=(H-ph)//2
for c,p in cards:
    img.alpha_composite(c,(x-p, top-p)); x+=c.width-2*p+gap
img.convert('RGB').save(OUT+'/search-3840x2560.png')
print('ok')
