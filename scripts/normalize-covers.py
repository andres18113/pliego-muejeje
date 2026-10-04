#!/usr/bin/env python3
"""Normalize staged WebP covers safely; existing immutable objects are preserved by default."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from PIL import Image
from pathlib import Path

from cover_catalog import EXCLUDED_SKUS, pipeline_lock, read_manifest, sync_generated_json, write_bytes, write_json
from cover_images import (CoverRejected, MAX_BYTES, QUALITIES, TARGET_H, TARGET_W,
                          encode_webp, initial_report, normalize_file, normalize_image)

PUBLIC_BASE_URL = "https://covers.pliegolibros.com"
VERSION_PREFIX = "covers/editions/v2"
WEBP_QUALITY = 86


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_overrides(covers_root: Path) -> dict:
    path = covers_root / "normalization-overrides.json"
    overrides = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if not isinstance(overrides, dict) or any(not isinstance(v, dict) for v in overrides.values()):
        raise ValueError("normalization-overrides.json debe contener objetos por SKU.")
    return overrides


def save_webp(image, path: Path) -> dict:
    data, details = encode_webp(image, initial_report())
    write_bytes(path, data)
    return details


def normalize_manifest(covers_root: Path, manifest_path: Path, output_root: Path,
                       output_manifest: Path, report_path: Path, *, renormalize_existing=False,
                       overrides: dict | None = None) -> dict:
    root = covers_root.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "pliego-cover-manifest-v1" or not isinstance(manifest.get("records"), list):
        raise ValueError("El manifiesto de entrada no es válido.")
    previous = read_manifest(output_manifest)
    published = {r["permanent_sku"]: r for r in previous["records"] if r["permanent_sku"] not in EXCLUDED_SKUS}
    reports, excluded, seen = [], [], set()
    for record in manifest["records"]:
        if (not isinstance(record, dict) or not isinstance(record.get("permanent_sku"), str)
                or not re.fullmatch(r"PLG-BK-\d{6,}", record["permanent_sku"])
                or not isinstance(record.get("original_file"), str) or not isinstance(record.get("title"), str)):
            raise ValueError("El manifiesto contiene un registro inválido.")
        sku = record["permanent_sku"]
        if sku in seen:
            raise ValueError(f"SKU duplicado: {sku}")
        seen.add(sku)
        if sku in EXCLUDED_SKUS:
            excluded.append({"sku": sku, "reason": "Exclusión histórica"})
            continue
        item = {**initial_report(), "sku": sku, "source": record["original_file"], "title": record["title"]}
        if sku in published and not renormalize_existing:
            final_path = output_root / published[sku]["r2_object_key"]
            if not final_path.is_file():
                raise ValueError(f"Objeto publicado ausente: {final_path}")
            final_bytes = final_path.read_bytes()
            digest = hashlib.sha256(final_bytes).hexdigest()
            if not final_path.name.endswith(f"-{digest[:12]}.webp"):
                raise ValueError(f"El hash del objeto preservado no coincide: {final_path}")
            with Image.open(final_path) as image:
                image.load()
                if image.format != "WEBP" or getattr(image, "n_frames", 1) != 1:
                    raise ValueError(f"El objeto preservado no es WebP estático: {final_path}")
                final_size = {"width":image.width,"height":image.height}
            source = (root / record["original_file"]).resolve()
            if source.is_relative_to(root) and source.is_file():
                with Image.open(source) as image:
                    item["original_size"] = {"width":image.width,"height":image.height}
            reports.append({**item, "status": "ACEPTADO", "reason": "Objeto inmutable existente preservado; no se renormalizó", "preserved": True,
                            "normalized_size":final_size,"bytes":len(final_bytes),"sha256":digest,
                            "output": published[sku]["r2_object_key"]})
            continue
        try:
            source = (root / record["original_file"]).resolve()
            if not source.is_relative_to(root) or source.suffix.lower() != ".webp":
                raise CoverRejected("ARCHIVO_INVALIDO", "original_file debe ser un WebP de staging dentro de covers.", item)
            data, details = normalize_file(source, (overrides or {}).get(sku))
            key = f"{VERSION_PREFIX}/{sku}-{details['sha256'][:12]}.webp"
            path = output_root / key
            if path.exists() and path.read_bytes() != data:
                raise ValueError(f"Colisión de objeto inmutable: {key}")
            write_bytes(path, data)
            published[sku] = {**record, "r2_object_key": key, "cover_url": f"{PUBLIC_BASE_URL}/{key}"}
            reports.append({**item, **details, "output": key})
        except CoverRejected as error:
            reports.append({**item, **error.details})
    result = {"schema": "pliego-cover-manifest-v1", "records": sorted(published.values(), key=lambda r:r["permanent_sku"])}
    write_json(output_manifest, result)
    sync_generated_json(root, result["records"])
    report = {"schema": "pliego-cover-normalization-v4", "target": {"width": TARGET_W, "height": TARGET_H,
              "aspect_ratio": "2:3", "format": "webp", "qualities": list(QUALITIES), "maximum_bytes": MAX_BYTES},
              "excluded": excluded, "records": reports,
              "summary": {"accepted": sum(r["status"] == "ACEPTADO" for r in reports),
                          "pending": sum(r["status"] != "ACEPTADO" for r in reports)}}
    write_json(report_path, report)
    return report


def main() -> int:
    repo = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--covers-dir", type=Path, default=repo / "covers")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--output-manifest", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--renormalize-existing", action="store_true", help="Explicitly regenerate existing covers at new immutable keys.")
    args = parser.parse_args()
    root = args.covers_dir.resolve()
    with pipeline_lock(root):
        report = normalize_manifest(root, args.manifest or root / "generated/manifest.json",
            args.output_dir or root / "generated/r2-normalized", args.output_manifest or root / "generated/manifest-normalized.json",
            args.report or root / "generated/normalization-report.json", renormalize_existing=args.renormalize_existing,
            overrides=load_overrides(root))
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 2 if report["summary"]["pending"] else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
