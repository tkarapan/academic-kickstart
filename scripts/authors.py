#!/usr/bin/env python3
"""Keep co-author names consistent across publication pages and citations.

Names are matched to a single canonical spelling using data/authors.json
(explicit aliases for typos and nicknames) and, for names not listed there,
an automatic rule: two names refer to the same person when their first and
last names match once accents, capitals, punctuation and middle names are
ignored. The author list in each cite.bib is rewritten from the page's
author list so that the two always agree.

    python3 scripts/authors.py            # apply to all publications
    python3 scripts/authors.py --check    # report only; exit 1 if changes are needed
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OWNER = "Theodoros Karapanagiotidis"
NICKNAMES = {"will": "william", "bill": "william", "nick": "nicholas", "mike": "michael", "dan": "daniel",
             "liz": "elizabeth", "beth": "elizabeth", "rob": "robert", "bob": "robert", "tom": "thomas",
             "jon": "jonathan", "jim": "james", "andy": "andrew", "alex": "alexander", "chris": "christopher",
             "kate": "katherine", "katya": "katya", "sam": "samuel", "ben": "benjamin", "matt": "matthew"}


def plain(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z ]+", " ", text).strip()


def tidy(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip()


def load_config() -> tuple[dict[str, str], list[str]]:
    data = json.loads((ROOT / "data" / "authors.json").read_text(encoding="utf-8"))
    aliases = {}
    for canonical, variants in data.get("aliases", {}).items():
        for variant in [canonical, *variants]:
            aliases[plain(variant)] = canonical
    return aliases, data.get("surnames", [])


def person_key(name: str) -> tuple[str, str]:
    parts = plain(name).split()
    first = parts[0] if parts else ""
    return NICKNAMES.get(first, first), parts[-1] if parts else ""


class Names:
    """Maps any spelling to the canonical spelling."""

    def __init__(self, known: list[str] | None = None) -> None:
        self.aliases, self.surnames = load_config()
        self.by_person: dict[tuple[str, str], str] = {}
        for name in known or []:
            self.canonical(name)

    def canonical(self, name: str) -> str:
        name = tidy(name)
        if name == "admin":
            return name
        if plain(name) in self.aliases:
            return self.aliases[plain(name)]
        key = person_key(name)
        if key in self.by_person:
            return self.by_person[key]
        self.by_person[key] = name
        return name

    def bibtex(self, name: str) -> str:
        name = OWNER if name == "admin" else name
        for surname in self.surnames:
            if name.endswith(" " + surname):
                return f"{{{surname}}}, {name[: -len(surname)].strip()}"
        parts = name.split()
        particles = {"van", "von", "de", "del", "der", "da", "di", "le", "la"}
        i = len(parts) - 1
        while i > 1 and parts[i - 1].lower() in particles:
            i -= 1
        return f"{' '.join(parts[i:])}, {' '.join(parts[:i])}" if len(parts) > 1 else name


def replace_field(bib: str, field: str, value: str) -> str:
    """Replace a BibTeX field value, matching nested braces, whatever the layout."""
    match = re.search(rf"(?i)\b{field}\s*=\s*", bib)
    if not match:
        return bib
    start = match.end()
    if bib[start:start + 1] == "{":
        depth, end = 0, start
        for end in range(start, len(bib)):
            depth += {"{": 1, "}": -1}.get(bib[end], 0)
            if depth == 0:
                break
        return bib[:start] + "{" + value + "}" + bib[end + 1:]
    if bib[start:start + 1] == '"':
        end = bib.index('"', start + 1)
        return bib[:start] + "{" + value + "}" + bib[end + 1:]
    return bib


def page_authors(text: str) -> list[str]:
    match = re.search(r"^authors\s*=\s*\[(.*?)\]", text, re.M)
    return re.findall(r'"([^"]*)"', match.group(1)) if match else []


def apply(content: Path, check: bool = False) -> list[str]:
    pages = sorted(content.glob("*/index.md"))
    # Most frequent spelling of each person wins when no alias is defined.
    counts: dict[str, int] = {}
    for index in pages:
        for name in page_authors(index.read_text(encoding="utf-8")):
            counts[tidy(name)] = counts.get(tidy(name), 0) + 1
    names = Names(sorted(counts, key=lambda n: -counts[n]))
    changed = []
    for index in pages:
        text = index.read_text(encoding="utf-8")
        authors = page_authors(text)
        fixed = [names.canonical(a) for a in authors]
        new_text = text
        if fixed != authors:
            listing = ", ".join(json.dumps(a, ensure_ascii=False) for a in fixed)
            new_text = re.sub(r"^authors\s*=\s*\[.*?\]", lambda _: f"authors = [{listing}]", text, count=1, flags=re.M)
        bib = index.parent / "cite.bib"
        bib_text = bib.read_text(encoding="utf-8") if bib.exists() else None
        new_bib = bib_text
        if bib_text and fixed:
            field = " and ".join(names.bibtex(a) for a in fixed)
            new_bib = replace_field(bib_text, "author", field)
        if new_text != text or new_bib != bib_text:
            changed.append(index.parent.name)
            if not check:
                index.write_text(new_text, encoding="utf-8")
                if bib_text is not None:
                    bib.write_text(new_bib, encoding="utf-8")
    return changed


def similar_names(content: Path) -> list[tuple[str, str]]:
    """Pairs of different spellings that look alike and are not known to be different people."""
    from difflib import SequenceMatcher
    from itertools import combinations
    data = json.loads((ROOT / "data" / "authors.json").read_text(encoding="utf-8"))
    distinct = [set(group) for group in data.get("distinct", [])]
    people = sorted({tidy(n) for i in content.glob("*/index.md") for n in page_authors(i.read_text(encoding="utf-8"))} - {"admin"})
    pairs = []
    for a, b in combinations(people, 2):
        if any({a, b} <= group for group in distinct):
            continue
        pa, pb = plain(a).split(), plain(b).split()
        close = SequenceMatcher(None, " ".join(pa), " ".join(pb)).ratio() > 0.85
        same_surname = pa[-1] == pb[-1] and pa[0][0] == pb[0][0]
        if close or same_surname:
            pairs.append((a, b))
    return pairs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--content", default=ROOT / "content" / "publication", type=Path)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--similar", action="store_true", help="list look-alike names that may be the same person")
    args = parser.parse_args()
    if args.similar:
        for a, b in similar_names(args.content):
            print(f"{a} / {b}")
        return 0
    changed = apply(args.content, check=args.check)
    for name in changed:
        print(name)
    return 1 if (args.check and changed) else 0


if __name__ == "__main__":
    sys.exit(main())
