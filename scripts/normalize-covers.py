#!/usr/bin/env python3
"""Normalize PLIEGO covers to 600x900 WebP assets with optional per-SKU overrides."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps


TARGET_W = 600
TARGET_H = 900
TARGET_RATIO = TARGET_W / TARGET_H

# If reaching 2:3 requires removing <= 5% of the image,
# automatic center crop is considered safe.
MAX_ASPECT_CROP = 0.05

WEBP_QUALITY = 86

PUBLIC_BASE_URL = "https://covers.pliegolibros.com"

# Existing R2 URLs are immutable, so normalized covers use v2.
VERSION_PREFIX = "covers/editions/v2"

OVERRIDES_FILE = "covers/normalization-overrides.json"

# PLG-BK-000042 = Apología de Sócrates.
# It is intentionally excluded.
EXCLUDED_SKUS = {
    "PLG-BK-000042",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)

    return digest.hexdigest()


def load_overrides(
    repository_root: Path,
) -> dict[str, dict[str, Any]]:
    path = repository_root / OVERRIDES_FILE

    if not path.exists():
        return {}

    try:
        data = json.loads(
            path.read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(
            f"Cannot read {OVERRIDES_FILE}: {error}"
        ) from None

    if not isinstance(data, dict):
        raise SystemExit(
            f"{OVERRIDES_FILE} must contain a JSON object"
        )

    for sku, config in data.items():
        if not isinstance(sku, str):
            raise SystemExit(
                "Override SKU keys must be strings"
            )

        if not isinstance(config, dict):
            raise SystemExit(
                f"{sku}: override must be an object"
            )

        mode = config.get("mode")

        if mode not in {"fill", "contain"}:
            raise SystemExit(
                f"{sku}: mode must be 'fill' or 'contain'"
            )

        for field in ("focalX", "focalY"):
            if field not in config:
                continue

            value = config[field]

            if (
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not 0.0 <= value <= 1.0
            ):
                raise SystemExit(
                    f"{sku}: {field} must be between 0 and 1"
                )

    return data


def crop_to_ratio_if_small(
    image: Image.Image,
) -> tuple[Image.Image, float, bool]:
    """
    Convert to 2:3 with a small center crop when doing so
    removes at most MAX_ASPECT_CROP of the source dimension.
    """

    width, height = image.size
    ratio = width / height

    if abs(ratio - TARGET_RATIO) < 1e-6:
        return image, 0.0, True

    if ratio > TARGET_RATIO:
        # Too wide.
        target_width = round(height * TARGET_RATIO)
        removed_fraction = (width - target_width) / width

        if removed_fraction <= MAX_ASPECT_CROP:
            left = (width - target_width) // 2

            return (
                image.crop(
                    (
                        left,
                        0,
                        left + target_width,
                        height,
                    )
                ),
                removed_fraction,
                True,
            )

    else:
        # Too tall / too narrow.
        target_height = round(width / TARGET_RATIO)
        removed_fraction = (height - target_height) / height

        if removed_fraction <= MAX_ASPECT_CROP:
            top = (height - target_height) // 2

            return (
                image.crop(
                    (
                        0,
                        top,
                        width,
                        top + target_height,
                    )
                ),
                removed_fraction,
                True,
            )

    return image, 0.0, False


def normalize_image(
    source: Path,
    override: dict[str, Any] | None = None,
) -> tuple[Image.Image, dict[str, Any]]:
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")

    original_width, original_height = image.size

    # Manual FILL override:
    # force the cover to fill 600x900 and crop around a chosen focal point.
    if override and override.get("mode") == "fill":
        focal_x = float(override.get("focalX", 0.5))
        focal_y = float(override.get("focalY", 0.5))

        normalized = ImageOps.fit(
            image,
            (TARGET_W, TARGET_H),
            method=Image.Resampling.LANCZOS,
            centering=(focal_x, focal_y),
        )

        return normalized, {
            "original_size": {
                "width": original_width,
                "height": original_height,
            },
            "normalized_size": {
                "width": TARGET_W,
                "height": TARGET_H,
            },
            "mode": "MANUAL_FILL",
            "padded": False,
            "focal_x": focal_x,
            "focal_y": focal_y,
            "status": "OVERRIDE",
        }

    # Manual CONTAIN override:
    # force complete artwork preservation even if auto crop would be possible.
    force_contain = bool(
        override
        and override.get("mode") == "contain"
    )

    image, crop_fraction, ratio_ok = crop_to_ratio_if_small(
        image
    )

    if ratio_ok and not force_contain:
        normalized = image.resize(
            (TARGET_W, TARGET_H),
            Image.Resampling.LANCZOS,
        )

        return normalized, {
            "original_size": {
                "width": original_width,
                "height": original_height,
            },
            "normalized_size": {
                "width": TARGET_W,
                "height": TARGET_H,
            },
            "mode": "CROP_OR_EXACT",
            "padded": False,
            "aspect_crop_fraction": round(
                crop_fraction,
                6,
            ),
            "status": "AUTO",
        }

    # Preserve complete artwork.
    contained = ImageOps.contain(
        image,
        (TARGET_W, TARGET_H),
        Image.Resampling.LANCZOS,
    )

    # Opaque white canvas.
    # Avoid transparency exposing the frontend background.
    normalized = Image.new(
        "RGB",
        (TARGET_W, TARGET_H),
        (255, 255, 255),
    )

    x = (TARGET_W - contained.width) // 2
    y = (TARGET_H - contained.height) // 2

    normalized.paste(
        contained,
        (x, y),
    )

    return normalized, {
        "original_size": {
            "width": original_width,
            "height": original_height,
        },
        "normalized_size": {
            "width": TARGET_W,
            "height": TARGET_H,
        },
        "mode": (
            "MANUAL_CONTAIN"
            if force_contain
            else "CONTAIN"
        ),
        "padded": True,
        "aspect_crop_fraction": 0.0,
        "status": (
            "OVERRIDE"
            if force_contain
            else "AUTO"
        ),
    }


def save_webp(
    image: Image.Image,
    path: Path,
) -> None:
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary = path.with_name(
        path.name + ".tmp"
    )

    image.save(
        temporary,
        format="WEBP",
        quality=WEBP_QUALITY,
        method=6,
    )

    temporary.replace(path)


def validate_source_path(
    covers_root: Path,
    original_file: str,
) -> Path:
    source = (
        covers_root / original_file
    ).resolve()

    try:
        source.relative_to(covers_root)
    except ValueError:
        raise RuntimeError(
            f"Unsafe source path: {original_file}"
        ) from None

    if not source.is_file():
        raise RuntimeError(
            f"Missing source cover: {original_file}"
        )

    if source.suffix.casefold() != ".webp":
        raise RuntimeError(
            f"Cover is not WebP: {original_file}"
        )

    return source


def main() -> int:
    repository_root = (
        Path(__file__).resolve().parent.parent
    )

    overrides = load_overrides(
        repository_root
    )

    parser = argparse.ArgumentParser(
        description=__doc__,
    )

    parser.add_argument(
        "--manifest",
        type=Path,
        default=repository_root
        / "covers/generated/manifest.json",
    )

    parser.add_argument(
        "--covers-dir",
        type=Path,
        default=repository_root
        / "covers",
    )

    parser.add_argument(
        "--output-dir",
        type=Path,
        default=repository_root
        / "covers/generated/r2-normalized",
    )

    parser.add_argument(
        "--output-manifest",
        type=Path,
        default=repository_root
        / "covers/generated/manifest-normalized.json",
    )

    parser.add_argument(
        "--report",
        type=Path,
        default=repository_root
        / "covers/generated/normalization-report.json",
    )

    parser.add_argument(
        "--clean",
        action="store_true",
    )

    args = parser.parse_args()

    try:
        manifest = json.loads(
            args.manifest.read_text(
                encoding="utf-8"
            )
        )
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(
            f"Cannot read manifest: {error}"
        ) from None

    records = manifest.get("records")

    if not isinstance(records, list):
        raise SystemExit(
            "Manifest must contain a records array"
        )

    covers_root = (
        args.covers_dir.resolve()
    )

    output_root = (
        args.output_dir.resolve()
    )

    if args.clean and output_root.exists():
        shutil.rmtree(output_root)

    normalized_records: list[dict[str, Any]] = []
    report_records: list[dict[str, Any]] = []
    excluded_records: list[dict[str, Any]] = []

    seen_skus: set[str] = set()

    for index, source_record in enumerate(records):
        if not isinstance(source_record, dict):
            raise SystemExit(
                f"Manifest record {index} must be an object"
            )

        record = json.loads(
            json.dumps(source_record)
        )

        sku = record.get(
            "permanent_sku"
        )

        title = record.get(
            "title"
        )

        original_file = record.get(
            "original_file"
        )

        if not isinstance(sku, str) or not sku:
            raise SystemExit(
                f"Manifest record {index} has no permanent_sku"
            )

        if sku in seen_skus:
            raise SystemExit(
                f"Duplicate permanent SKU: {sku}"
            )

        seen_skus.add(sku)

        if sku in EXCLUDED_SKUS:
            excluded_records.append(
                {
                    "sku": sku,
                    "title": title,
                    "reason": (
                        "Excluded from normalized catalog"
                    ),
                }
            )
            continue

        if (
            not isinstance(original_file, str)
            or not original_file
        ):
            raise SystemExit(
                f"{sku} has no original_file"
            )

        try:
            source = validate_source_path(
                covers_root,
                original_file,
            )
        except RuntimeError as error:
            raise SystemExit(
                str(error)
            ) from None

        normalized, details = normalize_image(
            source,
            overrides.get(sku),
        )

        temporary_output = (
            output_root
            / VERSION_PREFIX
            / f"{sku}.webp"
        )

        save_webp(
            normalized,
            temporary_output,
        )

        digest = sha256_file(
            temporary_output
        )

        # Hash is included in the name because CDN objects
        # are served with Cache-Control: immutable.
        final_name = (
            f"{sku}-{digest[:12]}.webp"
        )

        final_path = (
            temporary_output.parent
            / final_name
        )

        if final_path.exists():
            temporary_output.unlink()
        else:
            temporary_output.replace(
                final_path
            )

        object_key = (
            f"{VERSION_PREFIX}/{final_name}"
        )

        cover_url = (
            f"{PUBLIC_BASE_URL}/{object_key}"
        )

        record["r2_object_key"] = (
            object_key
        )

        record["cover_url"] = (
            cover_url
        )

        normalized_records.append(
            record
        )

        report_records.append(
            {
                "sku": sku,
                "title": title,
                "source": original_file,
                "output": object_key,
                "cover_url": cover_url,
                "sha256": digest,
                **details,
            }
        )

    normalized_manifest = {
        key: value
        for key, value in manifest.items()
        if key != "records"
    }

    normalized_manifest["records"] = (
        normalized_records
    )

    args.output_manifest.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    args.output_manifest.write_text(
        json.dumps(
            normalized_manifest,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    report = {
        "schema": "pliego-cover-normalization-v3",
        "target": {
            "width": TARGET_W,
            "height": TARGET_H,
            "aspect_ratio": "2:3",
            "format": "webp",
            "quality": WEBP_QUALITY,
        },
        "excluded": excluded_records,
        "records": report_records,
        "summary": {
            "source_records": len(records),
            "normalized": len(
                report_records
            ),
            "excluded": len(
                excluded_records
            ),
            "manual_fill": sum(
                item["mode"]
                == "MANUAL_FILL"
                for item in report_records
            ),
            "manual_contain": sum(
                item["mode"]
                == "MANUAL_CONTAIN"
                for item in report_records
            ),
            "crop_or_exact": sum(
                item["mode"]
                == "CROP_OR_EXACT"
                for item in report_records
            ),
            "contained": sum(
                item["mode"]
                == "CONTAIN"
                for item in report_records
            ),
        },
    }

    args.report.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    args.report.write_text(
        json.dumps(
            report,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(
        f"Source records: "
        f"{len(records)}"
    )

    print(
        f"Normalized: "
        f"{len(report_records)}"
    )

    print(
        f"Excluded: "
        f"{len(excluded_records)}"
    )

    for item in excluded_records:
        print(
            f"  - {item['sku']} | "
            f"{item.get('title')}"
        )

    print(
        f"Manual fill: "
        f"{report['summary']['manual_fill']}"
    )

    print(
        f"Manual contain: "
        f"{report['summary']['manual_contain']}"
    )

    print(
        f"Crop/exact: "
        f"{report['summary']['crop_or_exact']}"
    )

    print(
        f"Contained: "
        f"{report['summary']['contained']}"
    )

    print(
        f"Manifest: "
        f"{args.output_manifest}"
    )

    print(
        f"Report: "
        f"{args.report}"
    )

    print(
        f"Assets: "
        f"{args.output_dir}"
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
