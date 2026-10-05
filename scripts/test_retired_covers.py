"""Retired identities stay reserved while immutable remote objects remain untouched."""
import contextlib
import importlib.util
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_prepare_covers import prepare_covers_module as prepare, record, webp_bytes, write_staging
from test_upload_r2_covers import upload_module as upload, FakeS3
import cover_catalog
import publish_digital_editions as digital
from test_publish_digital_editions import prepared

spec = importlib.util.spec_from_file_location("normalize_retired_fixture", Path(__file__).with_name("normalize-covers.py"))
normalize = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normalize)


def manifest_row(sku="PLG-BK-000001", isbn="9789561120785"):
    key = f"covers/editions/v2/{sku}-aaaaaaaaaaaa.webp"
    return {"isbn13": isbn, "title": "Retired fixture", "original_file": "Isolated/one.webp",
            "permanent_sku": sku, "r2_object_key": key,
            "cover_url": "https://covers.pliegolibros.com/" + key}


def write_manifest(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"schema": "pliego-cover-manifest-v1", "records": rows}))


def digital_batch_fixture(repo):
    batch = repo / "covers/generated/digital-batch/editions"
    staging = batch / "staging/Isolated/staging.json"
    staging.parent.mkdir(parents=True)
    rows, covers = [], []
    for number in (1, 2):
        row = prepared()
        row["libro"]["titulo"] = f"Digital fixture {number}"
        row["edicion"]["sku"] = f"PLG-BK-{number:06d}"
        row["preparacion"].update(field_provenance={"edicion.precio": {"kind": "REAL", "source": "isolated",
                                                                         "currency": "USD"},
                                                      "edicion.editorial": {"kind": "REAL"},
                                                      "edicion.idioma": {"kind": "REAL"}})
        image = staging.parent / f"cover-{number}.webp"
        image.write_bytes(webp_bytes(str(number).encode()))
        digest = hashlib.sha256(image.read_bytes()).hexdigest()
        row["portadaArchivo"] = image.name
        row["preparacion"]["source"] = {"cover_sha256": digest}
        cover = manifest_row(row["edicion"]["sku"], None)
        cover.update(title=row["libro"]["titulo"], r2_object_key=f"covers/editions/v2/{row['edicion']['sku']}-{digest[:12]}.webp")
        cover["cover_url"] = "https://covers.pliegolibros.com/" + cover["r2_object_key"]
        rows.append(row)
        covers.append(cover)
    staging.write_text(json.dumps({"libros": rows}))
    write_manifest(batch / "manifest-cover-proposed.json", covers)
    return staging, rows, covers


