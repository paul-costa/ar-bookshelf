"""Build the digital shelf: sort the Kindle library into the 22 compartments the way the real shelf is sorted,
look every title up on Goodreads, fetch covers and lay the spines out.

usage: python tools/build_digital.py          (after tools/parse_kindle.py and tools/build_scene.py)
Writes docs/digital.js (window.DIGITAL) and caches Goodreads hits in data/kindle/goodreads.json."""
import io, json, re, sys, time, urllib.parse
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import COVERS, big_cover, fallback_cover, get, save_cover  # noqa: E402
from build_scene import ORDER, W, compartments, load_books  # noqa: E402
from parse_kindle import key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "data" / "kindle" / "library.json"
CACHE = ROOT / "data" / "kindle" / "goodreads.json"
GAP = 1500            # corridor between the real shelf and the digital one
X0 = W + GAP          # world x of the digital shelf

# Where each kind of book lives on the real shelf (first compartment with room wins).
GENRES = {
    "romantasy": ["C2", "C1", "C3", "R1", "R2", "R3", "M2", "C6", "R6", "M6", "M4", "C4"],
    "dark": ["C5", "L4", "C3", "C6", "R6"],
    "romance": ["C5", "L4", "M4", "C4"],
    "fantasy": ["C1", "M3", "R2", "M2", "R1", "C6", "M4"],
    "ya": ["M3", "R1", "R5", "M4"],
    "dystopia": ["L3", "R5", "C5", "L1"],
    "scifi": ["L1", "L3", "C5"],
    "gothic": ["R4", "L4", "C3"],
    "litfic": ["C4", "C2", "R4"],
    "classic": ["L2", "M1", "L1"],
    "classic_de": ["L3", "L2"],
    "nonfic": ["M5", "L1"],
    "thriller": ["R5", "C2"],
}
AUTHOR_GENRE = {
    "romantasy": "Abigail Owen, Alex Aster, Alexis L. Menard, Alexis Menard, Alisha Klapheke, Allie Cole, Amber V. Nicole, "
                 "Briar Boleyn, C.N. Crawford, Carissa Broadbent, Caroline Peckham, Caty Rogan, Clare Sager, Dani Francis, "
                 "Danielle L. Jensen, Elizabeth May, Hannah Whitten, Helen Scheuerer, Ingrid Seymour, J. G. Gates, "
                 "Jaclyn Rodriguez, Jasmine Mas, Kate Golden, Kaylie Smith, Kristen Ciccarelli, L. K. Steven, LJ Andrews, "
                 "LJ Claren, Laura Thalassa, Lexi Ryan, Lisette Marshall, Madeline Taylor, Marion Blackwood, Melissa Roehrich, "
                 "N.E. Davenport, Nina Frost, Nisha J Tuli, Rosa Heart, S. F. Williamson, S.C. Muir, S.M. Gaither, "
                 "Sariah Wilson, Sasha Peyton Smith, Shannon J. Spann, Stacey McEwan, Tiffany Hunt, Ever King, Devney Perry, "
                 "Lauren Loscig, Edith Birde, F. A. Davidson, Callie Hart, Geneva Lee, Olivia Atwater, Heather Fawcett",
    "dark": "Danielle Lori, Sarah Brianne, H. D. Carlton, K. M. Moronova, K.M. Moronova, Liv Zander, Keri Lake, Nikki St. Crowe, "
            "T.S. Kinley, Scarlett St. Clair, H. M. Wolfe, Harper L. Woods, Alice Wilde",
    "romance": "Hannah Grace, Casey McQuiston, Lauren Asher, Rachel Reid",
    "fantasy": "M. A. Carrick, Scott Lynch, Christopher Buehlman, Antonia Hodgson, Fonda Lee, Nghi Vo, Shen Tao, "
               "Samantha Sotto Yambao, Jessica Cluess, Anna Mazzola",
    "ya": "Emily A. Duncan, Lynette Noni, Mary E. Pearson, Renée Ahdieh, Soman Chainani, Chloe Gong, Lauren Roberts, "
          "Faridah Abike-Iyimide, A. B. Poranek",
    "dystopia": "Lois Lowry, Tahereh Mafi",
    "scifi": "Orson Scott Card, Pierce Brown, John Scalzi, Tamsyn Muir",
    "gothic": "Alexis Henderson, Erin A. Craig, Ava Reid",
    "litfic": "Maggie O'Farrell, Claire Keegan, Matt Haig, Micah Nemerever, Alan Bennett",
    "classic": "Homer",
    "classic_de": "Rainer Maria Rilke",
    "nonfic": "Darren Hardy, Carl L. Hart, Simon Sinek, Walter Isaacson, James Clear, Adam Grant, Gary Stevenson",
}
AUTHOR_GENRE = {re.sub(r"[^a-z]", "", a.lower()): g for g, names in AUTHOR_GENRE.items() for a in names.split(", ")}
# series whose author is split over several compartments on the real shelf
SERIES_COMP = {"ACOTAR": "M2", "A Court of Splintered Harmony": "M2", "Crescent City": "R2", "Twisted": "L4",
               "Blood and Ash": "R3", "Shadow and Bone": "C3"}

