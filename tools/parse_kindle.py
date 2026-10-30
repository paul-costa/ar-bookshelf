"""Parse the Kindle library export (Markdown tables) into data/kindle/library.json.

usage: python tools/parse_kindle.py data/kindle/<export>.md
Keeps only what the site shows: title, series, author, kind (kindle/doc/audio), read and sample flags."""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def rows(md, heading):
    sec = md.split(f"## {heading}", 1)[1].split("\n## ", 1)[0]
    for line in sec.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) > 2 and cells[0].isdigit():
            yield cells


def split_series(title):
    """'Lucca (Made Men Book 4)' -> ('Lucca', 'Made Men #4')"""
    m = re.match(r"^(.*?)\s*\(([^()]*)\)\s*(?:–.*)?$", title)
    if not m:
        return title, None
    base, inner = m.group(1).strip(), m.group(2).strip()
    if re.search(r"edition|insel taschenbuch|amazonclassics|b&n", inner, re.I):
        return base, None
    n = re.search(r"(?:Book|Saga…|)\s*(\d+)\s*$", inner)
    name = re.sub(r"\s*(?:Book\s*)?\d+\s*$", "", inner).strip(" ,…")
    return base, f"{name} #{n.group(1)}" if n and name else (name or None)


def key(title, author):
    t = re.sub(r"[^a-z0-9 ]", "", title.lower().replace("&", "and"))
    t = re.sub(r"^(the|a|an) ", "", t).strip()
    a = re.sub(r"[^a-z]", "", (author or "").split(",")[0].split("&")[0].strip().split(" ")[-1].lower())
    return f"{t}|{a}"


def main(src):
    md = Path(src).read_text(encoding="utf-8")
    items = {}

    def add(title, author, kind, status=""):
        if "…" in title:  # Amazon cut the title: drop the partial subtitle
            title = re.sub(r":[^:]*$", "", title.replace("…", "")).strip()
        title = re.sub(r":\s*(A Novel.*|A Confession|A Love Story)$", "", title).strip()
        title = re.sub(r"^.*Saga \d+:\s*", "", title)
        base, series = split_series(title)
        base = re.sub(r"\s*\((?:[^)]*)$", "", base).strip()  # Amazon-truncated "(The Folk of t"
        k = key(base, author)
        it = items.get(k)
        if not it:
            it = items[k] = {"title": base, "author": author, "series": series, "kinds": [], "read": False, "sample": False, "_full": False}
        if kind not in it["kinds"]:
            it["kinds"].append(kind)
        it["series"] = it["series"] or series
        it["read"] |= "read" in status
        it["_full"] |= "sample" not in status
        it["sample"] = not it["_full"]

    for _, title, author, _, status in rows(md, "Kindle books"):
        add(title, author.split(",")[0].strip() if "Shulgin" in author else author, "kindle", status)
    for _, title, _meta, _, _, status in rows(md, "Documents / PDFs"):
        t, _, a = title.rpartition(" – ")
        add(t or title, a.strip() or None, "doc", status)
    for _, title, author, _ in rows(md, "Audiobooks"):
        add(title, author, "audio")

    out = [{k: v for k, v in i.items() if k != "_full"} for i in items.values()]
    (ROOT / "data" / "kindle" / "library.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(out), "items", {k: sum(k in i["kinds"] for i in out) for k in ("kindle", "doc", "audio")},
          "multi", sum(len(i["kinds"]) > 1 for i in out))


if __name__ == "__main__":
    main(sys.argv[1])
