# Cobra · logo v4: a minimalist «C», art deco or pop. Drawn at 4x and scaled down.
#   1 Deco lines:   three concentric gold arcs (inline strokes) + sunburst in the opening, on deep emerald, deco frame.
#   2 Deco sunrise: one thick cream C with stepped ends, a fan of rays rising inside it, on dark green.
#   3 Pop bold:     white C with a thick black outline and a hard offset shadow, on BCH green with halftone dots.
#   4 Pop stripes:  streamline C of three parallel bands (green, black, gold) on cream.
# Uso: python3 assets/logo-v4.py -> assets/logo-v4-1.png … -4.png (1024 px)

import os, math
from PIL import Image, ImageDraw, ImageFilter

S, OUT = 4096, 1024
C = S / 2
DIR = os.path.dirname(os.path.abspath(__file__))
GOLD = (222, 186, 110)
GOLD_D = (168, 128, 62)
EMERALD = (6, 46, 38)
EMERALD_D = (3, 22, 19)
BCH = (10, 193, 142)
CREAM = (246, 236, 214)
BLACK = (12, 14, 18)

def gradient(c1, c2):
    n = 256; small = Image.new('RGBA', (n, n)); px = small.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1))
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
    return small.resize((S, S), Image.BICUBIC)

def radial(c_in, c_out):
    n = 256; small = Image.new('RGBA', (n, n)); px = small.load()
    for y in range(n):
        for x in range(n):
            t = min(1, math.hypot(x - n / 2, y - n / 2) / (n * 0.7))
            px[x, y] = tuple(int(c_in[i] + (c_out[i] - c_in[i]) * t) for i in range(3)) + (255,)
    return small.resize((S, S), Image.BICUBIC)

def tile(img, r=900):
    m = Image.new('L', (S, S), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), r, fill=255)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0)); out.paste(img, (0, 0), m); return out

def arc_mask(r, w, a0, a1, caps='round'):
    """Mask of an arc band of radius r (centre line) and width w from angle a0 to a1 (degrees, PIL: 0 = east, clockwise)."""
    m = Image.new('L', (S, S), 0); d = ImageDraw.Draw(m)
    d.arc((C - r - w / 2, C - r - w / 2, C + r + w / 2, C + r + w / 2), a0, a1, fill=255, width=int(w))
    if caps == 'round':
        for a in (a0, a1):
            t = math.radians(a); x, y = C + r * math.cos(t), C + r * math.sin(t)
            d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=255)
    return m

def paint(img, mask, color):
    layer = Image.new('RGBA', (S, S), color + (255,)) if isinstance(color, tuple) else color.copy()
    layer.putalpha(mask); img.alpha_composite(layer)

def deco_frame(img, color, inset=210, w=34):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((inset, inset, S - inset, S - inset), 700, outline=color, width=w)
    d.rounded_rectangle((inset + 90, inset + 90, S - inset - 90, S - inset - 90), 620, outline=color, width=int(w / 2))

def rays(img, cx, cy, r0, r1, a0, a1, n, w, color, clip=None):
    lay = Image.new('L', (S, S), 0); d = ImageDraw.Draw(lay)
    for i in range(n):
        a = math.radians(a0 + (a1 - a0) * i / (n - 1))
        d.line([(cx + r0 * math.cos(a), cy + r0 * math.sin(a)), (cx + r1 * math.cos(a), cy + r1 * math.sin(a))], fill=255, width=w)
    if clip is not None: lay = Image.composite(lay, Image.new('L', (S, S), 0), clip)
    paint(img, lay, color)

def logo1():
    img = radial((10, 70, 56), EMERALD_D)
    gold = gradient((240, 210, 140), GOLD_D)
    for r, w in ((1250, 150), (1010, 150), (770, 150)):
        paint(img, arc_mask(r, w, 45, 315, caps='flat'), gold)
    # sunburst in the opening of the C
    rays(img, C, C, 520, 1420, -40, 40, 9, 46, gold)
    d = ImageDraw.Draw(img); d.ellipse((C - 230, C - 230, C + 230, C + 230), fill=GOLD)
    d.ellipse((C - 150, C - 150, C + 150, C + 150), fill=EMERALD_D)
    deco_frame(img, GOLD)
    return tile(img)

def logo2():
    img = gradient((8, 58, 46), EMERALD_D)
    r, w = 1180, 560
    band = arc_mask(r, w, 48, 312, caps='flat')
    # stepped (ziggurat) ends: small blocks added at both terminals
    d = ImageDraw.Draw(band)
    for a in (48, 312):
        t = math.radians(a)
        for k, (dr, size) in enumerate(((0, 300), (0, 190))):
            x, y = C + (r + w / 2 - size / 2) * math.cos(t), C + (r + w / 2 - size / 2) * math.sin(t)
    paint(img, band, CREAM)
    # inner fan of rays rising from the bottom of the C's hollow
    hollow = Image.new('L', (S, S), 0); ImageDraw.Draw(hollow).ellipse((C - r + w / 2 + 40, C - r + w / 2 + 40, C + r - w / 2 - 40, C + r - w / 2 - 40), fill=255)
    rays(img, C, C + 520, 0, 1300, 200, 340, 11, 60, (BCH[0], BCH[1], BCH[2]), clip=hollow)
    ImageDraw.Draw(img).ellipse((C - 170, C + 350, C + 170, C + 690), fill=BCH)
    # thin inline in the band
    paint(img, arc_mask(r, 40, 52, 308, caps='flat'), EMERALD_D)
    return tile(img)

def logo3():
    """Pop: white C, thick black outline, hard offset shadow, BCH green with halftone dots."""
    img = Image.new('RGBA', (S, S), BCH + (255,))
    d = ImageDraw.Draw(img)
    step = 150
    for y in range(0, S + step, step):
        for x in range(0, S + step, step):
            t = (x + y) / (2 * S)
            rr = 8 + 50 * t
            ox = (step / 2) if (y // step) % 2 else 0
            d.ellipse((x + ox - rr, y - rr, x + ox + rr, y + rr), fill=(7, 166, 121))
    r, w, line, off = 1120, 620, 110, 130
    a0, a1 = 44, 316
    shape = arc_mask(r, w + 2 * line, a0, a1)                 # outline silhouette
    shadow = Image.new('L', (S, S), 0); shadow.paste(shape, (off, off))
    shadow = Image.composite(Image.new('L', (S, S), 255), Image.new('L', (S, S), 0), shadow)
    paint(img, shadow, BLACK)                                   # hard shadow, same shape, offset down-right
    paint(img, shape, BLACK)                                    # outline
    paint(img, arc_mask(r, w, a0, a1), (255, 255, 255))         # face
    paint(img, arc_mask(r + 170, 64, 160, 210), (255, 226, 92)) # small pop highlight
    return tile(img)

def logo4():
    img = Image.new('RGBA', (S, S), CREAM + (255,))
    w, gap = 300, 90
    for i, col in enumerate((BCH, BLACK, (232, 176, 52))):
        r = 1350 - i * (w + gap)
        paint(img, arc_mask(r, w, 25, 335, caps='flat'), col)
    # streamline cut: the opening is a clean vertical edge shared by the three bands
    ImageDraw.Draw(img).rectangle((C + 620, 0, S, S), fill=CREAM)
    return tile(img)

for i, f in enumerate((logo1, logo2, logo3, logo4), 1):
    f().resize((OUT, OUT), Image.LANCZOS).save(os.path.join(DIR, f'logo-v4-{i}.png')); print('ok', i)
