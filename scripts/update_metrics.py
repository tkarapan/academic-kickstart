#!/usr/bin/env python3
"""Update data/metrics.json with citation figures from Google Scholar.

Reads the public Google Scholar profile once and extracts total citations
and h-index from the profile's summary table. Google Scholar has no API
and sometimes refuses automated requests; in that case, or if the page
cannot be parsed, the existing file is left unchanged. Values are also
left unchanged if they would drop sharply, which usually indicates a
parsing problem rather than a real change.

The "updated" date records the last successful check, so the file is
rewritten on every successful run. The figures can be edited by hand in
data/metrics.json at any time.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

PROFILE = "https://scholar.google.com/citations?user=-96i0ikAAAAJ&hl=en"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept-Language": "en-GB,en;q=0.9",
}


def fetch_profile() -> tuple[int, int]:
    request = urllib.request.Request(PROFILE, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        page = response.read().decode("utf-8", "replace")
    # Summary table cells, in order: citations (all, recent), h-index (all, recent), i10 (all, recent).
    cells = re.findall(r'class="gsc_rsb_std">(\d+)<', page)
    if len(cells) < 4:
        raise ValueError("citation table not found (request may have been blocked)")
    return int(cells[0]), int(cells[2])


def main() -> int:
    out = Path(__file__).resolve().parent.parent / "data" / "metrics.json"
    previous = json.loads(out.read_text()) if out.exists() else {}
    try:
        citations, h_index = fetch_profile()
    except Exception as error:  # noqa: BLE001
        print(f"Google Scholar unavailable ({error}); metrics not updated.", file=sys.stderr)
        return 0

    if not (0 < h_index < 300 and citations >= h_index):
        print(f"Implausible values ({citations}, {h_index}); metrics not updated.", file=sys.stderr)
        return 0
    if previous.get("citations") and citations < 0.9 * previous["citations"]:
        print("Citations dropped by more than 10%; metrics not updated.", file=sys.stderr)
        return 0

    metrics = {"citations": citations, "h_index": h_index, "source": "Google Scholar", "updated": date.today().isoformat()}
    out.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(f"Updated: {metrics}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
