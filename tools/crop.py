"""Crop the bookshelf panorama with a global-coordinate grid.
usage: crop.py X0 Y0 X1 Y1 OUT.png [--grid N] [--rot 90|-90] [--max 1500] [--nogrid]
Grid lines/labels are in ORIGINAL panorama pixel coordinates (4785x4300)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = None
SRC = Path(__file__).resolve().parent.parent / "output" / "buecherregal_panorama.jpg"
a = sys.argv[1:]
x0, y0, x1, y1 = map(int, a[:4]); out = a[4]
grid = int(a[a.index("--grid")+1]) if "--grid" in a else 50
rot = int(a[a.index("--rot")+1]) if "--rot" in a else 0
mx = int(a[a.index("--max")+1]) if "--max" in a else 1500
im = Image.open(SRC).convert("RGB").crop((x0, y0, x1, y1))
s = min(1.0, mx / max(im.size)) if not rot else min(1.0, mx / max(im.size))
if "--nogrid" not in a:
    # upscale small crops so labels stay readable
    up = max(1.0, 900 / max(im.size))
    if up > 1: im = im.resize((int(im.width*up), int(im.height*up)), Image.LANCZOS)
    k = im.width / (x1 - x0)
    d = ImageDraw.Draw(im)
    try: f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 14)
    except Exception: f = ImageFont.load_default()
    gx = (x0 // grid + 1) * grid
    while gx < x1:
        px = (gx - x0) * k
        major = gx % (grid*2) == 0
        d.line([(px, 0), (px, im.height)], fill=(0,255,255) if major else (255,0,255), width=1)
        if major:
            d.rectangle([px+1, 0, px+38, 15], fill=(0,0,0)); d.text((px+2, 0), str(gx), fill=(0,255,255), font=f)
            d.rectangle([px+1, im.height-16, px+38, im.height], fill=(0,0,0)); d.text((px+2, im.height-16), str(gx), fill=(0,255,255), font=f)
        gx += grid
    gy = (y0 // grid + 1) * grid
    while gy < y1:
        py = (gy - y0) * k
        major = gy % (grid*2) == 0
        d.line([(0, py), (im.width, py)], fill=(255,255,0) if major else (255,128,0), width=1)
        if major:
            d.rectangle([0, py+1, 38, py+16], fill=(0,0,0)); d.text((1, py+1), str(gy), fill=(255,255,0), font=f)
        gy += grid
if rot: im = im.rotate(rot, expand=True)
s = min(1.0, mx / max(im.size))
if s < 1: im = im.resize((int(im.width*s), int(im.height*s)), Image.LANCZOS)
im.save(out)
print(out, im.size)
