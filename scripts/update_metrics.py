#!/usr/bin/env python3
"""Update data/metrics.json with citation totals from Crossref.

Sums Crossref's "is-referenced-by-count" over every publication on the
site that has a DOI, and derives an h-index from the same counts.
Crossref counts citations between works it indexes, so totals are lower
than Google Scholar's.

The file is only rewritten when a value changes. If Crossref cannot be
reached for every publication, the existing file is left untouched so
that totals never drop because of a failed lookup.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_publications import get_json  # noqa: E402


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    out = root / "data" / "metrics.json"
    dois = []
    for index in sorted((root / "content" / "publication").glob("*/index.md")):
        if m := re.search(r'^doi\s*=\s*"([^"]+)"', index.read_text(encoding="utf-8"), re.M):
            dois.append(m.group(1))

    counts, failed = [], 0
    for doi in dois:
        try:
            record = get_json(f"https://api.crossref.org/works/{urllib.parse.quote(doi, safe='/')}")["message"]
            counts.append(int(record.get("is-referenced-by-count", 0)))
        except Exception as error:  # noqa: BLE001
            print(f"{doi}: skipped ({error})", file=sys.stderr)
            failed += 1
        time.sleep(2)

    if not dois or failed:
        print("Some lookups failed; metrics not updated.", file=sys.stderr)
        return 0

    ranked = sorted(counts, reverse=True)
    metrics = {
        "citations": sum(ranked),
        "h_index": sum(1 for i, c in enumerate(ranked) if c >= i + 1),
        "source": "Crossref",
    }
    previous = json.loads(out.read_text()) if out.exists() else {}
    if {k: previous.get(k) for k in metrics} == metrics:
        print("Metrics unchanged.", file=sys.stderr)
        return 0
    metrics["updated"] = date.today().isoformat()
    out.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(f"Updated: {metrics}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
