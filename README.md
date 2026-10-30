# AR Bookshelf

An interactive panorama of the bookshelf: hovering over a book (or tapping it on mobile) highlights it AR-style and opens an info card with a leader line to the book. The card shows the title, author, cover, Goodreads rating, and links to Goodreads and Amazon.

Live: https://ar-bookshelf.costapaul.com (Cloudflare Pages, static, no build step, output directory `docs/`)

## Structure

| Path | Contents |
| --- | --- |
| `output/` | Stitched, rectified panorama plus the stitching pipeline |
| `data/books/<Fach>.json` | One file per shelf compartment (L1–L4, M1–M6, C1–C6, R1–R6): polygon in panorama pixels, title, author, recognition confidence, Goodreads match |
| `docs/` | The website (`index.html`, `app.js`, `app.css`, generated `books.js`, `covers/`, `img/`) |
| `tools/build_data.py` | Builds `docs/books.js` from `data/books` and downloads missing covers (Goodreads → Open Library → Google Books) |
| `tools/crop.py`, `tools/draw.py` | Panorama crop with coordinate grid / polygon overlay for checking |
| `tools/gr.sh` | Goodreads quick lookup (`tools/gr.sh "title author"`) |

## Updating the data

```bash
pip install pillow
python tools/build_data.py            # writes docs/books.js and missing docs/covers/gr-<id>.webp
python -m http.server 8417 --directory docs
```

Covers are cached by Goodreads ID; already existing covers are not downloaded again.

## Usage

- Mouse: hover = info, click = pin the card, scroll = zoom, drag = pan, `/` = search, `Esc` = close, `0` = whole shelf
- Touch: tap = info, pinch = zoom, drag = pan
- Search for title/author: matches are outlined, `Enter` flies to the first match