MIN_SPINE, MAX_SPINE, PAD = 34, 78, 26
CAP_SPINE = 52        # average spine width a compartment is filled up to before books spill over


def author_key(a):
    return re.sub(r"[^a-z]", "", (a or "").split(",")[0].split("&")[0].lower())


def surname(a):
    return re.sub(r"[^a-z]", "", (a or "").split(",")[0].split("&")[0].strip().split(" ")[-1].lower())


def gr_find(it):
    """First Goodreads autocomplete hit whose author matches; prefers entries with a cover."""
    sn = surname(it["author"])
    t = re.sub(r"[^a-z0-9 ]", "", it["title"].lower())
    hits = []
    for q in (f'{it["title"]} {it["author"] or ""}', f'{it["title"]} {sn}', it["title"]):
        res = get("https://www.goodreads.com/book/auto_complete?format=json&q=" + urllib.parse.quote(q.strip())) or []
        time.sleep(0.25)
        for e in res:
            name = re.sub(r"[^a-z]", "", e.get("author", {}).get("name", "").lower())
            bare = re.sub(r"[^a-z0-9 ]", "", e.get("bookTitleBare", "").lower())
            if (not sn or sn in name) and (bare.startswith(t[:18]) or t.startswith(bare[:18])):
                hits.append(e)
        if hits:
            break
    if not hits:
        return None
    hits.sort(key=lambda e: ("nophoto" in e.get("imageUrl", ""), -(e.get("ratingsCount") or 0)))
    e = hits[0]
    return {"bookId": e["bookId"], "title": e.get("bookTitleBare"), "rating": float(e.get("avgRating") or 0),
            "ratings": int(e.get("ratingsCount") or 0), "pages": e.get("numPages"),
            "url": "https://www.goodreads.com" + e["bookUrl"].split("?")[0], "image": e.get("imageUrl")}


