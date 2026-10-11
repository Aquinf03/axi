#!/usr/bin/env python3
"""Build assets/AppIcon.icns from assets/icon.png (macOS). Embeds PNG sizes in an icns container."""

from __future__ import annotations

import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "icon.png"
OUT = ROOT / "assets" / "AppIcon.icns"
APP_ICNS = ROOT / "assets" / "Axi.app" / "Contents" / "Resources" / "AppIcon.icns"

# Modern icns: PNG payloads keyed by OSType.
# https://en.wikipedia.org/wiki/Apple_Icon_Image_format
SIZES: list[tuple[str, int]] = [
    ("icp4", 16),
    ("icp5", 32),
    ("icp6", 64),
    ("ic07", 128),
    ("ic08", 256),
    ("ic09", 512),
    ("ic10", 1024),
]


def resize_png(src: Path, px: int, dest: Path) -> None:
    subprocess.check_call(
        ["sips", "-z", str(px), str(px), str(src), "--out", str(dest)],
        stdout=subprocess.DEVNULL,
    )


def build_icns(src: Path, dest: Path) -> None:
    entries: list[tuple[bytes, bytes]] = []
    with tempfile.TemporaryDirectory() as tmp:
        tdir = Path(tmp)
        for ostype, px in SIZES:
            png_path = tdir / f"{px}.png"
            resize_png(src, px, png_path)
            data = png_path.read_bytes()
            if not data.startswith(b"\x89PNG"):
                raise SystemExit(f"sips did not write a PNG for {px}px")
            entries.append((ostype.encode("ascii"), data))

    # icns = magic + total length + [type + len + data]...
    body = bytearray()
    for ostype, data in entries:
        # length includes the 8-byte type+length header
        body += ostype + struct.pack(">I", 8 + len(data)) + data
    total = 8 + len(body)
    dest.write_bytes(b"icns" + struct.pack(">I", total) + body)


def main() -> int:
    if sys.platform != "darwin":
        print("skip: icns build is macOS-only", file=sys.stderr)
        return 0
    if not SRC.is_file():
        print(f"missing {SRC}", file=sys.stderr)
        return 1
    build_icns(SRC, OUT)
    APP_ICNS.parent.mkdir(parents=True, exist_ok=True)
    APP_ICNS.write_bytes(OUT.read_bytes())
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
