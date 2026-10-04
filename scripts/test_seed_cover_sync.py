"""Focused tests for applying prepared cover URLs through the ADMIN seed flow."""

from __future__ import annotations

import copy
import shutil
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


SCRIPT = Path(__file__).with_name("seed-development-catalog.py")
SPEC = importlib.util.spec_from_file_location("seed_development_catalog", SCRIPT)
assert SPEC and SPEC.loader
seed_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = seed_module
SPEC.loader.exec_module(seed_module)


class FakeApi:
    def __init__(self, editions: list[dict[str, Any]]) -> None:
        self.editions = editions
        self.updates: list[tuple[str, dict[str, Any]]] = []

    def all_pages(self, path: str, **params: str) -> list[dict[str, Any]]:
        return self.editions

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        if method == "GET":
            return {"items": self.editions}
        self.updates.append((path, body or {}))
        return None


class SeedCoverSyncTests(unittest.TestCase):

    def test_stockless_digital_staging_without_isbn_preserves_registry_and_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sources = []
            for source in seed_module.DEFAULT_STAGING_FILES:
                target = root / source.parent.name / source.name
                target.parent.mkdir(parents=True)
                shutil.copyfile(source, target)
                sources.append(target)
            registry_path = root / "sku-registry.json"
            registry = json.loads(seed_module.DEFAULT_SKU_REGISTRY.read_text())
            covers = seed_module.load_cover_manifest(seed_module.DEFAULT_COVER_MANIFEST)
            source = sources[2]
            document = json.loads(source.read_text())
            reference = next(row for row in document["libros"] if row["libro"]["titulo"] == "Discurso del método")
            for number, format_name in [(57, "EBOOK"), (58, "AUDIOBOOK")]:
                record = copy.deepcopy(reference)
                record["portadaArchivo"] = f"digital-{format_name.lower()}.webp"
                record["edicion"].update(isbn13=None, sku=None, formato=format_name, paginas=None)
                if format_name == "EBOOK":
                    record["edicion"]["ebookFileFormat"] = "EPUB"
                else:
                    record["edicion"].update(audioDurationSeconds=3600, narrators=["Una voz", "Otra voz"])
                document["libros"].append(record)
                sku = f"PLG-BK-{number:06d}"
                registry["assignments"].append({"sku": sku, "identity_keys": [f"fallback:test-{format_name}"],
                    "source_keys": [f"Filosofia/{source.name}#{record['portadaArchivo']}"]})
                covers[sku] = {"isbn13": None, "title": reference["libro"]["titulo"],
                    "coverUrl": f"https://covers.pliegolibros.com/covers/editions/v2/{sku}-0123456789ab.webp"}
            source.write_text(json.dumps(document))
            registry_path.write_text(json.dumps(registry))
            seeds = seed_module.load_catalog_seeds(covers, registry_path, tuple(sources))
            digital = [seed for seed in seeds if seed.format in {"EBOOK", "AUDIOBOOK"}]
            self.assertEqual(len(digital), 2)
            self.assertTrue(all(seed.stock == 0 and seed.isbn13 is None and seed.page_count is None for seed in digital))
            self.assertEqual(digital[0].ebook_file_format, "EPUB")
            self.assertEqual(digital[1].narrators, ("Una voz", "Otra voz"))
            self.assertEqual(digital[1].audio_duration_seconds, 3600)

    def test_cover_sync_preserves_audiobook_metadata(self) -> None:
        sku = "PLG-BK-000058"
        edition = {"editionId": "58", "sku": sku, "bookTitle": "Obra", "publisherId": "8",
            "isbn13": None, "language": "es", "format": "AUDIOBOOK", "pageCount": None,
            "publicationDate": None, "price": "20.00", "coverUrl": None,
            "audioDurationSeconds": 3600, "narrators": ["Una voz", "Otra voz"]}
        api = FakeApi([edition])
        seed_module.sync_cover_manifest(api, {sku: {"coverUrl": "https://covers.pliegolibros.com/new.webp", "title": "Obra", "isbn13": None}})
        payload = api.updates[0][1]
        self.assertEqual(payload["audioDurationSeconds"], 3600)
        self.assertEqual(payload["narrators"], ["Una voz", "Otra voz"])
        self.assertIsNone(payload["pageCount"])

    def test_manifest_maps_any_number_of_permanent_skus_without_hardcoded_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "manifest.json"
            records = []
            for number in (1, 2, 3, 1_000_000):
                sku = f"PLG-BK-{number:06d}"
                key = f"covers/editions/v2/{sku}-{number:012x}.webp"
                records.append({
                    "permanent_sku": sku,
                    "isbn13": f"97800000000{number:02d}",
                    "r2_object_key": key,
                    "cover_url": f"https://covers.pliegolibros.com/{key}",
                })
            path.write_text(json.dumps({"schema": "test", "records": records}), encoding="utf-8")

            covers = seed_module.load_cover_manifest(path)

        self.assertEqual(len(covers), len(records))
        self.assertEqual(
            covers["PLG-BK-000003"]["coverUrl"],
            "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000003-000000000003.webp",
        )
        self.assertIn("PLG-BK-1000000", covers)

    def test_default_manifest_is_normalized_and_excludes_apologia(self) -> None:
        covers = seed_module.load_cover_manifest(seed_module.DEFAULT_COVER_MANIFEST)
        manifest = json.loads(seed_module.DEFAULT_COVER_MANIFEST.read_text(encoding="utf-8"))
        records = manifest["records"]

        self.assertEqual(seed_module.DEFAULT_COVER_MANIFEST.name, "manifest-normalized.json")
        self.assertEqual(len(covers), 55)
        self.assertNotIn("PLG-BK-000042", covers)
        self.assertTrue(all("/covers/editions/v2/" in cover["coverUrl"] for cover in covers.values()))
        for record in records:
            if record["permanent_sku"] == "PLG-BK-000042":
                continue
            self.assertEqual(
                covers[record["permanent_sku"]]["coverUrl"],
                record["cover_url"],
            )

    def test_real_staging_catalog_maps_all_eligible_entries_by_isbn_and_sku(self) -> None:
        covers = seed_module.load_cover_manifest(seed_module.DEFAULT_COVER_MANIFEST)
        seeds = seed_module.load_catalog_seeds(
            covers, seed_module.DEFAULT_SKU_REGISTRY, seed_module.DEFAULT_STAGING_FILES
        )

        self.assertEqual(len(seeds), 55)
        self.assertEqual({seed.sku for seed in seeds}, set(covers))
        self.assertTrue(all(seed.isbn13 and seed.title for seed in seeds))
        self.assertTrue(all(seed.stock >= seed_module.LOCAL_DEVELOPMENT_MINIMUM_STOCK for seed in seeds))
        self.assertNotIn("PLG-BK-000042", {seed.sku for seed in seeds})

    def test_exclusion_is_enforced_even_if_manifest_contains_the_sku(self) -> None:
        excluded_sku = "PLG-BK-000042"
        key = f"covers/editions/v2/{excluded_sku}-0123456789ab.webp"
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "manifest.json"
            path.write_text(json.dumps({"records": [{
                "permanent_sku": excluded_sku,
                "r2_object_key": key,
                "cover_url": f"https://covers.pliegolibros.com/{key}",
            }]}), encoding="utf-8")

            covers = seed_module.load_cover_manifest(path)

        self.assertEqual(covers, {})

    def test_sync_updates_existing_sku_and_preserves_unresolved_metadata(self) -> None:
        sku = "PLG-BK-000001"
        url = f"https://covers.pliegolibros.com/covers/editions/v2/{sku}-0123456789ab.webp"
        covers = {
            sku: {"coverUrl": url, "isbn13": "9780000000001", "title": "El retrato de Dorian Gray"},
            "PLG-BK-000002": {
                "coverUrl": "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000002-0123456789ac.webp",
                "isbn13": "9780000000002",
                "title": "El extranjero",
            },
            "PLG-BK-000003": {
                "coverUrl": "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000003-0123456789ad.webp",
                "isbn13": "9780000000003",
                "title": "No importado",
            },
            "PLG-BK-000042": {
                "coverUrl": "https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000042-0123456789ae.webp",
                "isbn13": "9789561120785",
                "title": "Apología de Sócrates",
            },
        }
        editions = [{
            "editionId": "41",
            "publisherId": "7",
            "sku": sku,
            "isbn13": "9780000000001",
            "language": "es",
            "format": "PAPERBACK",
            "pageCount": 120,
            "publicationDate": None,
            "price": "18.50",
            "coverUrl": None,
            "coverLicense": "CC_BY",
            "coverSourceUrl": "https://source.example.org/cover/one",
            "coverAttribution": "Editorial Uno",
            "state": "ACTIVE",
            "bookTitle": "El retrato de Dorian Gray",
        }, {
            "editionId": "42",
            "publisherId": "7",
            "sku": "PLG-BK-000002",
            "isbn13": "9780000000002",
            "language": "es",
            "format": "PAPERBACK",
            "pageCount": 120,
            "publicationDate": None,
            "price": "18.50",
            "coverUrl": covers["PLG-BK-000002"]["coverUrl"],
            "coverLicense": None,
            "coverSourceUrl": None,
            "coverAttribution": None,
            "state": "ACTIVE",
            "bookTitle": "El extranjero",
        }, {
            "editionId": "420",
            "publisherId": "7",
            "sku": "PLG-BK-000042",
            "isbn13": "9789561120785",
            "language": "es",
            "format": "PAPERBACK",
            "pageCount": 120,
            "publicationDate": None,
            "price": "18.50",
            "coverUrl": "https://covers.pliegolibros.com/covers/editions/PLG-BK-000042.webp",
            "coverLicense": None,
            "coverSourceUrl": None,
            "coverAttribution": None,
            "state": "ACTIVE",
            "bookTitle": "Apología de Sócrates",
        }]
        api = FakeApi(editions)

        result = seed_module.sync_cover_manifest(api, covers)

        self.assertEqual(result, {"updated": 1, "skipped": 1, "unmatched": 1, "excluded": 1})
        cover_update = next(update for update in api.updates if update[0] == "/api/v1/admin/editions/41")
        exclude_update = next(update for update in api.updates if update[0] == "/api/v1/admin/editions/420/status")
        self.assertEqual(cover_update[1]["coverUrl"], url)
        self.assertEqual(cover_update[1]["coverLicense"], "CC_BY")
        self.assertEqual(cover_update[1]["coverSourceUrl"], "https://source.example.org/cover/one")
        self.assertEqual(cover_update[1]["coverAttribution"], "Editorial Uno")
        self.assertEqual(exclude_update[1], {"state": "INACTIVE"})


if __name__ == "__main__":
    unittest.main()