class RetirementTests(unittest.TestCase):
    def test_digital_batch_excludes_only_explicit_retired_editions(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            _, _, covers = digital_batch_fixture(repo)
            retired = dict(covers[0], format="AUDIOBOOK")
            write_manifest(repo / "covers/retired-manifest.json", [retired])
            items = digital.load_batch(repo)
            self.assertEqual([item["seed"].sku for item in items], ["PLG-BK-000002"])

    def test_retired_digital_batch_rejects_changed_bibliographic_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            _, _, covers = digital_batch_fixture(repo)
            retired = dict(covers[0], title="Different retired identity", format="AUDIOBOOK")
            write_manifest(repo / "covers/retired-manifest.json", [retired])
            with self.assertRaisesRegex(ValueError, "identidad"):
                digital.load_batch(repo)

    def test_digital_batch_rejects_unknown_sku_in_staging(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            staging, rows, _ = digital_batch_fixture(repo)
            rows[0]["edicion"]["sku"] = "PLG-BK-000003"
            staging.write_text(json.dumps({"libros": rows}))
            with self.assertRaises(ValueError):
                digital.load_batch(repo)

    def test_allocator_skips_permanently_excluded_42(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            category = root / "Isolated"
            write_staging(category, [record("New title", "9780306406157", "one.webp", sku=None)])
            (category / "one.webp").write_bytes(webp_bytes())
            (root / "sku-registry.json").write_text(json.dumps({"schema": "pliego-cover-sku-registry-v1",
                                                               "next_sequence": 42, "assignments": []}))
            prepare.prepare_covers(root)
            self.assertEqual(json.loads((root / "generated/manifest.json").read_text())["records"][0]["permanent_sku"],
                             "PLG-BK-000043")

    def test_new_identity_cannot_receive_retired_or_reserved_sku(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            category = root / "Isolated"
            write_staging(category, [record("Other title", "9780306406157", "one.webp", sku=None)])
            (category / "one.webp").write_bytes(webp_bytes())
            write_manifest(root / "retired-manifest.json", [manifest_row()])
            prepare.prepare_covers(root)
            sku = json.loads((root / "generated/manifest.json").read_text())["records"][0]["permanent_sku"]
            self.assertNotIn(sku, {"PLG-BK-000001", "PLG-BK-000042"})

    def test_publishers_preserve_mixed_active_and_retired_objects(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            retired = manifest_row()
            digital_row = manifest_row("PLG-BK-000002", None)
            physical_row = manifest_row("PLG-BK-000003", "9780306406157")
            write_manifest(root / "retired-manifest.json", [retired])
            self.assertEqual(cover_catalog.publication_existing_keys(root, [digital_row, physical_row],
                                                                      {"PLG-BK-000002"}),
                             {retired["r2_object_key"], physical_row["r2_object_key"]})

    def test_digital_registry_resume_preserves_later_assignments(self):
        old = {"sku": "PLG-BK-000001", "identity_keys": ["isbn13:9789561120785"], "source_keys": ["old.webp"]}
        later = {"sku": "PLG-BK-000003", "identity_keys": ["fallback:later"], "source_keys": ["later.webp"]}
        current = {"schema": "pliego-cover-sku-registry-v1", "next_sequence": 4, "assignments": [old, later]}
        proposed = {"schema": current["schema"], "next_sequence": 2, "assignments": [old]}
        self.assertEqual(digital.merge_registry(current, proposed), current)

    def test_digital_registry_conflict_fails_before_api_or_r2_access(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            current = {"schema": "pliego-cover-sku-registry-v1", "next_sequence": 3,
                       "assignments": [{"sku": "PLG-BK-000002", "identity_keys": ["fallback:physical"], "source_keys": []}]}
            proposed = {"schema": current["schema"], "next_sequence": 3,
                        "assignments": [{"sku": "PLG-BK-000002", "identity_keys": ["fallback:other"], "source_keys": []}]}
            registry_path = repo / "covers/sku-registry.json"
            proposal_path = repo / "covers/generated/digital-batch/editions/sku-registry-proposed.json"
            proposal_path.parent.mkdir(parents=True)
            registry_path.write_text(json.dumps(current))
            proposal_path.write_text(json.dumps(proposed))
            with patch.object(digital, "load_batch", return_value=[]), \
                    patch.object(digital.flow, "PliegoApi", side_effect=AssertionError("Unexpected API access")), \
                    self.assertRaisesRegex(ValueError, "identidad"):
                digital.execute(repo, {}, {}, repo / "audit")

    def test_allocator_rejects_retired_identity_without_mutating_registry(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            category = root / "Isolated"
            write_staging(category, [record("Retired fixture", "9789561120785", "one.webp")])
            (category / "one.webp").write_bytes(webp_bytes())
            prepare.prepare_covers(root)
            registry = (root / "sku-registry.json").read_bytes()
            write_manifest(root / "retired-manifest.json", [manifest_row()])
            with self.assertRaises(prepare.PreparationError):
                prepare.prepare_covers(root)
            self.assertEqual((root / "sku-registry.json").read_bytes(), registry)

    def test_allocator_rejects_explicit_retired_sku_for_new_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            category = root / "Isolated"
            write_staging(category, [record("Other title", "9780306406157", "one.webp", sku="PLG-BK-000001")])
            (category / "one.webp").write_bytes(webp_bytes())
            write_manifest(root / "retired-manifest.json", [manifest_row()])
            with self.assertRaises(prepare.PreparationError):
                prepare.prepare_covers(root)
            self.assertFalse((root / "sku-registry.json").exists())

    def test_normalizer_rejects_retired_input_before_writing_objects(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_manifest(root / "retired-manifest.json", [manifest_row()])
            write_manifest(root / "input.json", [manifest_row()])
            with self.assertRaisesRegex(ValueError, "retirad"):
                normalize.normalize_manifest(root, root / "input.json", root / "objects",
                                             root / "output.json", root / "report.json")
            self.assertFalse((root / "objects").exists())

    def test_normalizer_drops_retired_previous_rows_from_active_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_manifest(root / "retired-manifest.json", [manifest_row()])
            write_manifest(root / "input.json", [])
            write_manifest(root / "output.json", [manifest_row()])
            normalize.normalize_manifest(root, root / "input.json", root / "objects",
                                         root / "output.json", root / "report.json")
            self.assertEqual(json.loads((root / "output.json").read_text())["records"], [])

    def test_uploader_accepts_only_known_retired_remote_objects(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "covers"
            assets = root / "generated/r2-normalized"
            active = manifest_row("PLG-BK-000002", "9780306406157")
            retired = manifest_row()
            write_manifest(root / "generated/manifest-normalized.json", [active])
            write_manifest(root / "retired-manifest.json", [retired])
            image = assets / active["r2_object_key"]
            image.parent.mkdir(parents=True)
            image.write_bytes(b"RIFF fixture")
            client = FakeS3()
            original = {"Body": b"retired", "ContentLength": 7, "ContentType": "image/webp",
                        "CacheControl": upload.CACHE_CONTROL, "Metadata": {"sha256": "retired"}}
            client.objects[retired["r2_object_key"]] = original.copy()
            args = ["--manifest", str(root / "generated/manifest-normalized.json"), "--assets-dir", str(assets)]
            with patch.object(upload, "required_configuration", return_value={"bucket": "isolated"}), \
                    patch.object(upload, "create_s3_client", return_value=client), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(upload.main(args), 0)
                self.assertEqual(client.objects[retired["r2_object_key"]], original)
                client.objects["covers/editions/v2/unexplained.webp"] = original.copy()
                self.assertEqual(upload.main(args), 1)


if __name__ == "__main__":
    unittest.main()
