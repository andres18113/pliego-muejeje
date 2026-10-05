"""Preparation must not merge approximate identities or promote incomplete data."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import sys
import unittest

from PIL import Image

from prepare_digital_editions import (
    resolve_work, prepare_record, propose_skus, readiness_errors, validate_snapshot,
)


def snapshot(books=None):
    books = books or []
    return {"schema": "pliego-catalog-readonly-snapshot-v1", "complete": True,
            "scope": "ALL_STATES", "book_count": len(books), "books": books,
            "edition_count": 0, "editions": [], "authors_count": 0, "authors": [],
            "categories_count": 0, "categories": [], "publisher_count": 0, "publishers": []}


def book(title="Matemática estructural", author="Andrés Forero Cuervo", ident=72):
    return {"book_id": ident, "title": title, "subtitle": None, "synopsis": None,
            "state": "ACTIVE", "authors_json": [{"authorId": 74, "name": author, "order": 1}],
            "categories_json": [], "created_at": None, "updated_at": None, "total_count": 1}


def record(fmt="EBOOK"):
    return {"portadaArchivo": "portadas/example.webp",
            "libro": {"titulo": "Matemática estructural", "subtitulo": None, "sinopsis": None,
                      "autores": [{"nombre": "Forero Cuervo, Andrés", "orden": 1}], "categorias": ["Matemáticas"]},
            "edicion": {"editorial": None, "idioma": None, "formato": fmt, "isbn13": None,
                        "paginas": None, "precio": None, "sku": None, "inventarioInicial": None,
                        "ebookFileFormat": None, "audioDurationSeconds": None, "narrators": [],
                        "fechaPublicacion": None, "portada": {"url": None, "licencia": None,
                        "fuente": "https://example.org/title/42", "atribucion": None}}}


class DigitalPreparationTests(unittest.TestCase):
    def test_development_seed_refuses_pending_preparation_instead_of_defaulting_price(self):
        spec = importlib.util.spec_from_file_location("digital_preparation_seed_gate", Path(__file__).with_name("seed-development-catalog.py"))
        seed = importlib.util.module_from_spec(spec); sys.modules[spec.name] = seed; spec.loader.exec_module(seed)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            registry = root / "sku-registry.json"; registry.write_text(json.dumps({"assignments": []}))
            staging = root / "staging.json"; staging.write_text(json.dumps({"publication_status": "PENDING", "libros": []}))
            with self.assertRaisesRegex(seed.ApiError, "staging digital pendiente"):
                seed.load_catalog_seeds({}, registry, (staging,))

    def test_complete_all_states_snapshot_is_required_before_new_work(self):
        for field, value in [("complete", False), ("scope", "ACTIVE_ONLY"), ("book_count", 1)]:
            data = snapshot(); data[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_snapshot(data)

    def test_exact_title_and_inverted_bibliographic_name_reuse_existing_work(self):
        result = resolve_work(record()["libro"], snapshot([book()]))
        self.assertEqual(result["action"], "REUSE_EXISTING_WORK")
        self.assertEqual(result["bookId"], "72")
        self.assertEqual(result["matched_author_names"], ["Andrés Forero Cuervo"])

    def test_same_title_different_authors_remains_ambiguous(self):
        source = record()["libro"]; source["autores"][0]["nombre"] = "Otra persona"
        result = resolve_work(source, snapshot([book()]))
        self.assertEqual(result["action"], "PENDING_IDENTITY")
        self.assertIsNone(result["bookId"])

    def test_duplicate_exact_matches_are_not_selected_arbitrarily(self):
        result = resolve_work(record()["libro"], snapshot([book(), book(ident=73)]))
        self.assertEqual(result["action"], "PENDING_IDENTITY")

    def test_orthographic_variant_is_flagged_and_never_merged(self):
        source = record()["libro"]; source["titulo"] = "Matematica estructural"
        result = resolve_work(source, snapshot([book()]))
        self.assertEqual(result["action"], "PENDING_IDENTITY")
        self.assertIsNone(result["bookId"])

    def test_absent_title_in_complete_catalog_proposes_new_work(self):
        result = resolve_work(record()["libro"], snapshot())
        self.assertEqual(result["action"], "CREATE_NEW_WORK")
        self.assertEqual(result["evidence"]["catalog_search_scope"], "ALL_STATES")

    def test_work_proposal_identity_keeps_distinct_subtitles_separate(self):
        first = record(); first["libro"]["subtitulo"] = "Primera parte"
        second = record(); second["libro"]["subtitulo"] = "Segunda parte"
        a = prepare_record(first, "candidate-first", snapshot(), False)
        b = prepare_record(second, "candidate-second", snapshot(), False)
        self.assertNotEqual(a["preparacion"]["work"].get("proposal_key"), b["preparacion"]["work"].get("proposal_key"))

    def test_demo_price_is_opt_in_deterministic_and_not_a_commercial_claim(self):
        raw = record()
        denied = prepare_record(raw, "candidate-42", snapshot(), False)
        self.assertIsNone(denied["edicion"]["precio"])
        first = prepare_record(raw, "candidate-42", snapshot(), False, allow_demo_price=True)
        second = prepare_record(raw, "candidate-42", snapshot(), False, allow_demo_price=True)
        self.assertEqual(first["edicion"]["precio"], second["edicion"]["precio"])
        self.assertRegex(first["edicion"]["precio"], r"^[0-9]+\.[0-9]{2}$")
        self.assertEqual(first["preparacion"]["field_provenance"]["edicion.precio"]["kind"], "SIMULATED/DEMO")
        self.assertFalse(first["preparacion"]["field_provenance"]["edicion.precio"]["real_source_claim"])
        self.assertIsNone(first["edicion"]["editorial"])
        self.assertIsNone(first["edicion"]["idioma"])

    def test_verified_metadata_and_authorized_demo_price_remove_only_real_blockers(self):
        evidence = {"editorial": "Editorial documentada", "idioma": "es", "evidence": {
            "editorial": {"kind": "REAL_SOURCE", "source_url": "https://example.org/exact-catalog/42", "observed_text": "Editorial documentada", "basis": "exact source record"},
            "idioma": {"kind": "VERIFIED", "source_url": "https://example.org/exact-catalog/42", "observed_text": "Idioma Spanish", "basis": "explicit language"}}}
        result = prepare_record(record(), "candidate-42", snapshot(), False, allow_demo_price=True, verified_metadata=evidence)
        result["edicion"]["sku"] = "PLG-BK-000057"
        self.assertEqual(readiness_errors(result), [])
        self.assertIsNone(result["edicion"]["isbn13"])
        self.assertIsNone(result["edicion"]["ebookFileFormat"])

    def test_unproven_publisher_language_or_conflict_never_become_metadata(self):
        evidence = {"editorial": "Inventada", "idioma": "es", "evidence": {}, "blockers": ["CATALOG_SOURCE_CONFLICT"]}
        result = prepare_record(record(), "candidate-42", snapshot(), False, verified_metadata=evidence)
        self.assertIsNone(result["edicion"]["editorial"])
        self.assertIsNone(result["edicion"]["idioma"])
        self.assertIn("CATALOG_SOURCE_CONFLICT", readiness_errors(result))

    def test_primary_proof_of_distinct_authorship_resolves_same_title_without_merge(self):
        raw = record(); raw["libro"]["autores"] = [{"nombre": "Takeuchi, Yu", "orden": 1}]
        raw["libro"]["titulo"] = "Análisis matemático"
        existing = book(title="Análisis matemático", author="Tom M. Apostol", ident=60)
        evidence = {"identity_resolution": {"action": "CREATE_NEW_WORK", "basis": "Distinct source work by a different documented author",
            "source_url": "https://example.org/publisher/takeuchi", "observed_text": "Análisis matemático, Yu Takeuchi", "confirmed_distinct_authorship": True}}
        result = prepare_record(raw, "candidate-42", snapshot([existing]), False, verified_metadata=evidence)
        self.assertEqual(result["preparacion"]["work"]["action"], "CREATE_NEW_WORK")
        self.assertIsNone(result["preparacion"]["work"]["bookId"])
        self.assertIn("primary_identity_resolution", result["preparacion"]["work"]["evidence"])

    def test_demo_is_opt_in_and_never_fills_real_bibliographic_or_price_fields(self):
        raw = record("AUDIOBOOK"); original = copy.deepcopy(raw)
        denied = prepare_record(raw, "candidate-42", snapshot(), False)
        self.assertIsNone(denied["edicion"]["audioDurationSeconds"])
        self.assertEqual(denied["preparacion"]["audio_metadata_type"], "PENDING_REAL")
        allowed = prepare_record(raw, "candidate-42", snapshot(), True)
        again = prepare_record(raw, "candidate-42", snapshot(), True)
        self.assertEqual(allowed["edicion"]["audioDurationSeconds"], again["edicion"]["audioDurationSeconds"])
        self.assertGreater(allowed["edicion"]["audioDurationSeconds"], 0)
        self.assertIn("DEMO", allowed["edicion"]["narrators"][0])
        for field in ["editorial", "idioma", "isbn13", "precio", "inventarioInicial"]:
            self.assertIsNone(allowed["edicion"][field])
        self.assertEqual(allowed["preparacion"]["field_provenance"]["edicion.audioDurationSeconds"]["kind"], "SIMULATED/DEMO")
        self.assertEqual(raw, original)

    def test_real_audio_values_are_preserved_even_when_demo_is_allowed(self):
        raw = record("AUDIOBOOK"); raw["edicion"].update(audioDurationSeconds=301, narrators=["Persona documentada"])
        result = prepare_record(raw, "candidate-42", snapshot(), True)
        self.assertEqual(result["edicion"]["audioDurationSeconds"], 301)
        self.assertEqual(result["edicion"]["narrators"], ["Persona documentada"])
        self.assertEqual(result["preparacion"]["audio_metadata_type"], "REAL_FROM_INVENTORY")
        self.assertNotEqual(result["preparacion"]["field_provenance"]["edicion.narrators"]["kind"], "SIMULATED/DEMO")

    def test_metadata_preflight_green_does_not_replace_real_price_or_identity_evidence(self):
        prepared = prepare_record(record(), "candidate-42", snapshot(), False)
        prepared["edicion"].update(editorial="Editorial documentada", idioma="es", precio="20.00", sku="PLG-BK-000057")
        errors = readiness_errors(prepared)
        self.assertIn("PRICE_SOURCE_MISSING", errors)
        prepared["preparacion"]["field_provenance"]["edicion.precio"] = {"kind": "REAL", "source": "https://example.org/verified-edition-price", "currency": "USD"}
        self.assertNotIn("PRICE_SOURCE_MISSING", readiness_errors(prepared))
        prepared["edicion"]["precio"] = "0.00"
        self.assertIn("REAL_PRICE_MISSING_OR_INVALID", readiness_errors(prepared))
        prepared["edicion"]["precio"] = "20.000"
        self.assertIn("REAL_PRICE_MISSING_OR_INVALID", readiness_errors(prepared))

    def test_literal_semicolon_author_list_preserves_names_and_order(self):
        raw = record(); raw["libro"]["autores"] = [{"nombre": "Piaget, Jean; Inhelder, Bärbel", "orden": 1}]
        result = prepare_record(raw, "candidate-42", snapshot(), False)
        self.assertEqual(result["libro"]["autores"], [{"nombre": "Piaget, Jean", "orden": 1}, {"nombre": "Inhelder, Bärbel", "orden": 2}])
        self.assertEqual(result["preparacion"]["raw_authorship"], "Piaget, Jean; Inhelder, Bärbel")

    def test_new_work_reuses_exact_existing_author_without_creating_a_name_alias(self):
        data = snapshot(); data["authors_count"] = 1
        data["authors"] = [{"author_id": 48, "name": "Jane Austen", "state": "ACTIVE", "biography": None,
                            "created_at": None, "updated_at": None, "total_count": 1}]
        raw = record(); raw["libro"]["autores"] = [{"nombre": "Austen, Jane", "orden": 1}]
        result = prepare_record(raw, "candidate-42", data, False)
        self.assertEqual(result["libro"]["autores"][0]["nombre"], "Jane Austen")
        self.assertEqual(result["preparacion"]["author_bindings"][0]["authorId"], "48")
        self.assertEqual(result["preparacion"]["work"]["action"], "CREATE_NEW_WORK")

    def test_native_allocator_appends_proposals_without_mutating_registry_or_images(self):
        baseline = {"schema": "pliego-cover-sku-registry-v1", "next_sequence": 2,
                    "assignments": [{"sku": "PLG-BK-000001", "identity_keys": ["existing-identity"], "source_keys": ["old/staging.json#old.webp"]}]}
        original = copy.deepcopy(baseline)
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "example.webp"
            Image.new("RGB", (720, 1080), "white").save(image, "WEBP")
            prior = image.read_bytes()
            candidate = {"record": record(), "candidate_id": "candidate-42", "planned_staging": "Ebook/Matematicas/staging.json", "image": image}
            proposals, registry = propose_skus([candidate], baseline, set())
            self.assertEqual(proposals["candidate-42"], "PLG-BK-000002")
            self.assertEqual(registry["assignments"][0], original["assignments"][0])
            self.assertEqual(image.read_bytes(), prior)
            self.assertEqual(baseline, original)
            candidate["record"]["edicion"]["editorial"] = "Editorial verificada después"
            later, updated = propose_skus([candidate], registry, set(), preserve_assignment_count=1)
            self.assertEqual(later["candidate-42"], "PLG-BK-000002")
            self.assertEqual(len(updated["assignments"]), 2)
            self.assertEqual(updated["assignments"][0], original["assignments"][0])
            with self.assertRaises(ValueError):
                propose_skus([candidate], baseline, {"PLG-BK-000002"})


if __name__ == "__main__":
    unittest.main()
