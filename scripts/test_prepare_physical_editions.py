"""Physical preparation preserves source evidence and never invents identities."""
import copy
import csv
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

import prepare_covers_loader
from prepare_physical_editions import prepare_batch, prepare_record
from cover_catalog import metadata_errors


def snapshot(books=None, editions=None):
    return {"schema": "pliego-catalog-readonly-snapshot-v1", "complete": True,
            "scope": "ALL_STATES", "books": books or [], "editions": editions or []}


def fixture(identifier="DEMO-ISBN-FIS-0001"):
    row = {"categoria": "Filosofía", "titulo": "La razón y la memoria",
           "autor": "Pérez, Ana; Ruiz, Luis", "isbn": identifier,
           "descripcion": "DEMO: Descripción académica. [Precio DEMO en USD.]",
           "precio": "19.95", "nombre_archivo": "original.jpg",
           "fuente_portada": "https://example.org/catalog/101"}
    provenance = {"book_id": "101", "category": "Filosofía",
                  "relative_path": "Filosofía/original.jpg",
                  "source_catalog_url": row["fuente_portada"],
                  "fields": {key: {"value": value} for key, value in row.items()},
                  "observed_metadata": {"publisher": "Editorial documentada"},
                  "physical_catalog": {"status": "DEMO", "physical_availability_verified": False},
                  "digital_isbn": {"observed": "9786074483826", "used_as_print_isbn": False}}
    provenance["fields"]["isbn"].update(
        status="demo_identifier_not_isbn" if identifier.startswith("DEMO-") else "observed_print_isbn",
        observed_print_isbn=None if identifier.startswith("DEMO-") else identifier,
        observed_print_isbn_checksum_valid=not identifier.startswith("DEMO-"))
    return row, provenance


