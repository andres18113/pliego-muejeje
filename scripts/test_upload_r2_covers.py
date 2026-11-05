"""Focused tests for manifest-driven R2 cover synchronization."""

from __future__ import annotations

import importlib.util
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("upload-r2-covers.py")
SPEC = importlib.util.spec_from_file_location("upload_r2_covers", SCRIPT)
assert SPEC and SPEC.loader
upload_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = upload_module
SPEC.loader.exec_module(upload_module)


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[str, dict[str, Any]] = {}
        self.put_count = 0

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        if Key not in self.objects:
            raise FileNotFoundError(Key)
        item = self.objects[Key]
        return {key: value for key, value in item.items() if key != "Body"}

    def put_object(self, *, Bucket: str, Key: str, Body: Any, **metadata: Any) -> None:
        if metadata.get("IfNoneMatch") == "*" and Key in self.objects:
            raise FileExistsError(Key)
        contents = Body.read() if hasattr(Body, "read") else Body
        self.objects[Key] = {
            "Body": contents,
            "ContentLength": metadata["ContentLength"],
            "ContentType": metadata["ContentType"],
            "CacheControl": metadata["CacheControl"],
            "Metadata": metadata["Metadata"],
        }
        self.put_count += 1

    def list_objects_v2(self, *, Bucket: str, Prefix: str, **kwargs: Any) -> dict[str, Any]:
        return {"Contents": [{"Key": key} for key in sorted(self.objects) if key.startswith(Prefix)]}


