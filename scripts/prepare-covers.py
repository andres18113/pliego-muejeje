#!/usr/bin/env python3
"""Validate staging book covers and prepare stable, SKU-named deployment assets."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import shutil
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path, PurePosixPath
from typing import Any


REGISTRY_NAME = "sku-registry.json"
REGISTRY_SCHEMA = "pliego-cover-sku-registry-v1"
PUBLIC_COVER_BASE_URL = "https://covers.pliegolibros.com"
PERMANENT_SKU_RE = re.compile(r"^PLG-BK-(\d{6,})$")
RESERVED_DIRS = {"generated"}


class PreparationError(Exception):
    def __init__(self, report: dict[str, Any]):
        self.report = report
        super().__init__("Cover preparation validation failed")


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _is_inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _normalize_isbn13(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("isbn13 must be a string when present")
    normalized = re.sub(r"[-\s]", "", value)
    if len(normalized) != 13 or not normalized.isdigit():
        raise ValueError(f"invalid ISBN13 format: {value!r}")
    checksum = sum(int(char) * (1 if index % 2 == 0 else 3) for index, char in enumerate(normalized[:12]))
    if (checksum + int(normalized[12])) % 10 != 0:
        raise ValueError(f"invalid ISBN13 check digit: {value!r}")
    return normalized


def _canonical(value: Any) -> Any:
    if isinstance(value, str):
        return " ".join(unicodedata.normalize("NFKC", value).casefold().split())
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    if isinstance(value, dict):
        return {key: _canonical(value[key]) for key in sorted(value)}
    return value


def _edition_identity(record: dict[str, Any], isbn13: str | None) -> str:
    if isbn13:
        return f"isbn13:{isbn13}"

    book = record["libro"]
    edition = record["edicion"]
    fallback = {
        "title": book.get("titulo"),
        "subtitle": book.get("subtitulo"),
        "authors": book.get("autores"),
        "publisher": edition.get("editorial"),
        "language": edition.get("idioma"),
        "format": edition.get("formato"),
        "publication_date": edition.get("fechaPublicacion") or edition.get("anioPublicacion"),
        "pages": edition.get("paginas"),
    }
    encoded = json.dumps(_canonical(fallback), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "fallback:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _record_fingerprint(record: dict[str, Any]) -> str:
    normalized = copy.deepcopy(record)
    edition = normalized.get("edicion")
    if isinstance(edition, dict):
        edition.pop("sku", None)
    encoded = json.dumps(_canonical(normalized), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _valid_webp(path: Path) -> bool:
    try:
        if path.stat().st_size < 20:
            return False
        with path.open("rb") as source:
            header = source.read(16)
    except OSError:
        return False
    return (
        len(header) == 16
        and header[:4] == b"RIFF"
        and header[8:12] == b"WEBP"
        and header[12:16] in {b"VP8 ", b"VP8L", b"VP8X"}
    )


def _load_registry(registry_path: Path, report: dict[str, Any]) -> dict[str, Any]:
    if not registry_path.exists():
        return {"schema": REGISTRY_SCHEMA, "next_sequence": 1, "assignments": []}

    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        report["errors"].append(f"Cannot read SKU registry {registry_path}: {error}")
        return {"schema": REGISTRY_SCHEMA, "next_sequence": 1, "assignments": []}

    if not isinstance(registry, dict) or registry.get("schema") != REGISTRY_SCHEMA:
        report["errors"].append(f"SKU registry has an unsupported schema: {registry_path}")
        return {"schema": REGISTRY_SCHEMA, "next_sequence": 1, "assignments": []}
    if not isinstance(registry.get("assignments"), list):
        report["errors"].append("SKU registry assignments must be a list")
        registry["assignments"] = []
    next_sequence = registry.get("next_sequence")
    if not isinstance(next_sequence, int) or isinstance(next_sequence, bool) or next_sequence < 1:
        report["errors"].append("SKU registry next_sequence must be a positive integer")
        registry["next_sequence"] = 1

    identity_owner: dict[str, str] = {}
    source_owner: dict[str, str] = {}
    sku_owner: dict[str, str] = {}
    for index, assignment in enumerate(registry["assignments"]):
        label = f"SKU registry assignment {index}"
        if not isinstance(assignment, dict):
            report["errors"].append(f"{label} must be an object")
            continue
        sku = assignment.get("sku")
        match = PERMANENT_SKU_RE.fullmatch(sku) if isinstance(sku, str) else None
        if not match:
            report["errors"].append(f"{label} has an invalid permanent SKU: {sku!r}")
        elif sku in sku_owner:
            report["conflicts"].append(f"Permanent SKU {sku} is assigned more than once")
        else:
            sku_owner[sku] = label
        identities = assignment.get("identity_keys", [])
        source_keys = assignment.get("source_keys", [])
        if not isinstance(identities, list) or not all(isinstance(item, str) for item in identities):
            report["errors"].append(f"{label} identity_keys must be a list of strings")
            continue
        if not isinstance(source_keys, list) or not all(isinstance(item, str) for item in source_keys):
            report["errors"].append(f"{label} source_keys must be a list of strings")
            continue
        for identity in identities:
            previous = identity_owner.get(identity)
            if previous and previous != sku:
                report["conflicts"].append(f"Identity {identity} is assigned to both {previous} and {sku}")
            identity_owner[identity] = sku
        for source_key in source_keys:
            previous = source_owner.get(source_key)
            if previous and previous != sku:
                report["conflicts"].append(f"Source key {source_key} is assigned to both {previous} and {sku}")
            source_owner[source_key] = sku
    return registry


def scan_dataset(covers_dir: Path) -> tuple[list[dict[str, Any]], list[tuple[Path, dict[str, Any]]], list[Path], dict[str, Any]]:
    root = covers_dir.resolve()
    report: dict[str, Any] = {
        "json_files": 0,
        "categories": 0,
        "records": 0,
        "covers_discovered": 0,
        "missing": [],
        "orphans": [],
        "duplicates": [],
        "conflicts": [],
        "errors": [],
    }
    json_paths = sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.suffix.casefold() == ".json"
        and path.relative_to(root).parts[0] not in RESERVED_DIRS
        and path.name != REGISTRY_NAME
    )
    webp_paths = sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.suffix.casefold() == ".webp"
        and path.relative_to(root).parts[0] not in RESERVED_DIRS
    )
    report["json_files"] = len(json_paths)
    report["covers_discovered"] = len(webp_paths)
    report["categories"] = len({_relative(path.parent, root) for path in json_paths})

    docs: list[tuple[Path, dict[str, Any]]] = []
    records: list[dict[str, Any]] = []
    references: dict[str, list[dict[str, Any]]] = defaultdict(list)
    isbn_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    identity_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    old_sku_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    basename_to_paths: dict[str, list[Path]] = defaultdict(list)
    hash_to_paths: dict[str, list[Path]] = defaultdict(list)
    known_webp_by_relative = {_relative(path, root): path for path in webp_paths}
    webp_by_basename: dict[str, list[Path]] = defaultdict(list)

    for path in webp_paths:
        webp_by_basename[path.name].append(path)
        if not _valid_webp(path):
            report["errors"].append(f"File is not a valid WebP header: {_relative(path, root)}")
        try:
            digest = _sha256_file(path)
            hash_to_paths[digest].append(path)
        except OSError as error:
            report["errors"].append(f"Cannot read cover {_relative(path, root)}: {error}")

    for path in json_paths:
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            report["errors"].append(f"Cannot read staging JSON {_relative(path, root)}: {error}")
            continue
        if not isinstance(document, dict) or not isinstance(document.get("libros"), list):
            report["errors"].append(f"Staging JSON must contain a libros array: {_relative(path, root)}")
            continue
        docs.append((path, document))
        for index, raw_record in enumerate(document["libros"]):
            where = f"{_relative(path, root)}#libros[{index}]"
            if not isinstance(raw_record, dict):
                report["errors"].append(f"{where} must be an object")
                continue
            book = raw_record.get("libro")
            edition = raw_record.get("edicion")
            if not isinstance(book, dict) or not isinstance(edition, dict):
                report["errors"].append(f"{where} must contain libro and edicion objects")
                continue
            title = book.get("titulo")
            if not isinstance(title, str) or not title.strip():
                report["errors"].append(f"{where} is missing libro.titulo")

            cover_name = raw_record.get("portadaArchivo")
            cover_path: Path | None = None
            cover_relative: str | None = None
            if not isinstance(cover_name, str) or not cover_name.strip():
                report["errors"].append(f"{where} is missing portadaArchivo")
            else:
                posix_name = PurePosixPath(cover_name.replace("\\", "/"))
                candidate = (path.parent / Path(*posix_name.parts)).resolve()
                if posix_name.is_absolute() or not _is_inside(candidate, root):
                    report["errors"].append(f"{where} has an unsafe cover path: {cover_name!r}")
                elif candidate.suffix.casefold() != ".webp":
                    report["errors"].append(f"{where} does not reference a .webp file: {cover_name!r}")
                else:
                    cover_path = candidate
                    cover_relative = _relative(candidate, root)
                    basename_to_paths[cover_path.name].append(cover_path)
                    if cover_relative not in known_webp_by_relative:
                        report["missing"].append(f"{where} references missing cover {cover_relative}")
                        elsewhere = webp_by_basename.get(cover_path.name, [])
                        if elsewhere:
                            report["conflicts"].append(
                                f"{where} expects {cover_relative}, but matching basename exists at "
                                + ", ".join(_relative(item, root) for item in elsewhere)
                            )

            try:
                isbn13 = _normalize_isbn13(edition.get("isbn13"))
            except ValueError as error:
                isbn13 = None
                report["errors"].append(f"{where}: {error}")
            old_sku = edition.get("sku")
            if old_sku is not None and not isinstance(old_sku, str):
                report["errors"].append(f"{where} edition.sku must be a string or null")
                old_sku = None
            entry = {
                "source_path": path,
                "source_relative": _relative(path, root),
                "record_index": index,
                "record": raw_record,
                "where": where,
                "title": title if isinstance(title, str) else "",
                "isbn13": isbn13,
                "old_sku": old_sku,
                "cover_path": cover_path,
                "cover_relative": cover_relative,
            }
            if isinstance(cover_name, str) and cover_name.strip():
                normalized_cover_name = cover_name.replace("\\", "/")
                entry["source_key"] = f"{entry['source_relative']}#{normalized_cover_name}"
            else:
                entry["source_key"] = f"{entry['source_relative']}#libros[{index}]"
            if isinstance(book.get("titulo"), str) and book.get("titulo", "").strip():
                try:
                    identity = _edition_identity(raw_record, isbn13)
                    entry["identity_key"] = identity
                    identity_records[identity].append(entry)
                    if isbn13:
                        isbn_records[isbn13].append(entry)
                except (KeyError, TypeError, ValueError) as error:
                    report["errors"].append(f"{where} cannot establish edition identity: {error}")
            if old_sku:
                old_sku_records[old_sku].append(entry)
            if cover_relative:
                references[cover_relative].append(entry)
            records.append(entry)

    referenced_paths = set(references)
    for relative in sorted(set(known_webp_by_relative) - referenced_paths):
        report["orphans"].append(relative)
    for relative, usages in sorted(references.items()):
        if len(usages) > 1:
            report["duplicates"].append(
                f"Cover {relative} is referenced by " + ", ".join(item["where"] for item in usages)
            )
    for isbn13, usages in sorted(isbn_records.items()):
        if len(usages) > 1:
            report["duplicates"].append(
                f"ISBN13 {isbn13} appears in " + ", ".join(item["where"] for item in usages)
            )
            if len({_record_fingerprint(item["record"]) for item in usages}) > 1:
                report["conflicts"].append(f"ISBN13 {isbn13} has conflicting record data or covers")
    for identity, usages in sorted(identity_records.items()):
        if len(usages) > 1 and not identity.startswith("isbn13:"):
            report["duplicates"].append(
                f"Fallback edition identity {identity} appears in " + ", ".join(item["where"] for item in usages)
            )
    for sku, usages in sorted(old_sku_records.items()):
        if len(usages) > 1:
            report["duplicates"].append(f"Staging SKU {sku} is used by " + ", ".join(item["where"] for item in usages))
            if len({item.get("identity_key") for item in usages}) > 1:
                report["conflicts"].append(f"Staging SKU {sku} is assigned to different editions")
    for basename, paths in sorted(webp_by_basename.items()):
        unique_paths = sorted(set(paths))
        if len(unique_paths) > 1:
            try:
                same_content = len({_sha256_file(path) for path in unique_paths}) == 1
            except OSError:
                same_content = False
            locations = ", ".join(_relative(path, root) for path in unique_paths)
            if same_content:
                report["duplicates"].append(f"WebP basename {basename} has identical files at {locations}")
            else:
                report["conflicts"].append(f"WebP basename {basename} has different files at {locations}")
    for digest, paths in sorted(hash_to_paths.items()):
        unique_paths = sorted(set(paths))
        if len(unique_paths) > 1:
            report["duplicates"].append(
                "Identical WebP content exists at " + ", ".join(_relative(path, root) for path in unique_paths)
            )

    report["records"] = len(records)
    return records, docs, webp_paths, report


def _registry_indexes(registry: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    identities: dict[str, dict[str, Any]] = {}
    sources: dict[str, dict[str, Any]] = {}
    for assignment in registry["assignments"]:
        if not isinstance(assignment, dict):
            continue
        for identity in assignment.get("identity_keys", []):
            identities[identity] = assignment
        for source_key in assignment.get("source_keys", []):
            sources[source_key] = assignment
    return identities, sources


def _write_text_if_changed(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def _write_bytes_if_changed(path: Path, source: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            if path.stat().st_size == source.stat().st_size and _sha256_file(path) == _sha256_file(source):
                return
        except OSError:
            pass
    temporary = path.with_name(path.name + ".tmp")
    shutil.copyfile(source, temporary)
    temporary.replace(path)


def prepare_covers(covers_dir: Path) -> dict[str, Any]:
    root = covers_dir.resolve()
    records, docs, webp_paths, report = scan_dataset(root)
    registry_path = root / REGISTRY_NAME
    registry = _load_registry(registry_path, report)
    report["records"] = len(records)

    if report["orphans"]:
        report["errors"].append(f"Found {len(report['orphans'])} orphan WebP file(s)")
    if report["missing"]:
        report["errors"].append(f"Found {len(report['missing'])} missing cover reference(s)")
    if report["duplicates"]:
        report["errors"].append(f"Found {len(report['duplicates'])} duplicate item(s)")
    if report["conflicts"]:
        report["errors"].append(f"Found {len(report['conflicts'])} conflicting item(s)")
    if report["errors"]:
        raise PreparationError(report)

    identity_index, source_index = _registry_indexes(registry)
    existing_skus = [
        int(match.group(1))
        for assignment in registry["assignments"]
        if isinstance(assignment, dict)
        and isinstance(assignment.get("sku"), str)
        and (match := PERMANENT_SKU_RE.fullmatch(assignment["sku"]))
    ]
    next_sequence = max(registry["next_sequence"], max(existing_skus, default=0) + 1)

    matches: dict[int, dict[str, Any]] = {}
    unassigned: list[dict[str, Any]] = []
    for entry in records:
        identity_match = identity_index.get(entry.get("identity_key"))
        source_match = source_index.get(entry["source_key"])
        found = {id(item): item for item in (identity_match, source_match) if item is not None}
        if len(found) > 1:
            report["conflicts"].append(
                f"{entry['where']} matches different registry assignments by identity and source path"
            )
            continue
        if found:
            matches[id(entry)] = next(iter(found.values()))
        else:
            unassigned.append(entry)
    if report["conflicts"]:
        report["errors"].append(f"Found {len(report['conflicts'])} registry conflict(s)")
        raise PreparationError(report)

    new_assignments: list[dict[str, Any]] = []
    for entry in sorted(unassigned, key=lambda item: (item["identity_key"], item["source_key"])):
        sku = f"PLG-BK-{next_sequence:06d}"
        next_sequence += 1
        assignment = {"sku": sku, "identity_keys": [], "source_keys": []}
        registry["assignments"].append(assignment)
        matches[id(entry)] = assignment
        new_assignments.append(assignment)

    output_root = root / "generated"
    manifest_records: list[dict[str, Any]] = []
    normalized_docs: dict[Path, dict[str, Any]] = {path: copy.deepcopy(document) for path, document in docs}
    registry["schema"] = REGISTRY_SCHEMA
    registry["next_sequence"] = next_sequence

    for entry in records:
        assignment = matches[id(entry)]
        sku = assignment["sku"]
        identity_key = entry["identity_key"]
        if identity_key not in assignment["identity_keys"]:
            assignment["identity_keys"].append(identity_key)
        if entry["source_key"] not in assignment["source_keys"]:
            assignment["source_keys"].append(entry["source_key"])
        assignment["identity_keys"].sort()
        assignment["source_keys"].sort()

        normalized_record = normalized_docs[entry["source_path"]]["libros"][entry["record_index"]]
        normalized_record["edicion"]["sku"] = sku
        r2_key = f"covers/editions/{sku}.webp"
        cover_url = f"{PUBLIC_COVER_BASE_URL}/{r2_key}"
        cover_metadata = normalized_record["edicion"].setdefault("portada", {})
        if not isinstance(cover_metadata, dict):
            raise PreparationError({"errors": [f"{entry['where']} has invalid portada metadata"]})
        cover_metadata["url"] = cover_url
        deployment_path = output_root / "r2" / r2_key
        _write_bytes_if_changed(deployment_path, entry["cover_path"])
        manifest_records.append({
            "isbn13": entry["isbn13"],
            "title": entry["title"],
            "original_file": entry["cover_relative"],
            "old_sku": entry["old_sku"],
            "permanent_sku": sku,
            "r2_object_key": r2_key,
            "cover_url": cover_url,
        })

    registry["assignments"].sort(key=lambda item: int(PERMANENT_SKU_RE.fullmatch(item["sku"]).group(1)))
    registry_text = json.dumps(registry, ensure_ascii=False, indent=2) + "\n"
    _write_text_if_changed(registry_path, registry_text)

    normalized_paths: list[str] = []
    for source_path, _document in docs:
        document = normalized_docs[source_path]
        source_relative = source_path.relative_to(root)
        destination = output_root / "json" / source_relative
        normalized_text = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
        _write_text_if_changed(destination, normalized_text)
        normalized_paths.append(_relative(destination, root))

    manifest_records.sort(key=lambda item: item["permanent_sku"])
    manifest = {
        "schema": "pliego-cover-manifest-v1",
        "records": manifest_records,
    }
    manifest_path = output_root / "manifest.json"
    _write_text_if_changed(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

    assigned = [entry["sku"] for entry in matches.values()]
    assigned_numbers = sorted(int(PERMANENT_SKU_RE.fullmatch(sku).group(1)) for sku in assigned)
    return {
        "json_files": report["json_files"],
        "categories": report["categories"],
        "records": report["records"],
        "covers_discovered": len(webp_paths),
        "assigned_sku_range": (
            f"PLG-BK-{assigned_numbers[0]:06d}..PLG-BK-{assigned_numbers[-1]:06d}"
            if assigned_numbers else "none"
        ),
        "new_skus": len(new_assignments),
        "registry": _relative(registry_path, root),
        "manifest": _relative(manifest_path, root),
        "normalized_json": normalized_paths,
        "deployment_covers": len(records),
        "deployment_directory": _relative(output_root / "r2" / "covers" / "editions", root),
        "validation": "passed",
        "validation_counts": {key: len(report[key]) for key in ("missing", "orphans", "duplicates", "conflicts")},
    }


def _format_report(report: dict[str, Any]) -> str:
    lines = [
        "Cover preparation validation failed.",
        f"Discovered {report['json_files']} JSON file(s), {report['records']} records, "
        f"{report['categories']} categories, and {report['covers_discovered']} WebP file(s).",
    ]
    for key in ("missing", "orphans", "duplicates", "conflicts", "errors"):
        values = report.get(key, [])
        if not values:
            continue
        lines.append(f"{key.title()} ({len(values)}):")
        lines.extend(f"  - {value}" for value in values)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    script_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--covers-dir",
        type=Path,
        default=script_root / "covers",
        help="staging and output directory (default: repository covers/)",
    )
    args = parser.parse_args(argv)
    try:
        summary = prepare_covers(args.covers_dir)
    except PreparationError as error:
        print(_format_report(error.report), file=sys.stderr)
        return 1
    print(
        "Cover preparation complete: "
        f"{summary['json_files']} JSON file(s), {summary['categories']} categories, "
        f"{summary['records']} records, {summary['covers_discovered']} WebP cover(s)."
    )
    counts = summary["validation_counts"]
    print(
        f"Validation: {summary['validation']} "
        f"({counts['missing']} missing, {counts['orphans']} orphan, "
        f"{counts['duplicates']} duplicate, {counts['conflicts']} conflict)"
    )
    print(f"Assigned SKU range: {summary['assigned_sku_range']} ({summary['new_skus']} new this run)")
    print(f"Registry: {summary['registry']}")
    print(f"Manifest: {summary['manifest']}")
    print(f"Normalized JSON: {', '.join(summary['normalized_json'])}")
    print(f"Deployment covers: {summary['deployment_covers']} files in {summary['deployment_directory']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
