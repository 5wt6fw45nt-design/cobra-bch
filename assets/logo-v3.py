# Cobra app icon v3: three single-shape concepts (one strong silhouette each), drawn at 4x and scaled down.
#   1 «Bocadillo pagado»: a speech bubble (voice) with a bold check (paid) inside.
#   2 «C de Cobra»: a thick C whose opening ends in a check mark.
#   3 «Bocadillo-recibo»: a speech bubble whose bottom is a torn receipt edge, with a check.
# Uso: python3 assets/logo-v3.py -> assets/logo-v3-1.png … -3.png (1024 px)

import os, math
from PIL import Image, ImageDraw, ImageFilter

S, OUT = 4096, 1024
DIR = os.path.dirname(os.path.abspath(__file__))
G1, G2 = (24, 220, 164), (4, 120, 92)       # verde Bitcoin Cash, claro → oscuro
INK = (8, 14, 24)

def gradient(c1, c2):
    """Smooth diagonal gradient (top-left c1 → bottom-right c2), computed small and scaled up."""
    n = 256
    small = Image.new('RGBA', (n, n))
    px = small.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1))
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
    return small.resize((S, S), Image.BICUBIC)

def tile(bg):
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), 920, fill=255)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0)); out.paste(bg, (0, 0), m)
    return out

def shadow_of(mask, dy=70, blur=110, op=0.35):
    sh = Image.new('RGBA', (S, S), (0, 20, 14, 0)); sh.putalpha(mask.point(lambda v: int(v * op)))
    sh = sh.filter(ImageFilter.GaussianBlur(blur)); out = Image.new('RGBA', (S, S), (0, 0, 0, 0)); out.alpha_composite(sh, (0, dy)); return out

def check(d, pts, w, color):
    d.line(pts, fill=color, width=w, joint='curve')
    for p in (pts[0], pts[-1]): d.ellipse((p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2), fill=color)

def bubble_mask(torn=False):
    m = Image.new('L', (S, S), 0); d = ImageDraw.Draw(m)
    x0, y0, x1, y1 = 820, 900, 3280, 2860
    if not torn:
        d.rounded_rectangle((x0, y0, x1, y1), 620, fill=255)
        d.polygon([(1250, y1 - 200), (1050, 3420), (1800, y1 - 60)], fill=255)   # tail, bottom left
    else:
        d.rounded_rectangle((x0, y0, x1, y1), 520, fill=255)
        d.rectangle((x0, y0 + 600, x1, y1), fill=255)
        n, tooth = 6, 300; w = (x1 - x0) / n
        pts = [(x0, y1)] + [p for i in range(n) for p in ((x0 + i * w + w / 2, y1 + tooth), (x0 + (i + 1) * w, y1))]
        d.polygon(pts, fill=255)
    return m

def concept1():
    img = tile(gradient(G1, G2))
    m = bubble_mask()
    img.alpha_composite(shadow_of(m))
    paper = Image.new('RGBA', (S, S), (255, 255, 255, 255)); paper.putalpha(m); img.alpha_composite(paper)
    check(ImageDraw.Draw(img), [(1450, 1900), (1900, 2350), (2720, 1420)], 330, G2)
    return img

def concept2():
    img = tile(gradient((24, 32, 46), (6, 9, 15)))
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((900, 900, 3200, 3200), fill=(10, 193, 142, 90))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(420)))
    ring = Image.new('L', (S, S), 0); d = ImageDraw.Draw(ring)
    cx, cy, r, w = 2048, 2048, 1250, 430
    d.arc((cx - r, cy - r, cx + r, cy + r), 40, 320, fill=255, width=w)
    for ang in (40, 320):  # round caps
        a = math.radians(ang); px, py = cx + (r - w / 2) * math.cos(a), cy + (r - w / 2) * math.sin(a)
        d.ellipse((px - w / 2, py - w / 2, px + w / 2, py + w / 2), fill=255)
    g = gradient(G1, G2); g.putalpha(ring); img.alpha_composite(g)
    check(ImageDraw.Draw(img), [(2250, 2080), (2620, 2450), (3420, 1520)], 300, (255, 255, 255))
    return img

def concept3():
    img = tile(gradient(G1, G2))
    m = bubble_mask(torn=True)
    img.alpha_composite(shadow_of(m))
    paper = Image.new('RGBA', (S, S), (255, 255, 255, 255)); paper.putalpha(m); img.alpha_composite(paper)
    check(ImageDraw.Draw(img), [(1450, 1880), (1900, 2330), (2720, 1400)], 330, INK)
    return img

for i, f in enumerate((concept1, concept2, concept3), 1):
    f().resize((OUT, OUT), Image.LANCZOS).save(os.path.join(DIR, f'logo-v3-{i}.png')); print('ok', i)
