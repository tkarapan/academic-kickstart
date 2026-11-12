#!/usr/bin/env python3
"""Fill in missing abstracts on publication pages.

For pages whose front matter has `abstract = ""` and a DOI, the abstract is
taken from Europe PMC, or from Crossref when Europe PMC has none. Existing
abstracts are never changed.

Uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_publications import clean_abstract, crossref_record, get_json  # noqa: E402

EUROPE_PMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"


def tidy(text: str) -> str:
    text = re.sub(r"<(h\d|b|strong)[^>]*>.*?</\1>", " ", text, flags=re.S | re.I)  # section labels
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def from_europe_pmc(doi: str) -> str:
    query = urllib.parse.urlencode({"query": f'DOI:"{doi}"', "format": "json", "resultType": "core"})
    results = get_json(f"{EUROPE_PMC}?{query}").get("resultList", {}).get("result", [])
    return tidy(results[0].get("abstractText", "")) if results else ""


def from_crossref(doi: str) -> str:
    return clean_abstract(crossref_record(doi).get("abstract", ""))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content", default="content/publication", type=Path)
    args = parser.parse_args()
    filled = 0
    for index in sorted(args.content.glob("*/index.md")):
        text = index.read_text(encoding="utf-8")
        if not re.search(r'^abstract\s*=\s*""\s*$', text, re.M):
            continue
        doi = re.search(r'^doi\s*=\s*"([^"]+)"', text, re.M)
        if not doi:
            continue
        abstract = ""
        for source in (from_europe_pmc, from_crossref):
            try:
                abstract = source(doi.group(1))
            except Exception as error:  # noqa: BLE001 - try the next source
                print(f"{index.parent.name}: {source.__name__} failed ({error})", file=sys.stderr)
            if len(abstract) > 100:
                break
            abstract = ""
        if abstract:
            text = re.sub(r'^abstract\s*=\s*""\s*$', lambda _: f"abstract = {json.dumps(abstract, ensure_ascii=False)}", text, count=1, flags=re.M)
            index.write_text(text, encoding="utf-8")
            filled += 1
            print(f"{index.parent.name}: abstract added", file=sys.stderr)
        time.sleep(0.5)
    print(filled)
    return 0


if __name__ == "__main__":
    sys.exit(main())
