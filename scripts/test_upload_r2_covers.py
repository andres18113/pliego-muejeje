"""Focused tests for manifest-driven R2 cover synchronization."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


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
