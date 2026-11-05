"""Offline checks for published-cover discovery and email JPEG renditions."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageCms

SPEC = importlib.util.spec_from_file_location("email_covers", Path(__file__).with_name("generate-email-covers.py"))
assert SPEC and SPEC.loader
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)

CDN = "https://covers.pliegolibros.com/"
KEY = "covers/editions/v2/PLG-BK-000390-d2c065f3dcad.webp"
JPEG_KEY = "covers/editions/email-v1/PLG-BK-000390-d2c065f3dcad.jpg"


class EmailCoversTests(unittest.TestCase):
    def manifest(self, root, relative, keys, status=None):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        document = {"schema": "pliego-cover-manifest-v1", "records": [
            {"r2_object_key": key, "cover_url": CDN + key} for key in keys]}
        if status:
            document["publication_status"] = status
        path.write_text(json.dumps(document))

    def source(self, root, key, mode="RGB"):
        path = root / "generated/r2-normalized" / key
        path.parent.mkdir(parents=True, exist_ok=True)
        image = Image.new(mode, (400, 600), (20, 40, 80, 0) if mode == "RGBA" else (20, 40, 80))
        image.save(path, "WEBP", lossless=True, exif=b"Exif\x00\x00", icc_profile=ImageCms.ImageCmsProfile(
            ImageCms.createProfile("sRGB")).tobytes())
        return path

    def test_published_union_includes_history_and_digital_but_excludes_pending(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            historical = "covers/editions/legacy.webp"
            digital = "covers/editions/v2/digital.webp"
            self.manifest(root, "generated/manifest-normalized.json", [KEY])
            self.manifest(root, "generated/manifest.json", [KEY])
            self.manifest(root, "retired-manifest.json", [historical])
            self.manifest(root, "generated/digital-batch/editions/manifest-cover-proposed.json", [digital], "PUBLISHED")
            self.manifest(root, "generated/digital-batch/manifest-pending.json", ["covers/editions/pending.webp"], "PENDING_ONLY")
            for key in (KEY, historical, digital):
                self.source(root, key)
            output, mapping = root / "generated/email-v1", root / "mapping.json"
            result = generator.generate_renditions(root, output, mapping)
            self.assertEqual(result["source_count"], 3)
            self.assertEqual(len(result["records"]), 3)
            self.assertEqual(result["missing_source_keys"], [])
            self.assertEqual(set(json.loads(mapping.read_text())), {CDN + KEY, CDN + historical, CDN + digital})

    def test_jpeg_is_baseline_rgb_white_flattened_proportional_and_metadata_free(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.manifest(root, "generated/manifest-normalized.json", [KEY])
            source = self.source(root, KEY, "RGBA")
            original = source.read_bytes()
            output, mapping = root / "generated/email-v1", root / "mapping.json"
            result = generator.generate_renditions(root, output, mapping)
            data = (output / JPEG_KEY).read_bytes()
            with Image.open(output / JPEG_KEY) as image:
                image.load()
                self.assertEqual((image.format, image.mode, image.size), ("JPEG", "RGB", (168, 252)))
                self.assertFalse(image.info.get("progressive") or image.info.get("progression"))
                self.assertFalse(image.getexif())
                self.assertNotIn("icc_profile", image.info)
                self.assertNotIn("comment", image.info)
                self.assertTrue(all(value >= 253 for value in image.getpixel((84, 126))))
            self.assertIn(b"\xff\xc0", data)  # SOF0: baseline DCT
            self.assertNotIn(b"\xff\xc2", data)
            self.assertEqual(json.loads(mapping.read_text()), {CDN + KEY: CDN + JPEG_KEY})
            record = result["records"][0]
            self.assertEqual((record["r2_object_key"], record["source_webp_key"]), (JPEG_KEY, KEY))
            self.assertEqual((record["size"], record["sha256"]), (len(data), hashlib.sha256(data).hexdigest()))
            self.assertEqual(source.read_bytes(), original)
            generator.generate_renditions(root, output, mapping)
            self.assertEqual((output / JPEG_KEY).read_bytes(), data)

    def test_missing_source_is_reported_without_mapping_to_a_missing_jpeg(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.manifest(root, "generated/manifest-normalized.json", [KEY])
            mapping = root / "mapping.json"
            result = generator.generate_renditions(root, root / "generated/email-v1", mapping)
            self.assertEqual(result["source_count"], 1)
            self.assertEqual(result["missing_source_keys"], [KEY])
            self.assertEqual(result["records"], [])
            self.assertEqual(json.loads(mapping.read_text()), {})

    def test_duplicate_basenames_and_unsafe_keys_are_rejected_before_writing(self):
        for keys in ([KEY, KEY.replace("/v2/", "/other/")], ["covers/editions/../secret.webp"]):
            with self.subTest(keys=keys), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                self.manifest(root, "generated/manifest-normalized.json", keys)
                with self.assertRaises(ValueError):
                    generator.generate_renditions(root, root / "generated/email-v1", root / "mapping.json")
                self.assertFalse((root / "mapping.json").exists())


if __name__ == "__main__":
    unittest.main()
