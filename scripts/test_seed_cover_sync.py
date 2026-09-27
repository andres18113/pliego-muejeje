"""Focused tests for applying prepared cover URLs through the ADMIN seed flow."""

from __future__ import annotations

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

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        if method == "GET":
            return {"items": self.editions}
        self.updates.append((path, body or {}))
        return None


class SeedCoverSyncTests(unittest.TestCase):
    def test_manifest_maps_any_number_of_permanent_skus_without_hardcoded_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "manifest.json"
            records = []
            for number in (1, 2, 3, 1_000_000):
                sku = f"PLG-BK-{number:06d}"
                key = f"covers/editions/{sku}.webp"
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
            "https://covers.pliegolibros.com/covers/editions/PLG-BK-000003.webp",
        )
        self.assertIn("PLG-BK-1000000", covers)

    def test_sync_updates_existing_sku_and_preserves_unresolved_metadata(self) -> None:
        sku = "PLG-BK-000001"
        url = f"https://covers.pliegolibros.com/covers/editions/{sku}.webp"
        covers = {
            sku: {"coverUrl": url, "isbn13": "9780000000001"},
            "PLG-BK-000002": {
                "coverUrl": "https://covers.pliegolibros.com/covers/editions/PLG-BK-000002.webp",
                "isbn13": "9780000000002",
            },
            "PLG-BK-000003": {
                "coverUrl": "https://covers.pliegolibros.com/covers/editions/PLG-BK-000003.webp",
                "isbn13": "9780000000003",
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
            "coverLicense": None,
            "coverSourceUrl": None,
            "coverAttribution": None,
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
        }]
        api = FakeApi(editions)

        result = seed_module.sync_cover_manifest(api, covers)

        self.assertEqual(result, {"updated": 1, "skipped": 1, "unmatched": 1})
        self.assertEqual(len(api.updates), 1)
        self.assertEqual(api.updates[0][0], "/api/v1/admin/editions/41")
        self.assertEqual(api.updates[0][1]["coverUrl"], url)
        self.assertIsNone(api.updates[0][1]["coverLicense"])
        self.assertIsNone(api.updates[0][1]["coverSourceUrl"])
        self.assertIsNone(api.updates[0][1]["coverAttribution"])


if __name__ == "__main__":
    unittest.main()
