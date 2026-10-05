"""Focused tests for applying prepared cover URLs through the ADMIN seed flow."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

from fixtures.catalog_helpers import RETIRED_DIGITAL_SKUS, RETIRED_PHYSICAL_SKUS, physical_catalog


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
    def test_prepared_digital_replay_preserves_curated_synopses(self) -> None:
        root = Path(__file__).resolve().parents[1] / 'covers'
        active = {}
        for path in seed_module.discover_staging(root):
            for row in json.loads(path.read_text())['libros']:
                if row['edicion'].get('formato') in {'EBOOK', 'AUDIOBOOK'}:
                    active[row['edicion']['sku']] = row
        prepared = {}
        for path in (root / 'generated/digital-batch/editions/staging').rglob('staging.json'):
            for row in json.loads(path.read_text())['libros']:
                prepared[row['edicion']['sku']] = row
        self.assertTrue(active)
        self.assertTrue(set(active).issubset(prepared))
        for sku, row in active.items():
            with self.subTest(sku=sku):
                self.assertEqual(prepared[sku]['libro']['sinopsis'], row['libro']['sinopsis'])
                self.assertEqual(prepared[sku]['preparacion'].get('synopsis_provenance'),
                                 row['preparacion'].get('synopsis_provenance'))


    def test_stockless_digital_staging_without_isbn_preserves_registry_and_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "categoria-sintetica/staging.json"
            source.parent.mkdir()
            registry_path = root / "sku-registry.json"
            registry = {"assignments": []}
            covers = {}
            document = {"libros": []}
            reference = {"libro": {"titulo": "Obra sintética", "autores": [{"nombre": "Autora", "orden": 1}],
                                   "categorias": ["Categoría Sintética"], "sinopsis": None},
                         "edicion": {"editorial": "Editorial de prueba", "idioma": "es"}}
            for number, format_name in [(900_001, "EBOOK"), (900_002, "AUDIOBOOK")]:
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
                    "source_keys": [f"categoria-sintetica/{source.name}#{record['portadaArchivo']}"]})
                covers[sku] = {"isbn13": None, "title": reference["libro"]["titulo"],
                    "coverUrl": f"https://covers.pliegolibros.com/covers/editions/v2/{sku}-0123456789ab.webp"}
            source.write_text(json.dumps(document))
            registry_path.write_text(json.dumps(registry))
            seeds = seed_module.load_catalog_seeds(covers, registry_path, (source,))
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
        self.assertEqual(set(covers), {record["permanent_sku"] for record in records}
                         - seed_module.EXCLUDED_CATALOG_SKUS)
        self.assertEqual(len(records), len({record["permanent_sku"] for record in records}))
        self.assertNotIn("PLG-BK-000042", covers)
        self.assertTrue(all("/covers/editions/v2/" in cover["coverUrl"] for cover in covers.values()))
        for record in records:
            if record["permanent_sku"] == "PLG-BK-000042":
                continue
            self.assertEqual(
                covers[record["permanent_sku"]]["coverUrl"],
                record["cover_url"],
            )

    def test_isolated_physical_staging_maps_by_fallback_identity_and_sku(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            staging = physical_catalog(root)
            covers = seed_module.load_cover_manifest(root / "generated/manifest-normalized.json")
            seeds = seed_module.load_catalog_seeds(covers, root / "sku-registry.json", (staging,))
            records = json.loads(staging.read_text())["libros"]
            assignments = json.loads((root / "sku-registry.json").read_text())["assignments"]
            sku_by_source = {source: assignment["sku"] for assignment in assignments
                             for source in assignment["source_keys"]}
            expected = {}
            for record in records:
                key = f"{staging.relative_to(root).as_posix()}#{record['portadaArchivo']}"
                sku = sku_by_source[key]
                if sku not in seed_module.EXCLUDED_CATALOG_SKUS:
                    expected[sku] = record
            self.assertEqual({seed.sku for seed in seeds}, set(expected))
            self.assertEqual(set(covers), set(expected))
            self.assertEqual({seed.format for seed in seeds}, {"PAPERBACK", "HARDCOVER"})
            for seed in seeds:
                self.assertIsNone(seed.isbn13)
                self.assertEqual(seed.title, expected[seed.sku]["libro"]["titulo"])
                self.assertEqual(seed.cover_url, covers[seed.sku]["coverUrl"])
                self.assertGreaterEqual(seed.stock, seed_module.LOCAL_DEVELOPMENT_MINIMUM_STOCK)
            self.assertNotIn("PLG-BK-000042", {seed.sku for seed in seeds})

    def test_retired_historical_digital_records_and_sku_assignments_remain_unchanged(self) -> None:
        baseline = json.loads(Path(__file__).with_name("fixtures").joinpath("prior-cover-catalog.json").read_text())
        manifest = json.loads(seed_module.DEFAULT_COVER_MANIFEST.read_text())
        registry = json.loads(seed_module.DEFAULT_SKU_REGISTRY.read_text())
        retired_manifest = json.loads((seed_module.DEFAULT_SKU_REGISTRY.parent / "retired-manifest.json").read_text())
        retired = {record["permanent_sku"]: record for record in retired_manifest["records"]}
        records = {record["permanent_sku"]: record for record in manifest["records"]}
        assignments = {assignment["sku"]: assignment for assignment in registry["assignments"]}
        self.assertEqual(len(assignments), len(registry["assignments"]))
        self.assertEqual(len(records), len(manifest["records"]))
        # User-requested removal is an identity exception, not a global count adjustment.
        retired_digital = RETIRED_DIGITAL_SKUS
        self.assertTrue(retired_digital.issubset(baseline["digital_manifest_sha256"]))
        self.assertEqual(set(retired), set(baseline["historical_manifest_sha256"])
                         | retired_digital | RETIRED_PHYSICAL_SKUS)
        self.assertEqual(len(retired), len(retired_manifest["records"]))
        self.assertTrue(set(retired).isdisjoint(records))
        self.assertTrue(set(retired).issubset(assignments))
        for group, current in (("historical_manifest_sha256", retired),
                               ("digital_manifest_sha256", records | retired),
                               ("prior_registry_sha256", assignments)):
            for sku, expected_digest in baseline[group].items():
                with self.subTest(group=group, sku=sku):
                    self.assertIn(sku, current)
                    digest = hashlib.sha256(json.dumps(current[sku], sort_keys=True, ensure_ascii=False,
                                                       separators=(",", ":")).encode()).hexdigest()
                    self.assertEqual(digest, expected_digest)
        self.assertTrue(set(records).issubset(assignments))
        self.assertEqual({sku for sku, record in records.items()
                          if record.get("format") in {"EBOOK", "AUDIOBOOK"}},
                         set(baseline["digital_manifest_sha256"]) - retired_digital)
        self.assertEqual(retired["PLG-BK-000196"]["format"], "AUDIOBOOK")
        self.assertEqual(retired["PLG-BK-000196"]["title"], "24 ideas para una psicoterapia breve (2a. ed.)")
        identities = {}
        sources = {}
        for sku, assignment in assignments.items():
            self.assertTrue(assignment["identity_keys"])
            for key in assignment["identity_keys"]:
                self.assertNotIn(key, identities, f"Identidad duplicada: {key}")
                identities[key] = sku
            for source in assignment["source_keys"]:
                self.assertNotIn(source, sources, f"Fuente duplicada: {source}")
                sources[source] = sku
        self.assertIn("PLG-BK-000042", assignments)
        self.assertNotIn("PLG-BK-000042", records)
        for sku, record in records.items():
            if record.get("isbn13"):
                self.assertEqual(identities[f"isbn13:{record['isbn13']}"], sku)
            else:
                self.assertTrue(any(key.startswith("fallback:") for key in assignments[sku]["identity_keys"]))
            self.assertIn(record.get("format", "PAPERBACK"), {"PAPERBACK", "HARDCOVER", "EBOOK", "AUDIOBOOK"})

    def test_generic_seed_rejects_real_specialized_digital_staging(self) -> None:
        root = seed_module.DEFAULT_SKU_REGISTRY.parent
        covers = seed_module.load_cover_manifest(seed_module.DEFAULT_COVER_MANIFEST)
        files = [path for path in seed_module.discover_staging(root)
                 if path.relative_to(root).parts[0] in {"Ebook", "Audiolibros"}]
        self.assertTrue(files)
        digital_skus = set()
        for path in files:
            document = json.loads(path.read_text())
            with self.subTest(staging=path.relative_to(root)):
                with self.assertRaisesRegex(seed_module.ApiError, "importador.*DEMO"):
                    seed_module.load_catalog_seeds(covers, seed_module.DEFAULT_SKU_REGISTRY, (path,))
                for row in document["libros"]:
                    edition = row["edicion"]
                    synopsis = row["libro"]["sinopsis"]
                    self.assertIsInstance(synopsis, str)
                    self.assertTrue(synopsis.strip())
                    self.assertNotRegex(synopsis, r"(?i)\b(?:DEMO|SIMULATED)\b")
                    self.assertIn(edition["formato"], {"EBOOK", "AUDIOBOOK"})
                    self.assertIsNone(edition["isbn13"])
                    self.assertIn(edition["sku"], covers)
                    self.assertNotIn(edition["sku"], digital_skus)
                    digital_skus.add(edition["sku"])
        manifest = json.loads(seed_module.DEFAULT_COVER_MANIFEST.read_text())
        self.assertEqual(digital_skus, {record["permanent_sku"] for record in manifest["records"]
                                       if record.get("format") in {"EBOOK", "AUDIOBOOK"}})

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
