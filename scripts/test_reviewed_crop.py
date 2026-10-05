"""Opt-in source-bound visual review crops retain strict output invariants."""
import csv
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from cover_images import CoverRejected, normalize_file, normalize_image
from test_digital_covers import batch, inventory, poster, row


class ReviewedCropTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def source(self, image, name="source.png", **options):
        path = self.root / name
        image.save(path, **options)
        return path

    def reviewed(self, source, box, **options):
        return {"reviewedCropBox": box,
                "reviewedCropReason": "Inspección visual: solo se elimina margen exterior sin texto.",
                "reviewedSourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                **options}

    def reject(self, source, options, status="REVISION_ENCUADRE"):
        with self.assertRaises(CoverRejected) as error:
            normalize_image(source, options)
        self.assertEqual(error.exception.details["status"], status)
        return error.exception.details

    def test_explicit_review_can_exceed_conservative_crop_without_changing_pixels(self):
        source = self.source(poster(400, 450))
        box = [100, 0, 400, 450]
        self.reject(source, {})
        output, result = normalize_image(source, self.reviewed(source, box))
        expected = Image.open(source).convert("RGB").resize((720, 1080), Image.Resampling.LANCZOS, box=box)
        self.assertTrue(np.array_equal(np.asarray(output), np.asarray(expected)))
        self.assertEqual(result["mode"], "REVIEWED_CROP")
        self.assertEqual(result["reviewed_crop"]["source_box"], box)
        self.assertEqual(result["reviewed_crop"]["source_sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertEqual(result["reviewed_crop"]["coordinate_space"], "exif_oriented_source_pixels")
        self.assertEqual(result["reviewed_crop"]["reason"], self.reviewed(source, box)["reviewedCropReason"])
        self.assertFalse(result["padded"])

    def test_review_can_remove_an_external_margin_above_five_percent(self):
        image = Image.new("RGB", (240, 408), "white")
        image.paste(poster(240, 360), (0, 24))
        source = self.source(image)
        self.reject(source, {})
        output, result = normalize_image(source, self.reviewed(source, [0, 24, 240, 384]))
        self.assertEqual(output.size, (720, 1080))
        self.assertEqual(result["crop"]["box"], [0, 24, 240, 384])

    def test_fractional_source_coordinates_are_not_rounded_or_recentred(self):
        source = self.source(poster(220, 320))
        box = [1.5, 0, 1.5 + 640 / 3, 320]
        output, result = normalize_image(source, self.reviewed(source, box))
        expected = Image.open(source).convert("RGB").resize((720, 1080), Image.Resampling.LANCZOS, box=box)
        self.assertTrue(np.array_equal(np.asarray(output), np.asarray(expected)))
        self.assertEqual(result["reviewed_crop"]["source_box"], box)

    def test_invalid_boxes_fail_closed(self):
        source = self.source(poster(240, 360))
        invalid = [None, [], [0, 0, 240], [0, 0, 240, 360, 0], "[0,0,240,360]",
                   [False, 0, 240, 360], ["0", 0, 240, 360], [float("nan"), 0, 240, 360],
                   [0, 0, float("inf"), 360], [-1, 0, 239, 360], [0, 0, 241, 361.5],
                   [0, 0, 10 ** 1000, 360], [0, 0, 0, 0], [240, 360, 0, 0], [0, 0, 240, 359]]
        for box in invalid:
            with self.subTest(box=box):
                self.reject(source, self.reviewed(source, box))

    def test_review_reason_is_required_and_must_be_nonempty_text(self):
        source = self.source(poster(240, 360))
        for reason in [None, "", " \n", False, 42, [], {}]:
            with self.subTest(reason=reason):
                self.reject(source, self.reviewed(source, [0, 0, 240, 360], reviewedCropReason=reason))
        options = self.reviewed(source, [0, 0, 240, 360])
        del options["reviewedCropReason"]
        self.reject(source, options)

    def test_hash_is_required_and_bound_to_exact_source_bytes(self):
        source = self.source(poster(240, 360))
        for digest in [None, "", False, 42, [], "0" * 64, "z" * 64]:
            with self.subTest(digest=digest):
                self.reject(source, self.reviewed(source, [0, 0, 240, 360], reviewedSourceSha256=digest))
        options = self.reviewed(source, [0, 0, 240, 360])
        del options["reviewedSourceSha256"]
        self.reject(source, options)
        options = self.reviewed(source, [0, 0, 240, 360])
        changed = poster(240, 360); changed.putpixel((0, 0), (0, 255, 0)); changed.save(source)
        self.reject(source, options)

    def test_orphan_review_metadata_does_not_silently_enable_default(self):
        source = self.source(poster(240, 360))
        self.reject(source, {"reviewedCropReason": "Reviewed"})
        self.reject(source, {"reviewedSourceSha256": hashlib.sha256(source.read_bytes()).hexdigest()})

    def test_upscale_cap_still_applies_and_exactly_four_is_allowed(self):
        source = self.source(poster(240, 360))
        output, result = normalize_image(source, self.reviewed(source, [0, 0, 180, 270]))
        self.assertEqual(output.size, (720, 1080))
        self.assertEqual(result["upscale_factor"], 4.0)
        self.reject(source, self.reviewed(source, [0, 0, 179.9, 269.85]), "FUENTE_INSUFICIENTE")

    def test_review_does_not_override_explicit_protected_regions(self):
        source = self.source(poster(400, 450))
        self.reject(source, self.reviewed(source, [100, 0, 400, 450], protectedRegions=[[0, 10, 20, 30]]))
        output, _ = normalize_image(source, self.reviewed(source, [100, 0, 400, 450], protectedRegions=[[110, 10, 150, 30]]))
        self.assertEqual(output.size, (720, 1080))

    def test_review_does_not_override_explicit_editorial_borders(self):
        source = self.source(poster(400, 450))
        self.reject(source, self.reviewed(source, [100, 0, 400, 450], editorialBorders=["left"]))
        output, _ = normalize_image(source, self.reviewed(source, [100, 0, 400, 450], editorialBorders=["top", "right", "bottom"]))
        self.assertEqual(output.size, (720, 1080))

    def test_malformed_explicit_protections_are_not_ignored(self):
        source = self.source(poster(240, 360))
        for options in [{"protectedRegions": None}, {"protectedRegions": [[0, 0, 999, 999]]},
                        {"editorialBorders": None}, {"editorialBorders": ["invalid"]},
                        {"editorialBorders": [[]]}, {"editorialBorders": [{}]},
                        {"protectedRegions": [[0, 0, 10 ** 1000, 360]]}]:
            with self.subTest(options=options):
                self.reject(source, self.reviewed(source, [0, 0, 240, 360], **options))

    def test_contain_mode_remains_forbidden(self):
        source = self.source(poster(240, 360))
        self.reject(source, self.reviewed(source, [0, 0, 240, 360], mode="contain"))

    def test_perspective_rejection_remains_in_force(self):
        image = Image.new("RGB", (320, 480), (245, 240, 235))
        ImageDraw.Draw(image).polygon([(25, 12), (305, 28), (275, 465), (40, 460)], fill=(25, 72, 125))
        source = self.source(image)
        result = self.reject(source, self.reviewed(source, [0, 0, 320, 480]))
        self.assertIn("perspectiva", result["reason"])

    def test_review_can_trim_transparent_exterior_but_cannot_add_matte(self):
        image = Image.new("RGBA", (280, 400), (0, 0, 0, 0))
        image.paste(poster(240, 360), (20, 20))
        source = self.source(image)
        output, result = normalize_image(source, self.reviewed(source, [20, 20, 260, 380]))
        self.assertEqual(output.mode, "RGB")
        self.assertEqual(result["crop"]["box"], [0, 0, 240, 360])
        self.reject(source, self.reviewed(source, [0, 0, 260, 390]))
        image.putpixel((100, 100), (0, 0, 0, 0)); image.save(source)
        self.reject(source, self.reviewed(source, [20, 20, 260, 380]))

    def test_exif_oriented_coordinates_and_metadata_stripping(self):
        exif = Image.Exif(); exif[274] = 6
        source = self.source(poster(240, 360).rotate(90, expand=True), "rotated.jpg", exif=exif)
        options = self.reviewed(source, [0, 0, 240, 360])
        output, result = normalize_image(source, options)
        expected = ImageOps.exif_transpose(Image.open(source)).convert("RGB").resize((720, 1080), Image.Resampling.LANCZOS)
        self.assertTrue(np.array_equal(np.asarray(output), np.asarray(expected)))
        self.assertEqual(result["original_size"], {"width": 360, "height": 240})
        self.assertEqual(result["oriented_size"], {"width": 240, "height": 360})
        self.assertEqual(output.info, {})

    def test_static_rgb_webp_size_hash_and_determinism_use_existing_encoder(self):
        source = self.source(poster(400, 450))
        options = self.reviewed(source, [100, 0, 400, 450])
        data, result = normalize_file(source, options)
        second, _ = normalize_file(source, options)
        self.assertEqual(data, second)
        with Image.open(io.BytesIO(data)) as decoded:
            self.assertEqual(decoded.format, "WEBP")
            self.assertEqual(decoded.size, (720, 1080))
            self.assertEqual(decoded.mode, "RGB")
            self.assertEqual(decoded.n_frames, 1)
        self.assertLessEqual(len(data), 204800)
        self.assertEqual(result["sha256"], hashlib.sha256(data).hexdigest())
        self.assertIn(result["quality"], [86, 84, 82, 80])

    def test_review_does_not_accept_animated_or_invalid_images(self):
        source = self.source(poster(240, 360), "animated.webp", save_all=True,
                             append_images=[poster(240, 360).transpose(Image.Transpose.FLIP_LEFT_RIGHT)], duration=100)
        self.reject(source, self.reviewed(source, [0, 0, 240, 360]), "ARCHIVO_INVALIDO")
        source.write_bytes(b"not an image")
        self.reject(source, self.reviewed(source, [0, 0, 240, 360]), "ARCHIVO_INVALIDO")

    def test_weight_limit_is_not_bypassed_by_review(self):
        source = self.source(poster(240, 360))
        with patch("cover_images.MAX_BYTES", 1):
            with self.assertRaises(CoverRejected) as error:
                normalize_file(source, self.reviewed(source, [0, 0, 240, 360]))
        self.assertEqual(error.exception.details["status"], "PESO_EXCEDIDO")

    def test_inventory_passes_explicit_review_fields_and_blank_keeps_default(self):
        root = self.root / "covers"; root.mkdir()
        inv = inventory(root, "Ebook", [row("source.png", reviewedCropBox="[0,0,240,360]",
                        reviewedCropReason="Revisión por archivo", reviewedSourceSha256="a" * 64), row("blank.png")])
        jobs = list(batch.inventory_records(root, inv))
        self.assertEqual(jobs[0][3], {"protectedRegions": [], "editorialBorders": [],
                         "reviewedCropBox": [0, 0, 240, 360], "reviewedCropReason": "Revisión por archivo",
                         "reviewedSourceSha256": "a" * 64})
        self.assertEqual(jobs[1][3], {"protectedRegions": [], "editorialBorders": []})

    def test_inventory_review_reaches_json_and_csv_reports(self):
        root = self.root / "covers"; root.mkdir()
        (root / "Ebook").mkdir()
        source = root / "Ebook/source.png"; poster(400, 450).save(source)
        options = self.reviewed(source, [100, 0, 400, 450])
        inv = inventory(root, "Ebook", [row("source.png", **{**options, "reviewedCropBox": json.dumps(options["reviewedCropBox"])})])
        report = batch.process_batch(root, [inv])
        self.assertEqual(report["summary"]["accepted"], 1)
        self.assertEqual(report["records"][0]["reviewed_crop"]["source_box"], options["reviewedCropBox"])
        report_path = root / "generated/digital-batch/reports/normalization-report.json"
        self.assertEqual(json.loads(report_path.read_text())["records"][0]["reviewed_crop"], report["records"][0]["reviewed_crop"])
        with report_path.with_suffix(".csv").open(newline="") as stream:
            csv_row = next(csv.DictReader(stream))
        self.assertEqual(json.loads(csv_row["reviewed_crop"]), report["records"][0]["reviewed_crop"])


if __name__ == "__main__":
    unittest.main()
