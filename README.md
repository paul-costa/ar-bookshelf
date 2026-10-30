# AR Bookshelf

An interactive bookshelf in two zones you walk between like a side-scroller:

1. **Analog** – the real shelf, redrawn from the panorama (same compartments, every book in its place, spine colours sampled from the photo). The photo can be faded in on top (`F` / "Foto").
2. **Digital** – the Kindle library (Kindle books, personal documents, audiobooks) in a shelf of light with the same 22 compartments, sorted the way the real shelf is sorted: the same authors and series land in the same compartment, the rest by genre (classics left, non-fiction in M5, fantasy and romantasy in the middle and right).

Hovering over a book (or tapping it on mobile) highlights it AR-style and opens an info card with a leader line to the book: title, author, cover, Goodreads rating, links to Goodreads and Amazon. Books that exist in both shelves link to each other.

Live: https://ar-bookshelf.costapaul.com (Cloudflare Pages, static, no build step, output directory `docs/`)

## Structure

| Path | Contents |
| --- | --- |
| `output/` | Stitched, rectified panorama plus the stitching pipeline |
| `data/kindle/library.json` | Kindle library (title, series, author, kind, read/sample), from `tools/parse_kindle.py`; `goodreads.json` caches the lookups |
| `data/books/<Fach>.json` | One file per shelf compartment (L1–L4, M1–M6, C1–C6, R1–R6): polygon in panorama pixels, title, author, recognition confidence, Goodreads match |
| `docs/` | The website (`index.html`, `app.js`, `app.css`, generated `books.js`, `scene.js`, `digital.js`, `covers/`, `img/`) |
| `tools/build_data.py` | Builds `docs/books.js` from `data/books` and downloads missing covers (Goodreads → Open Library → Google Books) |
| `tools/build_scene.py` | Compartment boxes and spine colours (k-means over each book polygon) → `docs/scene.js` |
| `tools/parse_kindle.py` | Kindle export (Markdown tables from "Meine Inhalte und Geräte") → `data/kindle/library.json` |
| `tools/build_digital.py` | Sorts the Kindle library into the compartments, looks it up on Goodreads, fetches covers → `docs/digital.js` |
| `tools/crop.py`, `tools/draw.py` | Panorama crop with coordinate grid / polygon overlay for checking |
| `tools/gr.sh` | Goodreads quick lookup (`tools/gr.sh "title author"`) |

## Updating the data

```bash
pip install pillow numpy opencv-python
python tools/build_data.py            # writes docs/books.js and missing docs/covers/gr-<id>.webp
python tools/build_scene.py           # writes docs/scene.js (drawn shelf)
python tools/parse_kindle.py <export.md>
python tools/build_digital.py         # writes docs/digital.js
python -m http.server 8417 --directory docs
```

Covers are cached by Goodreads ID; already existing covers are not downloaded again.

## Usage

- Walk: hold `←` `→` (or `A` `D`), `Shift` runs, `↑` `↓` when zoomed in; `1` / `2` jump to a shelf; the arrow buttons at the screen edge and the track at the bottom do the same
- Mouse: hover = info, click = pin the card, scroll = zoom, sideways trackpad swipe = walk, drag = pan, `F` = photo, `/` = search, `Esc` = close, `0` = whole shelf
- Touch: tap = info, pinch = zoom, swipe = walk
- Search for title/author: matches are outlined, `Enter` flies to the first match
