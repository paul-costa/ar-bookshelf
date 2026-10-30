"""Derive the drawn shelf from the panorama: compartment frames and per-book spine colours.

usage: python tools/build_scene.py            (needs numpy, opencv-python, pillow)
Writes docs/scene.js (window.SCENE). Compartment boxes come from the annotated book polygons,
spine colours from k-means over each book polygon in output/buecherregal_panorama.jpg."""
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
PANO = ROOT / "output" / "buecherregal_panorama.jpg"
W, H = 4785, 4300
BOARD = 52          # shelf board thickness in panorama pixels
FLOOR = 4235        # top of the plinth / floor line
# inner x range of the four shelf columns (side panels sit in the gaps)
COLS = {"L": (28, 1318), "M": (1352, 2166), "C": (2206, 3894), "R": (3928, 4768)}
TOP = {"L": 175, "M": 120, "C": 0, "R": 95}   # underside of each column's top board
ORDER = ["L1", "L2", "L3", "L4", "M1", "M2", "M3", "M4", "M5", "M6",
         "C1", "C2", "C3", "C4", "C5", "C6", "R1", "R2", "R3", "R4", "R5", "R6"]


def load_books():
    books = {}
    for c in ORDER:
        books[c] = json.load(open(ROOT / "data" / "books" / f"{c}.json"))
    return books


def compartments(books=None):
    """Boxes {id, x, y, w, h} per compartment: floor = lowest book edge, ceiling = board above."""
    books = books or load_books()
    out = []
    for col, (x0, x1) in COLS.items():
        ids = [c for c in ORDER if c[0] == col]
        prev_floor = None
        for c in ids:
            ys = [p[1] for b in books[c] for p in b["poly"]]
            floor = max(ys) + 4
            top = TOP[col] if prev_floor is None else prev_floor + BOARD
            out.append({"id": c, "x": x0, "y": top, "w": x1 - x0, "h": floor - top})
            prev_floor = floor
    return out


def spine_colors(img, poly):
    """(base, ink) in Lab: dominant colour of the spine and the most contrasting secondary colour."""
    p = np.array(poly, np.float32)
    c = p.mean(0)
    p = c + (p - c) * 0.82
    x0, y0 = np.floor(p.min(0)).astype(int)
    x1, y1 = np.ceil(p.max(0)).astype(int)
    x0, y0 = max(x0, 0), max(y0, 0)
    crop = img[y0:y1, x0:x1]
    if crop.size == 0:
        return np.float32([60, 128, 128]), np.float32([220, 128, 128])
    mask = np.zeros(crop.shape[:2], np.uint8)
    cv2.fillPoly(mask, [np.round(p - [x0, y0]).astype(np.int32)], 255)
    px = crop[mask > 0]
    if len(px) > 6000:
        px = px[np.random.default_rng(1).choice(len(px), 6000, replace=False)]
    lab = cv2.cvtColor(px.reshape(-1, 1, 3), cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    k = 3 if len(lab) > 30 else 1
    _, lbl, cen = cv2.kmeans(lab, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5), 3, cv2.KMEANS_PP_CENTERS)
    share = np.bincount(lbl.ravel(), minlength=k) / len(lbl)
    base = cen[share.argmax()]
    ink, best = None, 0
    for j in range(k):
        d = np.linalg.norm(cen[j] - base)
        if j != share.argmax() and share[j] > 0.06 and d > best:
            ink, best = cen[j], d
    if ink is None or best < 28:
        ink = np.float32([235, 128, 128]) if base[0] < 140 else np.float32([28, 128, 128])
    return base, ink


def to_hex(lab, cast, lift=False):
    """Lab (OpenCV 8-bit) -> hex, removing the photo's colour cast; optionally lift and saturate a little."""
    lab = lab.copy()
    lab[1:] -= cast
    rgb = cv2.cvtColor(np.uint8([[np.clip(lab, 0, 255)]]), cv2.COLOR_LAB2RGB)[0, 0]
    if lift:
        hsv = cv2.cvtColor(np.uint8([[rgb]]), cv2.COLOR_RGB2HSV)[0, 0].astype(float)
        hsv[1] = min(255, hsv[1] * 1.1)
        hsv[2] = min(255, hsv[2] * 1.08 + 6)
        rgb = cv2.cvtColor(np.uint8([[hsv]]), cv2.COLOR_HSV2RGB)[0, 0]
    return "#%02x%02x%02x" % tuple(int(v) for v in rgb)


def main():
    books = load_books()
    img = cv2.imread(str(PANO))
    raw = {b["id"]: spine_colors(img, b["poly"]) for c in ORDER for b in books[c]}
    # white balance: the near-neutral spines (white, grey, black) should come out neutral
    ab = np.array([base[1:] for base, _ in raw.values()]) - 128
    neutral = ab[np.linalg.norm(ab, axis=1) < 22]
    cast = np.median(neutral, 0) if len(neutral) > 10 else np.zeros(2)
    print("colour cast (a, b):", cast.round(1), "from", len(neutral), "neutral spines")
    colors = {k: (to_hex(base, cast, True), to_hex(ink, cast)) for k, (base, ink) in raw.items()}
    scene = {"W": W, "H": H, "board": BOARD, "floor": FLOOR,
             "cols": [{"id": k, "x0": a, "x1": b} for k, (a, b) in COLS.items()],
             "comps": compartments(books), "colors": colors}
    js = "window.SCENE = " + json.dumps(scene, separators=(",", ":")) + ";\n"
    (ROOT / "docs" / "scene.js").write_text(js, encoding="utf-8")
    print("wrote scene.js", len(colors), "colours", len(scene["comps"]), "compartments")


if __name__ == "__main__":
    main()
