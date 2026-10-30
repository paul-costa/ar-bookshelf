"""Overlay book polygons from a compartment JSON onto the panorama crop for verification.
usage: draw.py BOOKS.json X0 Y0 X1 Y1 OUT.png [--max 1500]"""
import sys, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = None
SRC = Path(__file__).resolve().parent.parent / "output" / "buecherregal_panorama.jpg"
a = sys.argv[1:]
books = json.load(open(a[0])); x0, y0, x1, y1 = map(int, a[1:5]); out = a[5]
mx = int(a[a.index("--max")+1]) if "--max" in a else 1500
im = Image.open(SRC).convert("RGB").crop((x0, y0, x1, y1))
d = ImageDraw.Draw(im, "RGBA")
try: f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 13)
except Exception: f = ImageFont.load_default()
cols = [(0,255,255),(255,0,255),(255,255,0),(0,255,0)]
for i, b in enumerate(books):
    p = [(x - x0, y - y0) for x, y in b["poly"]]
    c = cols[i % 4]
    d.polygon(p, outline=c + (255,), fill=c + (40,))
    cx = sum(q[0] for q in p) / 4; cy = sum(q[1] for q in p) / 4
    lab = b["id"].split("-")[-1]
    d.rectangle([cx-10, cy-8, cx+12, cy+8], fill=(0,0,0,200)); d.text((cx-9, cy-7), lab, fill=c, font=f)
s = min(1.0, mx / max(im.size))
if s < 1: im = im.resize((int(im.width*s), int(im.height*s)), Image.LANCZOS)
im.save(out); print(out, im.size)