class UploadR2CoversTests(unittest.TestCase):
    def email_fixture(self, root):
        assets_dir = root / "email-v1"
        records = []
        for number in (1, 2):
            key = f"covers/editions/email-v1/book-{number}.jpg"
            path = assets_dir / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"JPEG" + bytes([number]) * 20)
            records.append({"r2_object_key": key, "size": path.stat().st_size,
                            "sha256": upload_module.sha256_file(path)})
        manifest = root / "manifest.json"
        manifest.write_text(json.dumps({"records": records}))
        return manifest, assets_dir

    def test_email_jpegs_upload_add_only_then_skip_identical_objects(self):
        with tempfile.TemporaryDirectory() as temporary:
            manifest, directory = self.email_fixture(Path(temporary))
            assets, prefix = upload_module.load_upload_plan(manifest, directory)
            client = FakeS3()
            first = upload_module.sync_assets(client, "pliego-covers", assets, prefix, add_only=True)
            second = upload_module.sync_assets(client, "pliego-covers", assets, prefix, add_only=True)
            self.assertEqual(first["errors"], [])
            self.assertEqual(second["errors"], [])
            self.assertEqual((first["uploaded"], second["skipped"], second["verified_count"]), (2, 2, 2))
            for item in client.objects.values():
                self.assertEqual(item["ContentType"], "image/jpeg")
                self.assertEqual(item["CacheControl"], upload_module.CACHE_CONTROL)

    def test_email_conflict_aborts_entire_plan_without_any_write_even_without_flag(self):
        with tempfile.TemporaryDirectory() as temporary:
            manifest, directory = self.email_fixture(Path(temporary))
            assets, prefix = upload_module.load_upload_plan(manifest, directory)
            client = FakeS3()
            client.objects[assets[1].key] = {"Body": b"different", "ContentLength": 9,
                                           "ContentType": "image/jpeg", "Metadata": {"sha256": "different"}}
            result = upload_module.sync_assets(client, "pliego-covers", assets, prefix)
            self.assertTrue(result["errors"])
            self.assertEqual(client.put_count, 0)
            self.assertNotIn(assets[0].key, client.objects)
            self.assertEqual(client.objects[assets[1].key]["Body"], b"different")

    def test_email_mode_refuses_other_buckets_or_prefixes_without_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            manifest, directory = self.email_fixture(Path(temporary))
            assets, prefix = upload_module.load_upload_plan(manifest, directory)
            for bucket, selected_prefix, selected_assets in [
                    ("billing-pliego", prefix, assets), ("pliego-covers", "covers/editions/", assets),
                    ("pliego-covers", prefix, [upload_module.UploadAsset("other/book.jpg", assets[0].path, 24, assets[0].sha256)])]:
                client = FakeS3()
                result = upload_module.sync_assets(client, bucket, selected_assets, selected_prefix, add_only=True)
                self.assertTrue(result["errors"])
                self.assertEqual(client.objects, {})

    def test_dry_run_needs_no_credentials_or_s3_client_and_prints_counts_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            manifest, directory = self.email_fixture(Path(temporary))
            output = io.StringIO()
            with patch.dict("os.environ", {}, clear=True), patch.object(upload_module, "create_s3_client") as client, contextlib.redirect_stdout(output):
                result = upload_module.main(["--manifest", str(manifest), "--assets-dir", str(directory), "--add-only", "--dry-run"])
            self.assertEqual(result, 0)
            client.assert_not_called()
            self.assertIn("2", output.getvalue())
            self.assertNotIn("book-", output.getvalue())

    def test_email_manifest_checksum_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            manifest, directory = self.email_fixture(Path(temporary))
            data = json.loads(manifest.read_text())
            (directory / data["records"][0]["r2_object_key"]).write_bytes(b"tampered")
            with self.assertRaises(upload_module.UploadError):
                upload_module.load_upload_plan(manifest, directory)

    def test_email_racing_creation_cannot_be_overwritten(self):
        class RacingS3(FakeS3):
            def put_object(self, **request):
                self.objects[request["Key"]] = {"Body": b"created concurrently", "ContentLength": 20,
                    "ContentType": "image/jpeg", "CacheControl": upload_module.CACHE_CONTROL,
                    "Metadata": {"sha256": "other"}}
                super().put_object(**request)

        with tempfile.TemporaryDirectory() as temporary:
            manifest, directory = self.email_fixture(Path(temporary))
            assets, prefix = upload_module.load_upload_plan(manifest, directory)
            client = RacingS3()
            result = upload_module.sync_assets(client, "pliego-covers", assets, prefix, add_only=True)
            self.assertTrue(result["errors"])
            self.assertEqual(client.put_count, 0)
            self.assertTrue(all(item["Body"] == b"created concurrently" for item in client.objects.values()))

    def test_email_upload_preserves_unlisted_objects_without_listing_or_retirement(self):
        class NoListingS3(FakeS3):
            def list_objects_v2(self, **request):
                raise AssertionError("Email uploads must not enumerate or retire unrelated objects")

        with tempfile.TemporaryDirectory() as temporary:
            manifest, directory = self.email_fixture(Path(temporary))
            assets, prefix = upload_module.load_upload_plan(manifest, directory)
            client = NoListingS3()
            for key in ["covers/editions/email-v1/historical.jpg", "covers/editions/v2/book.webp"]:
                client.objects[key] = {"Body": b"history"}
            result = upload_module.sync_assets(client, "pliego-covers", assets, prefix, add_only=True)
            self.assertEqual(result["errors"], [])
            self.assertEqual(client.objects["covers/editions/email-v1/historical.jpg"], {"Body": b"history"})
            self.assertEqual(client.objects["covers/editions/v2/book.webp"], {"Body": b"history"})

    def test_jpeg_extension_uses_jpeg_content_type(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, directory = self.email_fixture(root)
            document = json.loads(manifest.read_text())
            row = document["records"][0]
            old_key = row["r2_object_key"]
            row["r2_object_key"] = old_key.replace(".jpg", ".jpeg")
            (directory / old_key).rename(directory / row["r2_object_key"])
            manifest.write_text(json.dumps(document))
            assets, prefix = upload_module.load_upload_plan(manifest, directory)
            client = FakeS3()
            result = upload_module.sync_assets(client, "pliego-covers", assets, prefix)
            self.assertEqual(result["errors"], [])
            self.assertEqual(client.objects[row["r2_object_key"]]["ContentType"], "image/jpeg")

    def test_batch_sync_preserves_explicit_historical_objects_without_uploading_them(self):
        with tempfile.TemporaryDirectory() as temporary:
            manifest, directory = self.make_fixture(Path(temporary))
            assets, prefix = upload_module.load_upload_plan(manifest, directory)
            client = FakeS3()
            old_key = 'covers/editions/historical.webp'
            client.objects[old_key] = {'Body': b'history', 'ContentLength': 7, 'ContentType': 'image/webp',
                                      'CacheControl': upload_module.CACHE_CONTROL, 'Metadata': {'sha256': 'old'}}
            original = dict(client.objects[old_key])
            result = upload_module.sync_assets(client, 'bucket', assets, prefix, allowed_existing_keys={old_key})
            self.assertEqual(result['errors'], [])
            self.assertEqual(result['uploaded'], 2)
            self.assertEqual(client.put_count, 2)
            self.assertEqual(client.objects[old_key], original)

    def make_fixture(self, root: Path) -> tuple[Path, Path]:
        assets_dir = root / "r2"
        object_dir = assets_dir / "covers/editions"
        object_dir.mkdir(parents=True)
        records = []
        for number in (1, 2):
            key = f"covers/editions/PLG-BK-{number:06d}.webp"
            (assets_dir / key).write_bytes(b"RIFF" + bytes([number]) * 20)
            records.append({"r2_object_key": key, "permanent_sku": f"PLG-BK-{number:06d}"})
        manifest_path = root / "manifest.json"
        manifest_path.write_text(json.dumps({"schema": "test", "records": records}), encoding="utf-8")
        return manifest_path, assets_dir

    def test_manifest_drives_local_assets_and_object_keys(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest_path, assets_dir = self.make_fixture(Path(temporary))
            assets, prefix = upload_module.load_upload_plan(manifest_path, assets_dir)
            self.assertEqual(prefix, "covers/editions/")
            self.assertEqual([asset.key for asset in assets], [
                "covers/editions/PLG-BK-000001.webp",
                "covers/editions/PLG-BK-000002.webp",
            ])
            self.assertTrue(all(asset.size > 0 and len(asset.sha256) == 64 for asset in assets))

    def test_sync_uploads_once_then_skips_and_verifies_every_key(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest_path, assets_dir = self.make_fixture(Path(temporary))
            assets, prefix = upload_module.load_upload_plan(manifest_path, assets_dir)
            client = FakeS3()

            first = upload_module.sync_assets(client, "test-bucket", assets, prefix)
            second = upload_module.sync_assets(client, "test-bucket", assets, prefix)

            self.assertEqual((first["uploaded"], first["skipped"], first["verified_count"]), (2, 0, 2))
            self.assertEqual((second["uploaded"], second["skipped"], second["verified_count"]), (0, 2, 2))
            self.assertEqual(client.put_count, 2)
            self.assertEqual(first["errors"], [])
            self.assertEqual(second["errors"], [])
            for item in client.objects.values():
                self.assertEqual(item["ContentType"], "image/webp")
                self.assertEqual(item["CacheControl"], upload_module.CACHE_CONTROL)

    def test_sync_reports_remote_keys_outside_manifest_without_deleting_them(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest_path, assets_dir = self.make_fixture(Path(temporary))
            assets, prefix = upload_module.load_upload_plan(manifest_path, assets_dir)
            client = FakeS3()
            client.objects["covers/editions/old.webp"] = {
                "Body": b"old",
                "ContentLength": 3,
                "ContentType": "image/webp",
                "CacheControl": upload_module.CACHE_CONTROL,
                "Metadata": {upload_module.SHA256_METADATA_KEY: "old"},
            }

            result = upload_module.sync_assets(client, "test-bucket", assets, prefix)

            self.assertTrue(any("unexpected key" in error for error in result["errors"]))
            self.assertIn("covers/editions/old.webp", client.objects)
            self.assertEqual(result["verified_count"], 2)


if __name__ == "__main__":
    unittest.main()
