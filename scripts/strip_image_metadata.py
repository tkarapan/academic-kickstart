#!/usr/bin/env python3
"""Remove embedded metadata (EXIF, GPS, XMP, IPTC, comments) from images.

Works losslessly on PNG, JPEG and WebP: metadata blocks are dropped and the
image data is copied unchanged. Colour profiles are kept.

    python3 scripts/strip_image_metadata.py            # clean all tracked images
    python3 scripts/strip_image_metadata.py --check    # report only; exit 1 if any found
    python3 scripts/strip_image_metadata.py a.jpg b.png

Uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import struct
import subprocess
import sys
from pathlib import Path

EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


def strip_png(data: bytes) -> bytes:
    out, i = bytearray(data[:8]), 8
    while i < len(data):
        length = struct.unpack(">I", data[i:i + 4])[0]
        kind = data[i + 4:i + 8]
        if kind not in (b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME"):
            out += data[i:i + 12 + length]
        i += 12 + length
    return bytes(out)


def strip_jpeg(data: bytes) -> bytes:
    out, i = bytearray(data[:2]), 2
    while i < len(data):
        if data[i] != 0xFF:
            out += data[i:]
            break
        marker = data[i + 1]
        if marker == 0xDA:  # start of scan: the rest is image data
            out += data[i:]
            break
        if 0xD0 <= marker <= 0xD9 or marker == 0x01:
            out += data[i:i + 2]
            i += 2
            continue
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        segment = data[i:i + 2 + length]
        # Drop APP1 (EXIF/XMP), APP13 (IPTC/Photoshop) and comments; keep JFIF, ICC and Adobe.
        if marker not in (0xE1, 0xED, 0xFE):
            out += segment
        i += 2 + length
    return bytes(out)


def strip_webp(data: bytes) -> bytes:
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return data
    chunks, i = [], 12
    while i + 8 <= len(data):
        kind = data[i:i + 4]
        size = struct.unpack("<I", data[i + 4:i + 8])[0]
        chunk = data[i:i + 8 + size + (size & 1)]
        if kind not in (b"EXIF", b"XMP "):
            if kind == b"VP8X":
                flags = chunk[8] & ~0x0C  # clear EXIF and XMP flags
                chunk = chunk[:8] + bytes([flags]) + chunk[9:]
            chunks.append(chunk)
        i += 8 + size + (size & 1)
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


def strip(data: bytes) -> bytes:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return strip_png(data)
    if data[:2] == b"\xff\xd8":
        return strip_jpeg(data)
    if data[:4] == b"RIFF":
        return strip_webp(data)
    return data


def tracked_images(root: Path) -> list[Path]:
    files = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True, check=True).stdout.split()
    return [root / f for f in files if f.lower().endswith(EXTENSIONS)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", type=Path)
    parser.add_argument("--check", action="store_true", help="report only; exit 1 if metadata is found")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    files = args.files or tracked_images(root)
    found = []
    for path in files:
        if not path.is_file() or not path.name.lower().endswith(EXTENSIONS):
            continue
        data = path.read_bytes()
        cleaned = strip(data)
        if cleaned != data:
            found.append(path)
            if not args.check:
                path.write_bytes(cleaned)
    for path in found:
        print(path.relative_to(root) if path.is_absolute() and root in path.parents else path)
    return 1 if (args.check and found) else 0


if __name__ == "__main__":
    sys.exit(main())
