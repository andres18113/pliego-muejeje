"""Focused tests for cover validation and persistent SKU allocation."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any


SCRIPT = Path(__file__).with_name("prepare-covers.py")
SPEC = importlib.util.spec_from_file_location("prepare_covers", SCRIPT)
assert SPEC and SPEC.loader
prepare_covers_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare_covers_module)


def webp_bytes(label: bytes = b"image") -> bytes:
    payload = b"VP8 " + label
    return b"RIFF" + (len(payload) + 4).to_bytes(4, "little") + b"WEBP" + payload


def record(title: str, isbn13: str, cover: str, sku: str | None = "TEMP-001") -> dict[str, Any]:
    return {
        "portadaArchivo": cover,
        "libro": {
            "titulo": title,
            "subtitulo": None,
            "autores": [{"nombre": "Autora de prueba", "orden": 1}],
            "categorias": ["Categoría de prueba"],
        },
        "edicion": {
            "editorial": "Editorial de prueba",
            "isbn13": isbn13,
            "idioma": "es",
            "formato": "RUSTICA",
            "paginas": 120,
            "anioPublicacion": 2024,
            "fechaPublicacion": None,
            "sku": sku,
            "portada": {"url": None, "licencia": None, "fuente": "archivo_local", "atribucion": None},
        },
    }


def write_staging(category_dir: Path, records: list[dict[str, Any]]) -> Path:
    category_dir.mkdir(parents=True, exist_ok=True)
    path = category_dir / "staging.json"
    path.write_text(json.dumps({"schema": "test", "libros": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def output_snapshot(root: Path) -> dict[str, bytes]:
    tracked = [root / "sku-registry.json", *sorted((root / "generated").rglob("*"))]
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in tracked if path.is_file()
    }


class PrepareCoversTests(unittest.TestCase):

    def test_digital_editions_without_isbn_get_distinct_stable_skus(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "covers"
            category = root / "Literatura"
            category.mkdir(parents=True)
            rows = []
            for index, (format_name, voices) in enumerate([
                    ("EBOOK", []), ("AUDIOBOOK", ["Una voz"]), ("AUDIOBOOK", ["Otra voz"])]):
                filename = f"edition-{index}.webp"
                (category / filename).write_bytes(webp_bytes(f"cover-{index}".encode()))
                row = record("Misma obra", None, filename, sku=None)
                row["edicion"].update(formato=format_name, paginas=None, narrators=voices)
                if format_name == "EBOOK":
                    row["edicion"]["ebookFileFormat"] = "EPUB"
                else:
                    row["edicion"]["audioDurationSeconds"] = 3600
                rows.append(row)
            write_staging(category, rows)
            prepare_covers_module.prepare_covers(root)
            manifest = json.loads((root / "generated/manifest.json").read_text())
            self.assertEqual(len({row["permanent_sku"] for row in manifest["records"]}), 3)
            snapshot = output_snapshot(root)
            self.assertEqual(prepare_covers_module.prepare_covers(root)["new_skus"], 0)
            self.assertEqual(snapshot, output_snapshot(root))

    def test_validation_reports_missing_orphan_duplicate_and_conflicting_records(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "covers"
            category = root / "Mystery"
            category.mkdir(parents=True)
            (category / "orphan.webp").write_bytes(webp_bytes(b"orphan"))
            write_staging(category, [
                record("Alpha", "9789561120785", "missing.webp"),
                record("Beta", "9789561120785", "missing.webp"),
            ])

            scanned, _, _, report = prepare_covers_module.scan_dataset(root)
            self.assertEqual(len(scanned), 2)
            self.assertTrue(report["missing"])
            self.assertEqual(report["orphans"], ["Mystery/orphan.webp"])
            self.assertTrue(any("referenced by" in item for item in report["shared_content"]))
            self.assertTrue(any("ISBN13" in item for item in report["duplicates"]))
            self.assertTrue(any("conflicting record data" in item for item in report["conflicts"]))
            with self.assertRaises(prepare_covers_module.PreparationError):
                prepare_covers_module.prepare_covers(root)

    def test_rerun_keeps_skus_and_generated_bytes_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "covers"
            category = root / "Literatura"
            category.mkdir(parents=True)
            (category / "alpha.webp").write_bytes(webp_bytes())
            source_json = write_staging(category, [record("Alpha", "9789561120785", "alpha.webp")])
            original_json = source_json.read_bytes()
            original_webp = (category / "alpha.webp").read_bytes()

            first = prepare_covers_module.prepare_covers(root)
            first_snapshot = output_snapshot(root)
            second = prepare_covers_module.prepare_covers(root)
            second_snapshot = output_snapshot(root)

            self.assertEqual(first["assigned_sku_range"], "PLG-BK-000001..PLG-BK-000001")
            self.assertEqual(first["new_skus"], 1)
            self.assertEqual(second["new_skus"], 0)
            self.assertEqual(first_snapshot, second_snapshot)
            self.assertEqual(source_json.read_bytes(), original_json)
            self.assertEqual((category / "alpha.webp").read_bytes(), original_webp)

            manifest = json.loads((root / "generated/manifest.json").read_text(encoding="utf-8"))
            entry = manifest["records"][0]
            expected_url = f"https://covers.pliegolibros.com/{entry['r2_object_key']}"
            normalized = json.loads(
                (root / "generated/json/Literatura/staging.json").read_text(encoding="utf-8")
            )
            self.assertEqual(normalized["libros"][0]["edicion"]["sku"], entry["permanent_sku"])
            cover = normalized["libros"][0]["edicion"]["portada"]
            self.assertEqual(entry["cover_url"], expected_url)
            self.assertEqual(cover["url"], expected_url)
            self.assertIsNone(cover["licencia"])
            self.assertEqual(cover["fuente"], "archivo_local")
            self.assertIsNone(cover["atribucion"])

    def test_new_category_allocates_next_sku_without_changing_existing_assignment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "covers"
            old_category = root / "Literatura"
            old_category.mkdir(parents=True)
            (old_category / "alpha.webp").write_bytes(webp_bytes(b"alpha"))
            write_staging(old_category, [record("Alpha", "9789561120785", "alpha.webp")])
            prepare_covers_module.prepare_covers(root)
            old_sku = json.loads((root / "generated/manifest.json").read_text(encoding="utf-8"))["records"][0]["permanent_sku"]

            new_category = root / "Nueva categoría"
            new_category.mkdir()
            (new_category / "beta.webp").write_bytes(webp_bytes(b"beta"))
            write_staging(new_category, [record("Beta", "9780306406157", "beta.webp", "TEMP-002")])
            result = prepare_covers_module.prepare_covers(root)
            manifest = json.loads((root / "generated/manifest.json").read_text(encoding="utf-8"))
            skus_by_isbn = {entry["isbn13"]: entry["permanent_sku"] for entry in manifest["records"]}

            self.assertEqual(skus_by_isbn["9789561120785"], old_sku)
            self.assertEqual(skus_by_isbn["9780306406157"], "PLG-BK-000002")
            self.assertEqual(result["new_skus"], 1)
            self.assertEqual(result["categories"], 2)
            self.assertEqual(len(manifest["records"]), 2)
            for entry in manifest["records"]:
                self.assertEqual(entry["cover_url"], f"https://covers.pliegolibros.com/{entry['r2_object_key']}")


if __name__ == "__main__":
    unittest.main()