def accent(path):
    """A vivid, mid-bright colour from the cover for the glowing spine."""
    im = Image.open(path).convert("RGB").resize((40, 60))
    a = np.asarray(im, np.float32).reshape(-1, 3) / 255
    mx, mn = a.max(1), a.min(1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    score = sat * (0.35 + mx) * (mx > 0.18)
    top = a[np.argsort(score)[-int(len(a) * 0.15):]]
    c = np.median(top, 0)
    if (c.max() - c.min()) < 0.12:          # grey cover: fall back to a cool tint
        return None
    c = c / max(c.max(), 1e-3) * 0.95       # normalise brightness, keep hue
    return "#%02x%02x%02x" % tuple(int(v * 255) for v in c)


def assign(lib, phys):
    """Compartment per item, keeping authors/series together like the real shelf."""
    twin, auth = {}, {}
    for c in ORDER:
        for b in phys[c]:
            if b.get("title") and b.get("confidence") != "unknown":
                twin.setdefault(key(b["title"], b.get("author")), b["id"])
                a = author_key(b.get("author"))
                auth.setdefault(a, {}).setdefault(c, 0)
                auth[a][c] += 1
    comps = {c["id"]: c for c in compartments(phys)}
    cap = {c: int((comps[c]["w"] - 2 * PAD) // CAP_SPINE) for c in ORDER}
    load = {c: 0 for c in ORDER}
    for it in lib:
        k = key(it["title"], it["author"])
        prefs = []
        if k in twin:
            it["twin"] = twin[k]
            prefs.append(twin[k][:2])
        for s, c in SERIES_COMP.items():
            if s.lower() in f'{it.get("series") or ""} {it["title"]}'.lower():
                prefs.append(c)
        a = author_key(it["author"])
        if a in auth:
            prefs += sorted(auth[a], key=lambda c: -auth[a][c])
        g = AUTHOR_GENRE.get(a) or AUTHOR_GENRE.get(re.sub(r"[^a-z]", "", (it["author"] or "").lower()))
        prefs += GENRES.get(g or ("nonfic" if "audio" in it["kinds"] else "romantasy"))
        it["_prefs"] = list(dict.fromkeys(prefs))
    # author groups, biggest and best-anchored first, so series land in one compartment
    groups = {}
    for it in lib:
        groups.setdefault(author_key(it["author"]), []).append(it)
    for grp in sorted(groups.values(), key=lambda g: (not any("twin" in i for i in g), -len(g))):
        for it in grp:
            first = next((c for c in it["_prefs"] if load[c] < cap[c]), None) or min(ORDER, key=lambda c: load[c] / cap[c])
            it["comp"] = first
            load[first] += 1
    return comps, load


def series_no(it):
    m = re.search(r"#(\d+)", it.get("series") or "")
    return int(m.group(1)) if m else 0


def layout(lib, comps):
    out = []
    for c in ORDER:
        items = [i for i in lib if i["comp"] == c]
        # like the real shelf: author/series blocks, series in reading order
        items.sort(key=lambda i: (i["_prefs"].index(c) if c in i["_prefs"] else 9, author_key(i["author"]),
                                  re.sub(r"\s*#\d+", "", i.get("series") or i["title"]), series_no(i), i["title"]))
        box = comps[c]
        if not items:
            continue
        want = [min(MAX_SPINE, max(46, (i.get("pages") or 380) / 7.5)) for i in items]
        avail = box["w"] - 2 * PAD - 6 * (len(items) - 1)
        k = min(1.0, avail / sum(want))
        x = X0 + box["x"] + PAD
        floor = box["y"] + box["h"]
        for n, (i, w) in enumerate(zip(items, want)):
            w = max(MIN_SPINE - 6, w * k)
            frac = {"audio": 0.56, "doc": 0.74}.get(i["kinds"][0], 0.84)
            if "kindle" in i["kinds"]:
                frac = 0.84
            h = box["h"] * (frac - 0.04 * ((n * 7) % 3) / 2)
            poly = [[round(x), round(floor - h)], [round(x + w), round(floor - h)], [round(x + w), floor], [round(x), floor]]
            i["id"] = f"D{c}-{n + 1:02d}"
            i["poly"] = poly
            x += w + 6
            out.append(i)
    return out


def main():
    lib = json.load(open(LIB))
    cache = json.load(open(CACHE)) if CACHE.exists() else {}
    COVERS.mkdir(parents=True, exist_ok=True)
    for n, it in enumerate(lib):
        k = key(it["title"], it["author"])
        if k not in cache:
            cache[k] = gr_find(it)
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        g = cache[k]
        if g:
            it.update(rating=g["rating"], ratings=g["ratings"], gr=g["url"], grTitle=g["title"], pages=g.get("pages"))
            dest = COVERS / f'gr-{g["bookId"]}.webp'
            if not dest.exists():
                src = big_cover(g.get("image")) or fallback_cover(it["title"], it["author"])
                if src:
                    save_cover(src, dest)
            if dest.exists():
                it["cover"] = f"covers/{dest.name}"
                it["color"] = accent(dest)
        print(f'{n + 1}/{len(lib)} {it["title"][:40]!r} gr={bool(g)} cover={"cover" in it}', flush=True)

    phys = load_books()
    comps, load = assign(lib, phys)
    print("load", load)
    items = layout(lib, comps)
    out = []
    for it in items:
        kind = "audio" if "audio" in it["kinds"] else "kindle" if "kindle" in it["kinds"] else "doc"
        q = f'{it["title"]} {(it["author"] or "").split(",")[0]}'.strip()
        rec = {"id": it["id"], "poly": it["poly"], "title": it["title"], "author": it["author"] or "",
               "series": it.get("series"), "kinds": it["kinds"], "read": it["read"], "sample": it["sample"],
               "amazon": "https://www.amazon.de/s?" + urllib.parse.urlencode({"k": q, "i": "audible" if kind == "audio" else "digital-text"})}
        for f in ("rating", "ratings", "gr", "grTitle", "cover", "color", "twin"):
            if it.get(f):
                rec[f] = it[f]
        out.append(rec)
    meta = {"x0": X0, "gap": GAP, "counts": {k: sum(k in i["kinds"] for i in lib) for k in ("kindle", "doc", "audio")}}
    js = ("window.DIGITAL = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
          "window.DIGITAL_META = " + json.dumps(meta) + ";\n")
    (ROOT / "docs" / "digital.js").write_text(js, encoding="utf-8")
    print("wrote", len(out), "digital items")


if __name__ == "__main__":
    main()
