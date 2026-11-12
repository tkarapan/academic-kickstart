#!/usr/bin/env python3
"""Find new publications and create draft publication pages for them.

New journal articles are discovered from two free, public sources:

* ORCID public API (works listed on the ORCID record)
* Crossref (works whose metadata include the ORCID iD)

Any DOI not already on the site, and not listed in the declined file, gets a
page bundle in content/publication/ (index.md and cite.bib) built from
Crossref metadata. Nothing is published directly: the workflow that runs this
script opens a pull request for review.

Uses only the Python standard library. Network problems with one source are
reported and skipped so that the other source can still be used.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ORCID_ID = "0000-0002-0813-1019"
OWNER_FAMILY_NAME = "karapanagiotidis"
INCLUDED_TYPES = {"journal-article"}
USER_AGENT = "tkarap.com-publication-check/1.0 (+https://www.tkarap.com/)"
# Correction notices, errata and retractions are not listed as publications.
NOTICE_TITLE = re.compile(r"^\s*(author\s+)?(correction|corrigendum|erratum|retraction|expression of concern)\b", re.I)
STOP_WORDS = {
    "a", "an", "the", "of", "on", "in", "and", "for", "to", "from", "with",
    "by", "at", "is", "are", "how", "what", "why", "does", "do", "we",
}


def log(message: str) -> None:
    print(message, file=sys.stderr)


def get_json(url: str, accept: str = "application/json", retries: int = 4) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(10 * (attempt + 1))
                continue
            raise
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(10 * (attempt + 1))
                continue
            raise
    raise RuntimeError("unreachable")


def normalise_doi(doi: str) -> str:
    doi = doi.strip().lower()
    doi = re.sub(r"^(https?://)?(dx\.)?doi\.org/", "", doi)
    return doi


def normalise_title(title: str) -> str:
    title = re.sub(r"<[^>]+>", "", html.unescape(title or ""))
    title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def ascii_slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


# --------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------

def dois_from_orcid() -> set[str]:
    data = get_json(f"https://pub.orcid.org/v3.0/{ORCID_ID}/works")
    found = set()
    for group in data.get("group", []):
        for summary in group.get("work-summary", []):
            if summary.get("type") not in INCLUDED_TYPES:
                continue
            for ext in (summary.get("external-ids") or {}).get("external-id", []):
                if ext.get("external-id-type") == "doi" and ext.get("external-id-relationship") == "self":
                    found.add(normalise_doi(ext["external-id-value"]))
    return found


def dois_from_crossref() -> set[str]:
    query = urllib.parse.urlencode({
        "filter": f"orcid:{ORCID_ID}",
        "rows": 1000,
        "select": "DOI,type",
    })
    data = get_json(f"https://api.crossref.org/works?{query}")
    return {
        normalise_doi(item["DOI"])
        for item in data["message"]["items"]
        if item.get("type") in INCLUDED_TYPES
    }


def crossref_record(doi: str) -> dict:
    return get_json(f"https://api.crossref.org/works/{urllib.parse.quote(doi, safe='/')}")["message"]


# --------------------------------------------------------------------------
# Existing site content
# --------------------------------------------------------------------------

def existing_publications(pub_dir: Path) -> tuple[set[str], set[str], set[str], dict[str, str]]:
    """Return DOIs, titles of published works, folder names, and preprint titles by folder."""
    dois, titles, slugs, preprints = set(), set(), set(), {}
    for index in pub_dir.glob("*/index.md"):
        slugs.add(index.parent.name)
        text = index.read_text(encoding="utf-8")
        if m := re.search(r'^doi\s*=\s*"([^"]+)"', text, re.M):
            dois.add(normalise_doi(m.group(1)))
        if m := re.search(r'^title\s*=\s*"(.*)"\s*$', text, re.M):
            if re.search(r'^publication_types\s*=\s*\["3"\]', text, re.M):
                preprints[normalise_title(m.group(1))] = index.parent.name
            else:
                titles.add(normalise_title(m.group(1)))
    return dois, titles, slugs, preprints


def read_declined(path: Path | None) -> set[str]:
    if not path or not path.exists():
        return set()
    return {normalise_doi(line) for line in path.read_text().splitlines() if line.strip().startswith("10.")}


# --------------------------------------------------------------------------
# Page generation
# --------------------------------------------------------------------------

def toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def clean_abstract(raw: str) -> str:
    text = re.sub(r"<jats:title>.*?</jats:title>", " ", raw or "", flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"^\s*abstract\s*", "", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def author_names(record: dict) -> list[str]:
    names = []
    for author in record.get("author", []):
        orcid = (author.get("ORCID") or "").rstrip("/").split("/")[-1]
        family = author.get("family", "")
        if orcid == ORCID_ID or ascii_slug(family) == OWNER_FAMILY_NAME:
            names.append("admin")
        elif family:
            names.append(" ".join(p for p in (author.get("given", ""), family) if p))
        elif author.get("name"):
            names.append(author["name"])
    return names


def publication_date(record: dict) -> tuple[int, int, int]:
    for key in ("published-online", "published-print", "issued", "created"):
        parts = (record.get(key) or {}).get("date-parts") or [[]]
        if parts[0] and parts[0][0]:
            year, month, day = (parts[0] + [1, 1])[:3]
            return int(year), int(month or 1), int(day or 1)
    raise ValueError("record has no date")


def make_slug(record: dict, year: int, taken: set[str]) -> str:
    authors = record.get("author") or [{}]
    first = ascii_slug(authors[0].get("family") or authors[0].get("name") or "paper").split("-")[-1]
    words = [w for w in ascii_slug((record.get("title") or ["paper"])[0]).split("-") if w and w not in STOP_WORDS]
    base = f"{first}-{year}-{words[0] if words else 'paper'}"
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    taken.add(slug)
    return slug


def bibtex(record: dict, key: str, authors: list[str], owner_name: str, year: int, month: int) -> str:
    def esc(value: str) -> str:
        return value.replace("{", "").replace("}", "")

    bib_authors = []
    for author in record.get("author", []):
        if author.get("family"):
            bib_authors.append(f"{author['family']}, {author.get('given', '')}".strip(", "))
        elif author.get("name"):
            bib_authors.append(author["name"])
    if not bib_authors:
        bib_authors = [owner_name if a == "admin" else a for a in authors]
    fields = [
        ("author", " and ".join(bib_authors)),
        ("title", re.sub(r"<[^>]+>", "", (record.get("title") or [""])[0])),
        ("journal", (record.get("container-title") or [""])[0]),
        ("year", str(year)),
        ("month", ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][month - 1]),
        ("volume", record.get("volume", "")),
        ("number", record.get("issue", "")),
        ("pages", record.get("page", "") or record.get("article-number", "")),
        ("publisher", record.get("publisher", "")),
        ("doi", record.get("DOI", "")),
    ]
    body = ",\n".join(
        f"  {name} = {{{esc(value)}}}" if name != "month" else f"  {name} = {value}"
        for name, value in fields if value
    )
    return f"@article{{{key},\n{body}\n}}\n"


def write_page(pub_dir: Path, record: dict, taken: set[str], owner_name: str) -> tuple[str, str]:
    year, month, day = publication_date(record)
    slug = make_slug(record, year, taken)
    authors = author_names(record)
    title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.unescape((record.get("title") or [""])[0]))).strip()
    venue = (record.get("container-title") or [""])[0]
    lines = [
        "+++",
        f"title = {toml_string(title)}",
        f"date = {year:04d}-{month:02d}-{day:02d}",
        f"authors = [{', '.join(toml_string(a) for a in authors)}]",
        'publication_types = ["2"]',
        f"abstract = {toml_string(clean_abstract(record.get('abstract', '')))}",
        "featured = false",
        f"publication = {toml_string(f'*{venue}*' if venue else '')}",
        f"doi = {toml_string(record['DOI'])}",
        "+++",
        "",
    ]
    folder = pub_dir / slug
    folder.mkdir(parents=True)
    (folder / "index.md").write_text("\n".join(lines), encoding="utf-8")
    (folder / "cite.bib").write_text(
        bibtex(record, slug.replace("-", ""), authors, owner_name, year, month), encoding="utf-8"
    )
    return slug, title


# --------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content", default="content/publication", type=Path)
    parser.add_argument("--declined", type=Path, help="file listing DOIs that should never be proposed")
    parser.add_argument("--summary", type=Path, help="write a Markdown summary of new pages here")
    parser.add_argument("--owner-name", default="Theodoros Karapanagiotidis")
    parser.add_argument("--dry-run", action="store_true", help="report new DOIs without writing files")
    args = parser.parse_args()

    found: set[str] = set()
    sources_ok = 0
    for name, fetch in (("ORCID", dois_from_orcid), ("Crossref", dois_from_crossref)):
        try:
            dois = fetch()
            log(f"{name}: {len(dois)} journal articles")
            found |= dois
            sources_ok += 1
        except Exception as error:  # noqa: BLE001 - one failing source must not stop the other
            log(f"{name}: skipped ({error})")
    if sources_ok == 0:
        log("No source could be reached; nothing to do.")
        return 0

    have_dois, have_titles, taken, preprints = existing_publications(args.content)
    declined = read_declined(args.declined)
    candidates = sorted(found - have_dois - declined)

    created = []
    for doi in candidates:
        try:
            record = crossref_record(doi)
        except Exception as error:  # noqa: BLE001
            log(f"{doi}: metadata unavailable ({error})")
            continue
        if record.get("type") not in INCLUDED_TYPES or record.get("update-to"):
            continue
        if NOTICE_TITLE.match((record.get("title") or [""])[0]):
            continue
        title_key = normalise_title((record.get("title") or [""])[0])
        if not title_key or title_key in have_titles:
            continue
        have_titles.add(title_key)
        if args.dry_run:
            log(f"new: {doi}  {(record.get('title') or [''])[0]}")
            continue
        slug, title = write_page(args.content, record, taken, args.owner_name)
        created.append((doi, slug, title, preprints.get(title_key)))
        log(f"created content/publication/{slug}/")
        time.sleep(1)

    if args.summary and created:
        rows = "\n".join(
            f"- **{title}** — `content/publication/{slug}/` — DOI `{doi}`"
            + (f"\n  - Published version of the preprint in `content/publication/{pre}/`, which can be deleted." if pre else "")
            for doi, slug, title, pre in created
        )
        args.summary.write_text(rows + "\n", encoding="utf-8")
    print(len(created))
    return 0


if __name__ == "__main__":
    sys.exit(main())
