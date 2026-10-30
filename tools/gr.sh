#!/bin/bash
# Goodreads lookup: gr.sh "title author" -> top 5 matches (title | author | rating | count | url)
q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1")
curl -s -A "Mozilla/5.0" "https://www.goodreads.com/book/auto_complete?format=json&q=$q" | python3 -c "
import json,sys
for b in json.load(sys.stdin)[:5]:
    print(f\"{b['title']} | {b['author']['name']} | {b['avgRating']} | {b['ratingsCount']} | https://www.goodreads.com{b['bookUrl'].split('?')[0]}\")"
