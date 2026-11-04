#!/usr/bin/env python3
"""Build a reproducible official-CrossPoint-compatible YBX Stock release ZIP.

Preserves the explicit ybx/ directory entry present in stable 1.6.13,
uses only manifest-listed public files, rejects symlinks and private secrets.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.validate_payload import validate

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "ybx.crosspoint-plugin"
STAMP = (2026, 11, 4, 0, 0, 0)
SAFE_FILE = re.compile(r"[A-Za-z0-9_.-]+\Z")
PROHIBITED = {"token.json", "credentials.json", ".env", "secrets.json"}


def build(out: Path, source: Path = SOURCE) -> str:
    errors = validate(source)
    if errors:
        raise ValueError("Invalid stock plugin: " + "; ".join(errors))
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    files = manifest["files"]
    if not isinstance(files, list) or len(files) != len(set(files)) or len(files) != 7:
        raise ValueError("Expected seven unique public manifest files")
    for name in files:
        if not isinstance(name, str) or not SAFE_FILE.fullmatch(name) or name in PROHIBITED:
            raise ValueError(f"Unsafe release filename: {name!r}")
        path = source / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Missing or symlinked public plugin file: {name}")
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.resolve() in [((source / n).resolve()) for n in files]:
        raise ValueError("Refusing to overwrite a package source file")
    temp = out.with_name(out.name + ".tmp")
    try:
        with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9,
                             strict_timestamps=True) as archive:
            folder = zipfile.ZipInfo("ybx/", STAMP)
            folder.external_attr = (stat.S_IFDIR | 0o755) << 16
            folder.compress_type = zipfile.ZIP_STORED
            archive.writestr(folder, b"")
            for name in files:
                entry = zipfile.ZipInfo(f"ybx/{name}", STAMP)
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(entry, (source / name).read_bytes())
        with zipfile.ZipFile(temp) as archive:
            expected = ["ybx/"] + [f"ybx/{name}" for name in files]
            if archive.namelist() != expected or archive.testzip() is not None:
                raise ValueError("Archive structure/CRC validation failed")
            for name in files:
                if archive.read(f"ybx/{name}") != (source / name).read_bytes():
                    raise ValueError("Archive contents differ from public source: " + name)
        os.replace(temp, out)
    finally:
        temp.unlink(missing_ok=True)
    return hashlib.sha256(out.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    options = parser.parse_args()
    digest = build(options.output)
    print(f"{options.output}  sha256={digest}  bytes={options.output.stat().st_size}")


if __name__ == "__main__":
    main()
