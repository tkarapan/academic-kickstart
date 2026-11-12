#!/usr/bin/env python3
"""Add a representative figure to publications that do not have one.

For each publication page without a featured image, the paper is looked up
in the PubMed Central Open Access dataset (public bucket
s3://pmc-oa-opendata). If the article carries a Creative Commons licence,
its graphical abstract (or otherwise Figure 1) is saved as featured.jpg in
the page bundle, and a `figure_credit` line is added to index.md.

Pages can opt out with `figure = false` in their front matter, and any
figure can be replaced by hand by overwriting featured.jpg/featured.png.

Uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_publications import USER_AGENT, get_json  # noqa: E402

import urllib.request  # noqa: E402

BUCKET = "https://pmc-oa-opendata.s3.amazonaws.com"
EUROPE_PMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def pmcid_for(doi: str) -> str | None:
    query = urllib.parse.urlencode({"query": f'DOI:"{doi}"', "format": "json", "resultType": "lite"})
    results = get_json(f"{EUROPE_PMC}?{query}").get("resultList", {}).get("result", [])
    return results[0].get("pmcid") if results else None


def latest_version(pmcid: str) -> tuple[str, list[str]] | None:
    listing = fetch(f"{BUCKET}/?list-type=2&prefix={pmcid}.&max-keys=1000").decode()
    keys = re.findall(r"<Key>([^<]+)</Key>", listing)
    versions = sorted({k.split("/")[0] for k in keys}, key=lambda v: int(v.split(".")[-1]))
    if not versions:
        return None
    folder = versions[-1]
    return folder, [k.split("/", 1)[1] for k in keys if k.startswith(folder + "/")]


def choose_figure(xml: str) -> tuple[str, str] | None:
    """Return (graphic file stem, label) for the graphical abstract or the first figure."""
    graphical = re.search(r'<abstract[^>]*abstract-type="graphical".*?</abstract>', xml, re.S)
    if graphical and (href := re.search(r'xlink:href="([^"]+)"', graphical.group(0))):
        return href.group(1), "Graphical abstract"
    for fig in re.findall(r"<fig\b.*?</fig>", xml, re.S):
        href = re.search(r'<graphic[^>]*xlink:href="([^"]+)"', fig)
        label = re.search(r"<label>(.*?)</label>", fig)
        label_text = re.sub(r"<[^>]+>", "", label.group(1)).strip() if label else ""
        if not href or re.match(r"(?i)(table|scheme|box)", label_text):
            continue
        number = re.search(r"\d+", label_text)
        return href.group(1), f"Figure {number.group(0) if number else 1}"
    return None


def short_citation(index_text: str) -> str:
    authors = re.search(r"^authors\s*=\s*\[(.*?)\]", index_text, re.M)
    names = re.findall(r'"([^"]+)"', authors.group(1)) if authors else []
    first = names[0] if names else ""
    first = "Karapanagiotidis" if first == "admin" else first.split()[-1]
    year = re.search(r"^date\s*=\s*(\d{4})", index_text, re.M).group(1)
    venue = re.search(r'^publication\s*=\s*"\*?(.*?)\*?"', index_text, re.M)
    etal = " et al." if len(names) > 2 else (f" & {names[1].split()[-1] if names[1] != 'admin' else 'Karapanagiotidis'}" if len(names) == 2 else "")
    return f"{first}{etal} ({year}){', ' + venue.group(1) if venue and venue.group(1) else ''}"


def process(folder: Path) -> str | None:
    index = folder / "index.md"
    text = index.read_text(encoding="utf-8")
    if list(folder.glob("featured.*")) or re.search(r"^figure\s*=\s*false", text, re.M):
        return None
    doi = re.search(r'^doi\s*=\s*"([^"]+)"', text, re.M)
    if not doi:
        return None
    pmcid = pmcid_for(doi.group(1))
    if not pmcid:
        return None
    found = latest_version(pmcid)
    if not found:
        return None
    version, files = found
    meta = json.loads(fetch(f"{BUCKET}/{version}/{version}.json"))
    licence = (meta.get("license_code") or "").strip()
    if meta.get("is_retracted") or not licence.upper().startswith("CC"):
        return None
    choice = choose_figure(fetch(f"{BUCKET}/{version}/{version}.xml").decode("utf-8", "replace"))
    if not choice:
        return None
    stem, label = choice
    image = next((f for f in files if f == stem or f.rsplit(".", 1)[0] == stem.rsplit(".", 1)[0]), None)
    if not image or not image.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        return None
    data = fetch(f"{BUCKET}/{version}/{urllib.parse.quote(image)}")
    ext = {"png": ".png", "webp": ".webp"}.get(image.lower().rsplit(".", 1)[-1], ".jpg")
    (folder / f"featured{ext}").write_bytes(data)
    credit = f"{label} from {short_citation(text)}. {licence}."
    text = re.sub(r'^(doi\s*=\s*".*"\n)', lambda m: m.group(1) + f"figure_credit = {json.dumps(credit, ensure_ascii=False)}\n", text, count=1, flags=re.M)
    index.write_text(text, encoding="utf-8")
    return credit


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content", default="content/publication", type=Path)
    parser.add_argument("--only", nargs="*", help="limit to these page folder names")
    parser.add_argument("--summary", type=Path, help="append a Markdown list of added figures here")
    parser.add_argument("--declined", type=Path, help="file listing page folder names whose figures were declined")
    args = parser.parse_args()
    added = 0
    lines = []
    declined = set(args.declined.read_text().split()) if args.declined and args.declined.exists() else set()
    for folder in sorted(p for p in args.content.iterdir() if p.is_dir()):
        if (args.only and folder.name not in args.only) or folder.name in declined:
            continue
        try:
            credit = process(folder)
        except Exception as error:  # noqa: BLE001 - one failure must not stop the rest
            print(f"{folder.name}: skipped ({error})", file=sys.stderr)
            continue
        if credit:
            added += 1
            lines.append(f"- `content/publication/{folder.name}/featured.*` — {credit}")
            print(f"{folder.name}: {credit}", file=sys.stderr)
        time.sleep(0.5)
    if args.summary and lines:
        with args.summary.open("a", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
    print(added)
    return 0


if __name__ == "__main__":
    sys.exit(main())
