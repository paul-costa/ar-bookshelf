"""Merge annotated compartments into docs/books.js and fetch cover thumbnails.

usage: python tools/build_data.py [BOOKS_DIR]
BOOKS_DIR (default: data/books) holds one <compartment>.json per shelf compartment (see README)."""
import io, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
COVERS = DOCS / "covers"
UA = {"User-Agent": "Mozilla/5.0 (ar-bookshelf)"}
ORDER = ["L1", "L2", "L3", "L4", "M1", "M2", "M3", "M4", "M5", "M6",
         "C1", "C2", "C3", "C4", "C5", "C6", "R1", "R2", "R3", "R4", "R5", "R6"]


def get(url, raw=False, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                data = r.read()
                return data if raw else json.loads(data)
        except Exception:
            time.sleep(1.5 * (i + 1))
    return None


def gr_id(url):
    m = re.search(r"/show/(\d+)", url or "")
    return m.group(1) if m else None


def gr_lookup(b):
    """Return the Goodreads autocomplete entry for the book's chosen url (or a same-title entry with a cover)."""
    g = b["goodreads"]
    want = gr_id(g["url"])
    bare = re.split(r"[:(]", g["title"])[0].strip()
    surname = g["author"].split(",")[0].split()[-1]
    slug = re.sub(r"^\d+[-.]?", "", g["url"].rstrip("/").split("/")[-1]).replace("_", " ").replace("-", " ")
    seen = []
    for q in (f'{g["title"]} {g["author"]}', f"{bare} {surname}", bare, f"{slug} {surname}"):
        res = get("https://www.goodreads.com/book/auto_complete?format=json&q=" + urllib.parse.quote(q)) or []
        for e in res:
            if e.get("bookId") == want and "nophoto" not in e.get("imageUrl", ""):
                return e
        seen += res
        time.sleep(0.3)
    key = bare.lower()
    for e in seen:
        if e.get("bookTitleBare", "").lower().startswith(key) and "nophoto" not in e.get("imageUrl", "") \
                and surname.lower() in e.get("author", {}).get("name", "").lower():
            return e
    return None


def big_cover(url):
    if not url or "nophoto" in url:
        return None
    return re.sub(r"\._S[XY]\d+_", "", url)


def fallback_cover(title, author):
    """Open Library, then Google Books, searched with the bare title (no subtitle/series)."""
    title = re.split(r"[:(]", title)[0].strip()
    author = (author or "").split(",")[0].strip()
    q = urllib.parse.urlencode({"title": title, "author": author, "limit": 5, "fields": "cover_i"})
    for d in (get("https://openlibrary.org/search.json?" + q) or {}).get("docs", []):
        if d.get("cover_i"):
            return f'https://covers.openlibrary.org/b/id/{d["cover_i"]}-L.jpg'
    q = urllib.parse.quote(f'intitle:"{title}" inauthor:{author.split()[-1] if author else ""}')
    for v in (get(f"https://www.googleapis.com/books/v1/volumes?q={q}&maxResults=5") or {}).get("items", []):
        img = v.get("volumeInfo", {}).get("imageLinks", {}).get("thumbnail")
        if img:
            return img.replace("http://", "https://").replace("&edge=curl", "").replace("zoom=1", "zoom=2")
    return None


def save_cover(src, dest):
    data = get(src, raw=True)
    if not data or len(data) < 1500:  # Open Library returns a 1x1 gif for missing covers
        return False
    im = Image.open(io.BytesIO(data)).convert("RGB")
    im.thumbnail((240, 360), Image.LANCZOS)
    im.save(dest, quality=80, method=6)
    return True


def main(books_dir):
    COVERS.mkdir(parents=True, exist_ok=True)
    books = []
    for c in ORDER:
        f = Path(books_dir) / f"{c}.json"
        if f.exists():
            books += json.load(open(f))
    out = []
    for i, b in enumerate(books):
        g = b.get("goodreads") or None
        rec = {
            "id": b["id"], "poly": b["poly"],
            "title": b.get("title") or "", "author": b.get("author") or "",
            "series": b.get("series"), "lang": b.get("language"),
            "conf": b.get("confidence", "unknown"),
        }
        if g and g.get("url"):
            rec.update(rating=float(g.get("rating") or 0), ratings=int(g.get("ratings_count") or 0),
                       gr=g["url"].split("?")[0], grTitle=g.get("title"))
        if rec["title"] and rec["conf"] != "unknown":
            q = f'{rec["title"]} {rec["author"].split(",")[0]}'.strip()
            rec["amazon"] = "https://www.amazon.de/s?" + urllib.parse.urlencode({"k": q, "i": "stripbooks"})
        dest = COVERS / f'gr-{gr_id(g["url"])}.webp' if g and gr_id(g.get("url")) else None
        if dest and dest.exists():
            rec["cover"] = f"covers/{dest.name}"
        elif dest:
            e = gr_lookup(b)
            src = big_cover(e and e.get("imageUrl")) or fallback_cover(g.get("title") or rec["title"], g.get("author") or rec["author"])
            if src and save_cover(src, dest):
                rec["cover"] = f"covers/{dest.name}"
        out.append(rec)
        print(f'{i+1}/{len(books)} {b["id"]} {rec["title"][:40]!r} cover={"cover" in rec}', flush=True)
    js = "window.BOOKS = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (DOCS / "books.js").write_text(js, encoding="utf-8")
    print("wrote", len(out), "books")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / "data" / "books")
