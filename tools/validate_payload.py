#!/usr/bin/env python3
"""Verify/sync the public CrossPoint payload against the private YBX Server."""
from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = ROOT / "ybx.crosspoint-plugin"
SAFE_NAME = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*\Z")
SEMVER = re.compile(r"\d+\.\d+\.\d+\Z")


def load(directory: Path, filename: str, errors: list[str]) -> dict:
    try:
        return json.loads((directory / filename).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        errors.append(f"{filename}: {exc}")
        return {}


def validate(directory: Path = PAYLOAD, canonical: Path | None = None) -> list[str]:
    errors: list[str] = []
    manifest = load(directory, "manifest.json", errors)
    if manifest.get("name") != "ybx":
        errors.append("manifest.name must equal ybx")
    version = manifest.get("version", "")
    if not isinstance(version, str) or not SEMVER.fullmatch(version):
        errors.append("manifest.version must be SemVer")
    files = manifest.get("files", [])
    if not isinstance(files, list) or not files:
        return errors + ["manifest.files missing"]
    if len(files) != len(set(str(x) for x in files)):
        errors.append("manifest.files contains duplicates")
    for needed in ("manifest.json", "plugin.json", "plugin.js", "device.json"):
        if needed not in files:
            errors.append(f"required runtime file missing: {needed}")
    for name in files:
        if not isinstance(name, str) or not SAFE_NAME.fullmatch(name) or name == "token.json":
            errors.append(f"unsafe/private file name: {name!r}")
        elif not (directory / name).is_file():
            errors.append(f"missing runtime file: {name}")
    for path in directory.iterdir():
        if not path.name.startswith(".") and path.name not in files:
            errors.append(f"undeclared payload entry: {path.name}")
    plugin = load(directory, "plugin.json", errors)
    if (plugin.get("id"), plugin.get("name"), plugin.get("version"), plugin.get("files")) != (
        "ybx", "ybx", version, files
    ):
        errors.append("plugin.json disagrees with manifest id, version or files")
    device = load(directory, "device.json", errors)
    if (directory / "device.json").is_file() and (directory / "device.json").stat().st_size > 8192:
        errors.append("device.json exceeds 8 KiB")
    if (device.get("browse", {}).get("format") != "json"
            or device.get("auth", {}).get("type") != "device_code"
            or device.get("token", {}).get("path") != "access_token"):
        errors.append("device.json missing native catalog/auth/token contract")
    route_versions = re.findall(r"v=\d+\.\d+\.\d+", json.dumps(device))
    if not route_versions or any(item != "v=" + version for item in route_versions):
        errors.append("device route versions disagree with manifest.version")
    compatible = manifest.get("compatibility", {})
    families = compatible.get("firmware_family")
    if not (families == "crosspoint" or
            isinstance(families, list) and "crosspoint" in families):
        errors.append("firmware family crosspoint missing")
    if not isinstance(compatible.get("plugin_api_min"), int):
        errors.append("invalid minimum plugin API")
    if (device.get("browse", {}).get("lists_url") and
            "catalog.lists.auth" not in compatible.get("requires", [])):
        errors.append("dynamic lists require catalog.lists.auth")
    if canonical is not None:
        other = load(canonical, "manifest.json", errors)
        if other.get("version") != version or other.get("files") != files:
            errors.append("canonical manifest version/files differ")
        for name in files:
            if not isinstance(name, str) or not SAFE_NAME.fullmatch(name) or name == "token.json":
                continue
            src = canonical / name
            dest = directory / name
            if not src.is_file():
                errors.append(f"canonical runtime file missing: {name}")
            elif dest.is_file() and dest.read_bytes() != src.read_bytes():
                errors.append(f"payload differs from canonical server: {name}")
    return errors


def sync(canonical: Path) -> None:
    errors: list[str] = []
    manifest = load(canonical, "manifest.json", errors)
    names = manifest.get("files", [])
    if errors or not isinstance(names, list) or not names:
        raise ValueError("invalid canonical manifest")
    if any(not isinstance(n, str) or not SAFE_NAME.fullmatch(n) or
           n == "token.json" or not (canonical / n).is_file() for n in names):
        raise ValueError("unsafe or missing file in canonical manifest")
    PAYLOAD.mkdir(parents=True, exist_ok=True)
    for name in names:
        shutil.copyfile(canonical / name, PAYLOAD / name)
    errors = validate(PAYLOAD, canonical)
    if errors:
        raise ValueError("\n".join(errors))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canonical", type=Path, help="path to canonical plugin in private YBX Server")
    parser.add_argument("--sync", action="store_true", help="copy canonical runtime files then validate")
    args = parser.parse_args()
    if args.sync:
        if args.canonical is None:
            parser.error("--sync requires --canonical")
        sync(args.canonical)
    errors = validate(PAYLOAD, args.canonical)
    if errors:
        parser.exit(1, "\n".join(errors) + "\n")
    print("YBX payload verified" + (" against canonical server" if args.canonical else ""))
