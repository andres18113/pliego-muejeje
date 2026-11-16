#!/usr/bin/env python3
"""Genera JPEG locales para correo y su mapa classpath, sin acceso a la red."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
from pathlib import Path, PurePosixPath

from PIL import Image, ImageCms, ImageOps

from cover_catalog import write_bytes, write_json
from cover_images import SRGB

CDN = "https://covers.pliegolibros.com/"
EMAIL_PREFIX = "covers/editions/email-v1/"
WIDTH = 168
QUALITY = 85
WEBP_KEY = re.compile(r"covers/editions/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.webp")


def published_keys(covers_root: Path) -> list[str]:
    """Union of publication manifests, including still-public historical objects.

    Proposed/pending batches count only when explicitly marked PUBLISHED.
    Generated rendition manifests use another schema and cannot feed this input.
    """
    keys = set()
    destinations = {}
    for path in sorted(covers_root.rglob("*manifest*.json")):
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if (not isinstance(manifest, dict) or manifest.get("schema") != "pliego-cover-manifest-v1"
                or manifest.get("publication_status") not in (None, "PUBLISHED")):
            continue
        # A proposal without an explicit publication status is not publication evidence.
        if any(word in path.name for word in ("proposed", "pending")) and manifest.get("publication_status") != "PUBLISHED":
            continue
        if not isinstance(manifest.get("records"), list):
            raise ValueError(f"Manifiesto sin registros válidos: {path}")
        for row in manifest["records"]:
            key = row.get("r2_object_key") if isinstance(row, dict) else None
            if not isinstance(key, str) or not WEBP_KEY.fullmatch(key):
                raise ValueError(f"Clave WebP inválida en {path}: {key}")
            if row.get("cover_url", CDN + key) != CDN + key:
                raise ValueError(f"URL de portada incoherente: {key}")
            destination = EMAIL_PREFIX + PurePosixPath(key).stem + ".jpg"
            if destination in destinations and destinations[destination] != key:
                raise ValueError(f"Dos claves comparten el nombre JPEG: {key}, {destinations[destination]}")
            destinations[destination] = key
            keys.add(key)
    if not keys:
        raise ValueError("No se encontraron claves en los manifiestos de publicación.")
    return sorted(keys)


def local_sources(covers_root: Path, keys: list[str]) -> dict[str, Path]:
    sources = {}
    expected = set(keys)
    for path in sorted((covers_root / "generated").rglob("*.webp")):
        _, separator, suffix = path.as_posix().rpartition("/covers/editions/")
        key = "covers/editions/" + suffix
        if not separator or key not in expected:
            continue
        if not path.resolve().is_relative_to(covers_root.resolve()):
            raise ValueError(f"La fuente sale de la carpeta local: {key}")
        if key in sources and sources[key].read_bytes() != path.read_bytes():
            raise ValueError(f"Copias locales diferentes para la misma clave: {key}")
        sources[key] = path
    return sources


def jpeg_bytes(source: Path) -> tuple[bytes, int]:
    with Image.open(source) as opened:
        if opened.format != "WEBP" or getattr(opened, "n_frames", 1) != 1:
            raise ValueError(f"Se requiere una portada WebP estática: {source}")
        opened.load()
        image = ImageOps.exif_transpose(opened)
        alpha = image.convert("RGBA").getchannel("A")
        profile = image.info.get("icc_profile")
        rgb = image.convert("RGB")
        if profile:
            rgb = ImageCms.profileToProfile(rgb, ImageCms.ImageCmsProfile(io.BytesIO(profile)), SRGB, outputMode="RGB")
        # Published untagged covers are sRGB, as produced by cover_images.
        white = Image.new("RGB", image.size, "white")
        white.paste(rgb, mask=alpha)
        height = max(1, round(image.height * WIDTH / image.width))
        output = white.resize((WIDTH, height), Image.Resampling.LANCZOS)
        output.info.clear()
        stream = io.BytesIO()
        output.save(stream, format="JPEG", quality=QUALITY, progressive=False, optimize=True,
                    exif=b"", icc_profile=None)
        return stream.getvalue(), height


def generate_renditions(covers_root: Path, output_root: Path, mapping_path: Path) -> dict:
    keys = published_keys(covers_root)
    sources = local_sources(covers_root, keys)
    records = []
    mapping = {}
    missing = sorted(set(keys) - sources.keys())
    for key in keys:
        if key not in sources:
            continue
        data, height = jpeg_bytes(sources[key])
        destination = EMAIL_PREFIX + PurePosixPath(key).stem + ".jpg"
        write_bytes(output_root / destination, data)
        records.append({"r2_object_key": destination, "source_webp_key": key, "size": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(), "width": WIDTH, "height": height})
        mapping[CDN + key] = CDN + destination
    manifest = {"schema": "pliego-email-cover-renditions-v1", "source_count": len(keys),
                "missing_source_keys": missing, "records": records}
    write_json(output_root / "manifest.json", manifest)
    write_json(mapping_path, mapping)
    return manifest


def main(argv: list[str] | None = None) -> int:
    repository = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--covers-root", type=Path, default=repository / "covers")
    parser.add_argument("--output-dir", type=Path, default=repository / "covers/generated/email-v1")
    parser.add_argument("--mapping", type=Path, default=repository / "backend/src/main/resources/notifications/email-cover-renditions.json")
    args = parser.parse_args(argv)
    try:
        manifest = generate_renditions(args.covers_root, args.output_dir, args.mapping)
    except (OSError, ValueError, ImageCms.PyCMSError) as error:
        print(f"No se pudieron generar las portadas para correo: {error}", file=sys.stderr)
        return 1
    print(f"Claves publicadas: {manifest['source_count']}; JPEG generados: {len(manifest['records'])}; fuentes ausentes: {len(manifest['missing_source_keys'])}")
    for key in manifest["missing_source_keys"]:
        print(f"Fuente ausente: {key}", file=sys.stderr)
    return 2 if manifest["missing_source_keys"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
