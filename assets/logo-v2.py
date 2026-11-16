# Cobra app icon v2: same idea as logo.svg (invoice + voice wave + paid badge), polished as an app icon.
# Drawn at 4x and scaled down for clean edges. Two variants: A (BCH green), B (dark with green glow).
# Uso: python3 assets/logo-v2.py  -> assets/logo-v2-a.png, assets/logo-v2-b.png (1024 px)

import os
from PIL import Image, ImageDraw, ImageFilter, ImageChops

S = 4096
OUT = 1024
DIR = os.path.dirname(os.path.abspath(__file__))

def lin_gradient(size, c1, c2, diag=True):
    w, h = size
    g = Image.new('RGBA', size)
    px = g.load()
    for y in range(h):
        for x in range(0, w, 4):
            t = ((x / w) + (y / h)) / 2 if diag else y / h
            c = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
            for k in range(4):
                if x + k < w: px[x + k, y] = c
    return g

def rounded_mask(size, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), r, fill=255)
    return m

def shadow(mask, offset, blur, opacity, color=(0, 0, 0)):
    sh = Image.new('RGBA', mask.size, color + (0,))
    a = mask.point(lambda v: int(v * opacity))
    sh.putalpha(a)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    out = Image.new('RGBA', mask.size, (0, 0, 0, 0))
    out.alpha_composite(sh, offset)
    return out

def receipt_mask():
    """Paper slip: rounded top corners, square sides, torn (zigzag) bottom edge."""
    m = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(m)
    x0, y0, x1, y1 = 1180, 760, 2900, 3260
    tooth = 230
    d.rounded_rectangle((x0, y0, x1, y1 - tooth), 170, fill=255)
    d.rectangle((x0, y0 + 400, x1, y1 - tooth), fill=255)
    teeth = 6
    w = (x1 - x0) / teeth
    pts = [(x0, y1 - tooth)]
    for i in range(teeth):
        pts += [(x0 + i * w + w / 2, y1), (x0 + (i + 1) * w, y1 - tooth)]
    d.polygon(pts, fill=255)
    return m

def bars_mask():
    m = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(m)
    cx, cy, bw, gap = 2040, 1800, 150, 110
    heights = [380, 760, 1140, 760, 380]
    for i, hgt in enumerate(heights):
        x = cx + (i - 2) * (bw + gap) - bw / 2
        d.rounded_rectangle((x, cy - hgt / 2, x + bw, cy + hgt / 2), bw / 2, fill=255)
    return m

def badge(img, fill, check, ring):
    cx, cy, r = 2860, 2900, 560
    m = Image.new('L', (S, S), 0); ImageDraw.Draw(m).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    img.alpha_composite(shadow(m, (0, 60), 90, 0.45))
    d = ImageDraw.Draw(img)
    d.ellipse((cx - r - 70, cy - r - 70, cx + r + 70, cy + r + 70), fill=ring)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill)
    d.line([(cx - 250, cy + 10), (cx - 70, cy + 190), (cx + 270, cy - 200)], fill=check, width=170, joint='curve')
    for (px, py) in [(cx - 250, cy + 10), (cx - 70, cy + 190), (cx + 270, cy - 200)]:
        d.ellipse((px - 85, py - 85, px + 85, py + 85), fill=check)

def build(variant):
    tile = rounded_mask((S, S), 920)
    if variant == 'a':
        bg = lin_gradient((S, S), (22, 214, 160), (5, 112, 86))
        bars_c1, bars_c2 = (14, 186, 139), (6, 110, 84)
        badge_fill, badge_check, ring = (9, 17, 28, 255), (22, 214, 160, 255), (255, 255, 255, 255)
    else:
        bg = lin_gradient((S, S), (26, 34, 50), (6, 9, 15))
        glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse((700, 500, 3400, 3500), fill=(10, 193, 142, 120))
        bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(500)))
        bars_c1, bars_c2 = (10, 193, 142), (4, 120, 90)
        badge_fill, badge_check, ring = (10, 193, 142, 255), (6, 9, 15, 255), (6, 9, 15, 255)
    # soft top highlight
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse((-1200, -3200, S + 1200, 1400), fill=(255, 255, 255, 30))
    bg.alpha_composite(hl.filter(ImageFilter.GaussianBlur(700)))

    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    img.alpha_composite(bg)
    rm = receipt_mask()
    img.alpha_composite(shadow(rm, (0, 90), 120, 0.40, (2, 30, 22) if variant == 'a' else (0, 0, 0)))
    paper = lin_gradient((S, S), (255, 255, 255), (232, 240, 246), diag=False)
    paper.putalpha(rm); img.alpha_composite(paper)
    bars = lin_gradient((S, S), bars_c1, bars_c2, diag=False)
    bars.putalpha(bars_mask()); img.alpha_composite(bars)
    badge(img, badge_fill, badge_check, ring)
    # clip to the rounded tile
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.paste(img, (0, 0), tile)
    return out.resize((OUT, OUT), Image.LANCZOS)

for v in ('a', 'b'):
    build(v).save(os.path.join(DIR, f'logo-v2-{v}.png'))
    print('ok', v)