class PhysicalPreparationTests(unittest.TestCase):
    def test_demo_identifier_uses_null_isbn_and_supported_fallback(self):
        row, proof = fixture()
        record = prepare_record(row, proof, snapshot())
        self.assertIsNone(record["edicion"]["isbn13"])
        self.assertTrue(prepare_covers_loader.module._edition_identity(record, None).startswith("fallback:"))
        self.assertEqual(record["preparacion"]["source"]["inventory_identifier"], "DEMO-ISBN-FIS-0001")
        self.assertEqual(record["preparacion"]["source"]["provenance"], proof)

    def test_print_isbn_preserved_without_digital_isbn_substitution(self):
        row, proof = fixture("9786074483819")
        record = prepare_record(row, proof, snapshot())
        self.assertEqual(record["edicion"]["isbn13"], "9786074483819")

    def test_invalid_or_unproven_print_isbn_is_rejected(self):
        for identifier in ["9786074483810", "DEMO-OTHER-0001"]:
            row, proof = fixture(identifier)
            with self.subTest(identifier=identifier), self.assertRaises(ValueError):
                prepare_record(row, proof, snapshot())
        row, proof = fixture("9786074483819")
        proof["fields"]["isbn"]["observed_print_isbn"] = "9786074483826"
        with self.assertRaises(ValueError):
            prepare_record(row, proof, snapshot())

    def test_exact_ordered_authors_reuse_without_mutating_snapshot(self):
        row, proof = fixture()
        data = snapshot([{"bookId": "77", "title": row["titulo"], "subtitle": None,
                          "state": "ACTIVE", "authors": [{"name": "Ana Pérez", "order": 1},
                                                          {"name": "Luis Ruiz", "order": 2}]}])
        before = copy.deepcopy(data)
        record = prepare_record(row, proof, data)
        self.assertEqual(record["preparacion"]["work"]["action"], "REUSE_EXISTING_WORK")
        self.assertEqual(record["preparacion"]["work"]["bookId"], "77")
        self.assertEqual(record["libro"]["autores"][0]["nombre"], "Ana Pérez")
        self.assertEqual(data, before)

    def test_same_title_wrong_authors_remains_pending(self):
        row, proof = fixture()
        data = snapshot([{"bookId": "77", "title": row["titulo"], "subtitle": None,
                          "state": "ACTIVE", "authors": [{"name": "Otra persona", "order": 1}]}])
        record = prepare_record(row, proof, data)
        self.assertEqual(record["preparacion"]["work"]["action"], "PENDING_IDENTITY")
        self.assertIsNone(record["preparacion"]["work"]["bookId"])

    def test_primary_source_distinct_authorship_creates_separate_homonym_work(self):
        row, proof = fixture()
        proof["fields"]["autor"].update(status="observed_contributors_with_roles", source_url=row["fuente_portada"])
        proof["fields"]["titulo"].update(status="observed", source_url=row["fuente_portada"])
        data = snapshot([{"bookId": "77", "title": row["titulo"], "subtitle": None,
                          "state": "ACTIVE", "authors": [{"name": "Otra persona", "order": 1}]}])
        record = prepare_record(row, proof, data)
        self.assertEqual(record["preparacion"]["work"]["action"], "CREATE_NEW_WORK")
        self.assertIsNone(record["preparacion"]["work"]["bookId"])
        evidence = record["preparacion"]["work"]["evidence"]["primary_identity_resolution"]
        self.assertEqual(evidence["source_url"], row["fuente_portada"])
        self.assertTrue(evidence["confirmed_distinct_authorship"])

    def test_primary_source_does_not_merge_or_recreate_reordered_authors(self):
        row, proof = fixture()
        proof["fields"]["autor"].update(status="observed_contributors_with_roles", source_url=row["fuente_portada"])
        proof["fields"]["titulo"].update(status="observed", source_url=row["fuente_portada"])
        data = snapshot([{"bookId": "77", "title": row["titulo"], "subtitle": None,
                          "state": "ACTIVE", "authors": [{"name": "Luis Ruiz", "order": 1}, {"name": "Ana Pérez", "order": 2}]}])
        record = prepare_record(row, proof, data)
        self.assertEqual(record["preparacion"]["work"]["action"], "PENDING_IDENTITY")

    def test_required_missing_metadata_has_explicit_deterministic_demo_provenance(self):
        row, proof = fixture()
        proof["observed_metadata"].pop("publisher")
        first = prepare_record(row, proof, snapshot())
        self.assertEqual(first, prepare_record(row, proof, snapshot()))
        self.assertEqual(metadata_errors(first), [])
        self.assertEqual(first["edicion"]["formato"], "PAPERBACK")
        self.assertIn("DEMO", first["edicion"]["editorial"])
        for field in ["editorial", "idioma", "paginas", "formato", "inventarioInicial", "precio"]:
            evidence = first["preparacion"]["field_provenance"]["edicion." + field]
            self.assertEqual(evidence["kind"], "SIMULATED/DEMO")
            self.assertFalse(evidence["real_source_claim"])
        self.assertEqual(first["edicion"]["inventarioInicial"], 10)
        self.assertIn("SIMULATED/DEMO", first["libro"]["sinopsis"])
        self.assertIsNone(first["edicion"]["sku"])
        self.assertIsNone(first["edicion"]["portada"]["licencia"])

    def test_real_publisher_evidence_is_preserved(self):
        row, proof = fixture()
        record = prepare_record(row, proof, snapshot())
        self.assertEqual(record["edicion"]["editorial"], "Editorial documentada")
        self.assertEqual(record["preparacion"]["field_provenance"]["edicion.editorial"]["kind"], "REAL_SOURCE")

    def test_unknown_category_and_incomplete_snapshot_are_rejected(self):
        row, proof = fixture()
        row["categoria"] = "Prueba desconocida"
        with self.assertRaises(ValueError):
            prepare_record(row, proof, snapshot())
        row, proof = fixture()
        data = snapshot(); data["complete"] = False
        with self.assertRaises(ValueError):
            prepare_record(row, proof, data)

    def source_fixture(self, root):
        row, proof = fixture()
        original = root / "Filosofía" / row["nombre_archivo"]
        original.parent.mkdir(parents=True)
        Image.new("RGB", (32, 48), (39, 121, 80)).save(original, format="JPEG")
        proof["image"] = {"sha256": hashlib.sha256(original.read_bytes()).hexdigest(),
                          "width": 32, "height": 48, "original_bytes_preserved": True}
        with (root / "inventario_fisicos.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(row)); writer.writeheader(); writer.writerow(row)
        (root / "metadata_provenance.json").write_text(json.dumps({"records": [proof]}))
        return row, proof, original

    def test_batch_preserves_original_bytes_and_lossless_webp_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / "source"; source.mkdir()
            row, proof, original = self.source_fixture(source)
            before = original.read_bytes()
            report = prepare_batch(source, snapshot(), root / "output")
            self.assertEqual(report["records"], 1)
            self.assertEqual(report["work_actions"], {"CREATE_NEW_WORK": 1})
            staged = json.loads((root / "output/Filosofía/staging.json").read_text())["libros"][0]
            converted = root / "output/Filosofía" / staged["portadaArchivo"]
            with Image.open(original) as first, Image.open(converted) as second:
                self.assertEqual(first.convert("RGB").tobytes(), second.convert("RGB").tobytes())
            preserved = root / "output" / staged["preparacion"]["source"]["original_path"]
            self.assertEqual(preserved.read_bytes(), before)
            self.assertEqual(original.read_bytes(), before)
            self.assertEqual(staged["preparacion"]["source"]["cover_sha256"], hashlib.sha256(converted.read_bytes()).hexdigest())

    def test_corrupt_original_rejected_before_output_is_created(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / "source"; source.mkdir()
            row, proof, original = self.source_fixture(source)
            original.write_bytes(b"unexpected changes")
            with self.assertRaises(ValueError):
                prepare_batch(source, snapshot(), root / "output")
            self.assertFalse((root / "output").exists())


if __name__ == "__main__":
    unittest.main()
