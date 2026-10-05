"""Isolated physical input data for pipeline tests, unrelated to retired catalog books."""
import importlib.util
import json
from pathlib import Path

from PIL import Image, ImageDraw

from prepare_covers_loader import module as prepare


RETIRED_PHYSICAL_SKUS = {f"PLG-BK-{number:06d}" for number in (488, 442, 359, 411)}
RETIRED_DIGITAL_SKUS = {f"PLG-BK-{number:06d}" for number in (196, 100, 208, 85, 283, 144, 220, 244, 225, 118)}


def physical_catalog(root, *, include_digital=False):
    category = root / "categoria-fisica-sintetica"
    category.mkdir(parents=True, exist_ok=True)
    records, assignments = [], []
    formats = [(900001, "RUSTICA"), (900002, "TAPA_DURA"), (42, "RUSTICA")]
    if include_digital:
        formats.append((900003, "EBOOK"))
    for number, format_name in formats:
        filename = f"cover-{number}.webp"
        image = Image.new("RGB", (720, 1080), (25, 72, 125))
        ImageDraw.Draw(image).text((40, 60), f"SYNTHETIC {number}", fill="white")
        image.save(category / filename, format="WEBP")
        record = {
            "portadaArchivo": filename,
            "libro": {"titulo": f"Obra sintética {number}", "autores": [{"nombre": "Autora sintética", "orden": 1}],
                      "categorias": ["Categoría Física Sintética"], "sinopsis": None},
            "edicion": {"sku": None, "isbn13": None, "formato": format_name, "idioma": "es",
                        "editorial": "Editorial sintética", "paginas": None if format_name == "EBOOK" else 120,
                        "fechaPublicacion": None, "portada": {"url": None, "fuente": "archivo_local"}},
        }
        if format_name == "EBOOK":
            record["edicion"]["ebookFileFormat"] = "EPUB"
        records.append(record)
        assignments.append({"sku": f"PLG-BK-{number:06d}",
                            "identity_keys": [prepare._edition_identity(record, None)],
                            "source_keys": [f"{category.name}/staging.json#{filename}"]})
    staging = category / "staging.json"
    staging.write_text(json.dumps({"schema": "test", "libros": records}, ensure_ascii=False))
    (root / "sku-registry.json").write_text(json.dumps({"schema": prepare.REGISTRY_SCHEMA,
        "next_sequence": max(number for number, _ in formats) + 1, "assignments": assignments}))
    prepare.prepare_covers(root)
    script = Path(__file__).resolve().parents[1] / "normalize-covers.py"
    spec = importlib.util.spec_from_file_location("synthetic_physical_normalizer", script)
    normalizer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(normalizer)
    normalizer.normalize_manifest(root, root / "generated/manifest.json", root / "generated/r2-normalized",
                                  root / "generated/manifest-normalized.json", root / "generated/test-report.json")
    return staging
