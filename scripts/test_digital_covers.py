"""Image safety, end-to-end local batches, provenance and physical-catalog compatibility."""
import copy
import csv
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageCms, ImageDraw

from cover_catalog import discover_staging, metadata_errors, read_manifest
from cover_images import CoverRejected, encode_webp, initial_report, normalize_file, normalize_image
from prepare_covers_loader import module as prepare
from fixtures.catalog_helpers import physical_catalog


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


batch = load("digital_batch", "process-digital-covers.py")
normalizer = load("normalizer", "normalize-covers.py")
seed = load("digital_seed", "seed-development-catalog.py")


def poster(width=220, height=320):
    image = Image.new("RGB",(width,height),(25,72,125))
    draw = ImageDraw.Draw(image)
    draw.text((12,30),"TITLE",fill=(240,240,220))
    draw.rectangle((width*.25,height*.35,width*.75,height*.70),fill=(140,170,195))
    draw.text((15,height-30),"AUTHOR",fill=(240,240,220))
    return image


def row(filename, **values):
    return {"Categoria":"Categoría Sintética","Titulo":"Obra sintética","Autor":"Autora de prueba",
            "Archivo":filename,"Fuente":"archivo_local","editorial":"Editorial de prueba","idioma":"es",**values}


def inventory(root, family, rows):
    path = root / family / "inventario.csv"
    path.parent.mkdir(parents=True,exist_ok=True)
    fields = sorted(set().union(*(r.keys() for r in rows)))
    with path.open("w",encoding="utf-8",newline="") as out:
        writer = csv.DictWriter(out,fieldnames=fields)
        writer.writeheader(); writer.writerows(rows)
    return path


def raw(root, family, filename="cover.jpg"):
    path = root / family / "categoria-sintetica/originales" / filename
    path.parent.mkdir(parents=True,exist_ok=True)
    poster().save(path,quality=95)
    return "categoria-sintetica/originales/" + filename


def synthetic_staging(root):
    """Select only this test's fixtures, even when a real catalog was copied."""
    return tuple(path for family in ("Ebook", "Audiolibros")
                 if (path := root / family / "categoria-sintetica/staging.json").is_file())


class ImageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def source(self,image,filename="source.png",**kwargs):
        path = self.root / filename
        image.save(path,**kwargs)
        return path



    def test_capture_with_sloping_jacket_requires_review(self):
        image=Image.new("RGB",(320,480),(245,240,235))
        ImageDraw.Draw(image).polygon([(25,12),(305,28),(275,465),(40,460)],fill=(25,72,125))
        with self.assertRaises(CoverRejected) as error:
            normalize_image(self.source(image))
        self.assertEqual(error.exception.details["status"],"REVISION_ENCUADRE")
        self.assertIn("perspectiva",error.exception.details["reason"])

    def test_automatic_contrast_guard_preserves_edge_text(self):
        image = poster(320,450)
        ImageDraw.Draw(image).text((1,15),"EDGE",fill="white")
        output,result = normalize_image(self.source(image))
        self.assertEqual(result["status"],"ACEPTADO")
        self.assertEqual(output.size,(720,1080))
        self.assertLessEqual(result["crop"]["box"][0],.01)

    def test_invalid_override_becomes_review(self):
        for options in [{"protectedRegions":None},{"focalX":None},"fill"]:
            with self.assertRaises(CoverRejected) as error:
                normalize_image(self.source(poster()),options)
            self.assertEqual(error.exception.details["status"],"REVISION_ENCUADRE")

    def test_jpg_220_320_is_accepted_at_720_1080(self):
        data, result = normalize_file(self.source(poster(),"source.jpg",quality=95))
        decoded = Image.open(__import__('io').BytesIO(data))
        self.assertEqual(decoded.size,(720,1080))
        self.assertEqual(decoded.mode,"RGB")
        self.assertEqual(result["status"],"ACEPTADO")
        self.assertAlmostEqual(result["upscale_factor"],3.375)
        self.assertLessEqual(len(data),204800)
        self.assertFalse(result["padded"])

    def test_white_external_top_bottom_padding_is_removed(self):
        image = Image.new("RGB",(240,360),"white")
        image.paste(poster(240,344),(0,8))
        output, result = normalize_image(self.source(image))
        self.assertEqual(result["trim"],{"left":0,"right":0,"top":8,"bottom":8})
        self.assertEqual(result["clean_size"],{"width":240,"height":344})
        self.assertLess(output.getpixel((0,0))[0],80)
        self.assertFalse(result["padded"])

    def test_editorial_white_frame_is_preserved_when_identified(self):
        image = poster(240,360)
        ImageDraw.Draw(image).rectangle((0,0,239,359),outline="white",width=6)
        output,result = normalize_image(self.source(image),{"editorialBorders":["left","right","top","bottom"]})
        self.assertEqual(result["trim"],{"left":0,"right":0,"top":0,"bottom":0})
        self.assertGreater(output.getpixel((1,1))[0],240)


    def test_editorial_frame_is_not_cropped_to_force_two_three(self):
        image=poster(240,340)
        ImageDraw.Draw(image).rectangle((0,0,239,339),outline="white",width=6)
        with self.assertRaises(CoverRejected) as error:
            normalize_image(self.source(image),{"editorialBorders":["left","right","top","bottom"]})
        self.assertEqual(error.exception.details["status"],"REVISION_ENCUADRE")

    def test_ambiguous_four_sided_frame_is_reviewed(self):
        image = poster(240,360)
        ImageDraw.Draw(image).rectangle((0,0,239,359),outline="white",width=6)
        with self.assertRaises(CoverRejected) as error:
            normalize_image(self.source(image))
        self.assertEqual(error.exception.details["status"],"REVISION_ENCUADRE")

    def test_safe_crop_and_shift_preserve_logo(self):
        image = poster(320,450)
        output,result = normalize_image(self.source(image),{"protectedRegions":[[2,20,10,40]]})
        self.assertEqual(output.size,(720,1080))
        self.assertLessEqual(result["crop"]["box"][0],.01)
        self.assertLessEqual(abs(result["crop"]["shift_x"]),.05)
        self.assertLessEqual(result["crop"]["fraction"],.10)

    def test_unsafe_crop_returns_review(self):
        with self.assertRaises(CoverRejected) as error:
            normalize_image(self.source(poster(320,450)),{"protectedRegions":[[0,20,15,40],[305,20,320,40]]})
        self.assertEqual(error.exception.details["status"],"REVISION_ENCUADRE")

    def test_excessive_aspect_crop_returns_review_not_padding(self):
        with self.assertRaises(CoverRejected) as error:
            normalize_image(self.source(poster(500,500)))
        self.assertEqual(error.exception.details["status"],"REVISION_ENCUADRE")

    def test_more_than_four_times_is_insufficient(self):
        with self.assertRaises(CoverRejected) as error:
            normalize_image(self.source(poster(100,150)))
        self.assertEqual(error.exception.details["status"],"FUENTE_INSUFICIENTE")
        self.assertEqual(error.exception.details["upscale_factor"],7.2)

    def test_transparent_exterior_first_and_no_internal_matte(self):
        rgba = Image.new("RGBA",(220,330),(0,0,0,0))
        rgba.paste(poster(),(0,5))
        _,result = normalize_image(self.source(rgba))
        self.assertEqual(result["trim"]["top"],5)
        self.assertEqual(result["trim"]["bottom"],5)
        rgba.putpixel((100,100),(20,20,20,0))
        with self.assertRaises(CoverRejected) as error:
            normalize_image(self.source(rgba))
        self.assertEqual(error.exception.details["status"],"REVISION_ENCUADRE")

    def test_trim_over_five_percent_is_reviewed(self):
        image = Image.new("RGB",(240,400),"white")
        image.paste(poster(240,360),(0,20))
        # 20/400 is exactly 5%; make 24-pixel margins exceed the threshold.
        image = Image.new("RGB",(240,408),"white")
        image.paste(poster(240,360),(0,24))
        with self.assertRaises(CoverRejected) as error:
            normalize_image(self.source(image))
        self.assertEqual(error.exception.details["status"],"REVISION_ENCUADRE")

    def test_real_webp_quality_fallback_meets_200_kib(self):
        rng = np.random.default_rng(44)
        # Bounded search of noise levels exercises the real pinned libwebp encoder.
        found = None
        for sigma in (12,18,24,30,36):
            values = np.clip(128+rng.normal(0,sigma,(1080,720)),0,255).astype(np.uint8)
            image = Image.fromarray(np.repeat(values[:,:,None],3,axis=2))
            import io
            at86 = io.BytesIO(); image.save(at86,format="WEBP",quality=86,method=6)
            try:
                data,result = encode_webp(image,initial_report())
            except CoverRejected:
                continue
            if len(at86.getvalue()) > 204800:
                found = result
                self.assertLessEqual(len(data),204800)
                self.assertIn(result["quality"],(84,82,80))
                break
        self.assertIsNotNone(found,"Need a real encoder fixture that triggers fallback")

    def test_weight_above_all_qualities_has_report(self):
        with patch('cover_images.MAX_BYTES',1):
            with self.assertRaises(CoverRejected) as error:
                encode_webp(poster(720,1080),initial_report())
        self.assertEqual(error.exception.details["status"],"PESO_EXCEDIDO")
        self.assertEqual(error.exception.details["quality"],80)
        self.assertIsNotNone(error.exception.details["sha256"])

    def test_exif_and_srgb_conversion_and_corrupt_source(self):
        exif = Image.Exif(); exif[274]=6
        image = poster().rotate(90,expand=True)
        path = self.source(image,"rotated.jpg",exif=exif,icc_profile=ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
        data,result = normalize_file(path)
        self.assertEqual(result["original_size"],{"width":320,"height":220})
        self.assertEqual(result["oriented_size"],{"width":220,"height":320})
        decoded = Image.open(__import__('io').BytesIO(data))
        self.assertNotIn("exif",decoded.info)
        self.assertNotIn("icc_profile",decoded.info)
        path.write_bytes(b"not an image")
        with self.assertRaises(CoverRejected) as error:
            normalize_file(path)
        self.assertEqual(error.exception.details["status"],"ARCHIVO_INVALIDO")


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "covers"
        self.root.mkdir()
    def tearDown(self):
        self.temp.cleanup()




    def test_existing_nested_category_is_reused_without_reparenting(self):
        class Api:
            def page(self,*args,**kwargs):return [{"categoryId":"9","slug":"novela","state":"ACTIVE","parentCategoryId":"3"}]
            def request(self,*args,**kwargs):raise AssertionError("Existing category mutated")
        self.assertEqual(seed.ensure_categories(Api(),(seed.CategorySeed("novela","Novela"),)),{"novela":"9"})


    def test_report_failure_rolls_back_publication_metadata(self):
        source=raw(self.root,"Ebook")
        inv=inventory(self.root,"Ebook",[row(source)])
        batch.process_batch(self.root,[inv])
        targets=[self.root / "sku-registry.json",self.root / "generated/manifest-normalized.json",self.root / "Ebook/categoria-sintetica/staging.json",
                 self.root / "generated/digital-batch/reports/normalization-report.json"]
        before={p:p.read_bytes() for p in targets}
        inventory(self.root,"Ebook",[row(source),row(raw(self.root,"Ebook","second.jpg"),Titulo="Otra obra")])
        writer=batch.write_bytes
        failed=False
        def fail_once(path,data):
            nonlocal failed
            if path.suffix == ".csv" and path.name == "normalization-report.csv" and not failed:
                failed=True
                raise OSError("Injected report failure")
            return writer(path,data)
        with patch.object(batch,"write_bytes",side_effect=fail_once):
            with self.assertRaises(OSError):batch.process_batch(self.root,[inv])
        for path,data in before.items():self.assertEqual(path.read_bytes(),data)

    def test_write_failure_restores_registry_manifest_and_staging(self):
        source=raw(self.root,"Ebook")
        inv=inventory(self.root,"Ebook",[row(source)])
        batch.process_batch(self.root,[inv])
        targets=[self.root / "sku-registry.json",self.root / "generated/manifest-normalized.json",self.root / "Ebook/categoria-sintetica/staging.json"]
        before={p:p.read_bytes() for p in targets}
        inventory(self.root,"Ebook",[row(source),row(raw(self.root,"Ebook","second.jpg"),Titulo="Otra obra")])
        writer=batch.write_bytes
        failed=False
        def fail_once(path,data):
            nonlocal failed
            if path == self.root / "generated/manifest-normalized.json" and not failed:
                failed=True
                raise OSError("Injected commit failure")
            return writer(path,data)
        with patch.object(batch,"write_bytes",side_effect=fail_once):
            with self.assertRaises(OSError):batch.process_batch(self.root,[inv])
        for path,data in before.items():self.assertEqual(path.read_bytes(),data)

    def test_direct_pending_replacement_keeps_last_valid_metadata_and_sku(self):
        source=raw(self.root,"Ebook")
        inv=inventory(self.root,"Ebook",[row(source)])
        batch.process_batch(self.root,[inv])
        path=self.root / "Ebook/categoria-sintetica/staging.json"
        doc=json.loads(path.read_text())
        doc["libros"][0]["edicion"]["editorial"]=None
        path.write_text(json.dumps(doc))
        report=batch.process_batch(self.root,[],[path])
        self.assertEqual(report["records"][0]["status"],"METADATOS_PENDIENTES")
        self.assertIsNotNone(report["records"][0]["sku"])
        self.assertEqual(json.loads(path.read_text())["libros"][0]["edicion"]["editorial"],"Editorial de prueba")
        self.assertEqual(len(read_manifest(self.root / "generated/manifest-normalized.json")["records"]),1)

    def test_source_outside_inventory_is_rejected_without_reading(self):
        outside=self.root.parent / "outside.jpg"; poster().save(outside)
        inv=inventory(self.root,"Ebook",[row("../../outside.jpg")])
        report=batch.process_batch(self.root,[inv])
        self.assertEqual(report["records"][0]["status"],"ARCHIVO_INVALIDO")
        self.assertEqual(read_manifest(self.root / "generated/manifest-normalized.json")["records"],[])

    def test_digital_staging_cannot_overwrite_a_physical_cover(self):
        physical=self.root / "categoria-sintetica/physical.webp"; physical.parent.mkdir()
        poster(240,360).save(physical,format="WEBP")
        original=physical.read_bytes()
        path=self.root / "Ebook/categoria-sintetica/staging.json"; path.parent.mkdir(parents=True)
        doc={"schema":"test","libros":[{"portadaArchivo":"../../categoria-sintetica/physical.webp","libro":{"titulo":"Digital","sinopsis":None,
            "autores":[{"nombre":"Autora","orden":1}],"categorias":["Categoría Sintética"]},"edicion":{"formato":"EBOOK","editorial":"Editorial","idioma":"es","isbn13":None,"narrators":[]}}]}
        path.write_text(json.dumps(doc))
        report=batch.process_batch(self.root,[],[path])
        self.assertEqual(report["summary"]["accepted"],1)
        self.assertEqual(physical.read_bytes(),original)
        self.assertTrue(report["records"][0]["staging_file"].startswith("Ebook/categoria-sintetica/portadas/"))

    def test_seed_digital_main_never_calls_inventory(self):
        source=raw(self.root,"Ebook")
        inv=inventory(self.root,"Ebook",[row(source)])
        batch.process_batch(self.root,[inv])
        covers=seed.load_cover_manifest(self.root / "generated/manifest-normalized.json")
        seeds=seed.load_catalog_seeds(covers,self.root / "sku-registry.json",synthetic_staging(self.root))
        class Api:
            def __init__(self):self.rows=[]
            def login(self,*args):pass
            def page(self,*args,**kwargs):return []
            def all_pages(self,*args,**kwargs):return self.rows
            def request(self,method,path,body):
                self.rows.append({**body,"editionId":"7","bookTitle":seeds[0].title,"state":"ACTIVE"})
                return {"editionId":"7"}
        api=Api()
        with patch.object(seed,"PliegoApi",return_value=api),patch.object(seed,"ADMIN_PASSWORD","fixture-only"), \
             patch.object(seed,"ensure_categories",return_value={"categoria-sintetica":"3"}),patch.object(seed,"ensure_book",return_value="1"), \
             patch.object(seed,"ensure_publisher",return_value="2"),patch.object(seed,"ensure_minimum_stock",side_effect=AssertionError("Digital stock requested")), \
             patch.object(sys,"argv",["seed", "--cover-manifest",str(self.root / "generated/manifest-normalized.json"),"--sku-registry",str(self.root / "sku-registry.json"),"--staging-file",str(synthetic_staging(self.root)[0]),"--sku",seeds[0].sku]):
            self.assertEqual(seed.main(),0)

    def test_cli_executes_only_local_batch_and_returns_pending_status(self):
        source=raw(self.root,"Ebook")
        inv=inventory(self.root,"Ebook",[row(source)])
        command=[sys.executable,str(Path(__file__).with_name("process-digital-covers.py")),"--covers-dir",str(self.root),"--inventory",str(inv)]
        result=subprocess.run(command,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout)["accepted"],1)
        inventory(self.root,"Ebook",[row(source,editorial="")])
        result=subprocess.run(command,capture_output=True,text=True)
        self.assertEqual(result.returncode,2,result.stderr)
        self.assertEqual(json.loads(result.stdout)["pending"],1)

    def test_raw_pending_staging_is_archived_without_losing_metadata(self):
        source=self.root / "Audiolibros/categoria-sintetica/originales/test.jpg"; source.parent.mkdir(parents=True)
        poster().save(source)
        doc={"schema":"test","libros":[{"portadaArchivo":"originales/test.jpg","libro":{"titulo":"Audio pendiente","autores":[{"nombre":"Autora","orden":1}],"categorias":["Categoría Sintética"],"sinopsis":None},
              "edicion":{"formato":"AUDIOBOOK","editorial":"Editorial","idioma":"es","isbn13":None,"narrators":[]}}]}
        path=source.parent.parent / "staging.json"; original=json.dumps(doc).encode(); path.write_bytes(original)
        report=batch.process_batch(self.root,[],[path])
        self.assertEqual(report["records"][0]["status"],"METADATOS_PENDIENTES")
        archived=list((self.root / "generated/digital-batch/inputs").rglob("*.json"))
        self.assertEqual(len(archived),1)
        self.assertEqual(archived[0].read_bytes(),original)
        self.assertEqual(json.loads(path.read_text())["libros"],[])
        self.assertTrue(source.exists())

    def test_normalizer_preserves_mixed_synthetic_manifest_and_emits_versioned_json(self):
        physical_catalog(self.root, include_digital=True)
        prior=read_manifest(self.root / "generated/manifest-normalized.json")
        report=normalizer.normalize_manifest(self.root,self.root / "generated/manifest.json",self.root / "generated/r2-normalized",self.root / "generated/manifest-normalized.json",self.root / "generated/test-report.json")
        self.assertEqual(read_manifest(self.root / "generated/manifest-normalized.json"),prior)
        historical = json.loads((self.root / "generated/manifest.json").read_text())["records"]
        eligible = {r["permanent_sku"] for r in historical} - seed.EXCLUDED_CATALOG_SKUS
        self.assertEqual({r["sku"] for r in report["records"]}, eligible)
        self.assertEqual(report["summary"]["accepted"],len(eligible))
        self.assertTrue(all(r["preserved"] and r["bytes"] and r["sha256"] for r in report["records"]))
        self.assertEqual(report["excluded"][0]["sku"],"PLG-BK-000042")
        by_sku={r["permanent_sku"]:r["cover_url"] for r in prior["records"]}
        for path in (self.root / "generated/json").rglob("*.json"):
            for record in json.loads(path.read_text())["libros"]:
                ed=record["edicion"]
                if ed["sku"] in by_sku:self.assertEqual(ed["portada"]["url"],by_sku[ed["sku"]])

    def test_identical_bytes_two_formats_without_isbn_null_synopsis_and_rerun(self):
        ebook_source = raw(self.root,"Ebook")
        audio_source = raw(self.root,"Audiolibros")
        ebook = inventory(self.root,"Ebook",[row(ebook_source,ebookFileFormat="EPUB")])
        audio = inventory(self.root,"Audiolibros",[row(audio_source,audioDurationSeconds="3600",narrators='["Una voz","Otra voz"]')])
        report = batch.process_batch(self.root,[ebook,audio])
        self.assertEqual(report["summary"]["accepted"],2)
        manifest = read_manifest(self.root / "generated/manifest-normalized.json")
        rows = manifest["records"]
        self.assertEqual(len({r["permanent_sku"] for r in rows}),2)
        self.assertEqual(len({r["r2_object_key"].rsplit('-',1)[1] for r in rows}),1)
        self.assertTrue(all(r["isbn13"] is None for r in rows))
        for r in rows:
            data = (self.root / "generated/r2-normalized" / r["r2_object_key"]).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest()[:12],r["r2_object_key"].rsplit('-',1)[1][:-5])
        sources = synthetic_staging(self.root)
        loaded = seed.load_catalog_seeds(seed.load_cover_manifest(self.root / "generated/manifest-normalized.json"),self.root / "sku-registry.json",tuple(sources))
        self.assertEqual({s.format for s in loaded},{"EBOOK","AUDIOBOOK"})
        self.assertTrue(all(s.synopsis is None and s.stock == 0 for s in loaded))
        before = (self.root / "sku-registry.json").read_bytes()
        again = batch.process_batch(self.root,[ebook,audio])
        self.assertEqual(again["summary"]["accepted"],2)
        self.assertEqual(before,(self.root / "sku-registry.json").read_bytes())
        self.assertEqual(manifest,read_manifest(self.root / "generated/manifest-normalized.json"))
        for path in (self.root / "generated/json").rglob("*.json"):
            doc = json.loads(path.read_text())
            ed = doc["libros"][0]["edicion"]
            self.assertIn(ed["sku"],{r["permanent_sku"] for r in rows})
            self.assertIn(ed["portada"]["url"],{r["cover_url"] for r in rows})

    def test_missing_audio_metadata_is_pending_without_sku_or_stock(self):
        source = raw(self.root,"Audiolibros")
        report = batch.process_batch(self.root,[inventory(self.root,"Audiolibros",[row(source)])])
        self.assertEqual(report["records"][0]["status"],"METADATOS_PENDIENTES")
        self.assertIsNone(report["records"][0]["sku"])
        self.assertEqual(read_manifest(self.root / "generated/manifest-normalized.json")["records"],[])
        self.assertTrue((self.root / report["records"][0]["pending_image"]).exists())

    def test_valid_evidence_reaches_admin_creation_and_replacement(self):
        source = raw(self.root,"Ebook")
        inv = inventory(self.root,"Ebook",[row(source,coverLicense="CC_BY",coverSourceUrl="https://publisher.example/cover",coverAttribution="Editorial")])
        batch.process_batch(self.root,[inv])
        seeds = seed.load_catalog_seeds(seed.load_cover_manifest(self.root / "generated/manifest-normalized.json"),self.root / "sku-registry.json",synthetic_staging(self.root))
        class Api:
            def __init__(self): self.existing=None; self.sent=[]
            def page(self,*args,**kwargs): return [] if self.existing is None else [self.existing]
            def request(self,method,path,body): self.sent.append(body); return {"editionId":"7"}
        api=Api(); seed.ensure_edition(api,seeds[0],"1","2")
        self.assertEqual(api.sent[-1]["coverLicense"],"CC_BY")
        self.assertEqual(api.sent[-1]["coverSourceUrl"],"https://publisher.example/cover")
        self.assertEqual(api.sent[-1]["coverAttribution"],"Editorial")
        self.assertEqual(api.sent[-1]["coverUrl"],seeds[0].cover_url)
        api.existing={"editionId":"7","bookId":"1","sku":seeds[0].sku,"state":"ACTIVE"}
        seed.ensure_edition(api,seeds[0],"1","2")
        self.assertEqual(api.sent[-1]["coverLicense"],"CC_BY")

    def test_invalid_license_is_pending_and_not_invented(self):
        source = raw(self.root,"Ebook")
        report=batch.process_batch(self.root,[inventory(self.root,"Ebook",[row(source,coverLicense="CC_BY")])])
        self.assertEqual(report["records"][0]["status"],"METADATOS_PENDIENTES")
        self.assertEqual(read_manifest(self.root / "generated/manifest-normalized.json")["records"],[])

    def test_configuration_ignored_and_only_named_staging_discovered(self):
        (self.root / "normalization-overrides.json").write_text('{"PLG-BK-000001":{"mode":"fill"}}')
        (self.root / "inventory.json").write_text('{"libros":[]}')
        reports=self.root / "generated/fake"; reports.mkdir(parents=True)
        (reports / "staging.json").write_text('{"libros":[]}')
        self.assertEqual(discover_staging(self.root),[])
        source=raw(self.root,"Ebook")
        report=batch.process_batch(self.root,[inventory(self.root,"Ebook",[row(source)])])
        self.assertEqual(report["summary"]["accepted"],1)

    def test_duplicate_edition_rolls_back_registry_and_manifest(self):
        source=raw(self.root,"Ebook")
        first=inventory(self.root,"Ebook",[row(source)])
        batch.process_batch(self.root,[first])
        before={p:p.read_bytes() for p in [self.root / "sku-registry.json",self.root / "generated/manifest-normalized.json"]}
        other=raw(self.root,"Ebook","other.jpg")
        inventory(self.root,"Ebook",[row(source),row(other)])
        with self.assertRaises(prepare.PreparationError): batch.process_batch(self.root,[first])
        for path,data in before.items(): self.assertEqual(path.read_bytes(),data)

    def test_preserves_all_existing_records_assignments_and_exclusion_without_normalizing_them(self):
        repo = Path(__file__).resolve().parent.parent
        shutil.copytree(repo / "covers",self.root,dirs_exist_ok=True)
        old_manifest=read_manifest(self.root / "generated/manifest-normalized.json")
        old_skus = {r["permanent_sku"] for r in old_manifest["records"]}
        old_registry=json.loads((self.root / "sku-registry.json").read_text())
        protected=[self.root / r["original_file"] for r in old_manifest["records"]]
        protected += [self.root / "generated/r2-normalized" / r["r2_object_key"] for r in old_manifest["records"]]
        protected += [p for p in discover_staging(self.root)]
        hashes={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
        source=raw(self.root,"Ebook")
        with patch.object(batch,"normalize_file",wraps=normalize_file) as process:
            report=batch.process_batch(self.root,[inventory(self.root,"Ebook",[row(source)])])
        self.assertEqual(process.call_count,1)
        after=read_manifest(self.root / "generated/manifest-normalized.json")
        rows={r["permanent_sku"]:r for r in after["records"]}
        new_sku = report["records"][0]["sku"]
        self.assertEqual(set(rows),old_skus | {new_sku})
        self.assertNotIn(new_sku,old_skus)
        self.assertNotIn("PLG-BK-000042",rows)
        for r in old_manifest["records"]: self.assertEqual(r,rows[r["permanent_sku"]])
        for path,digest in hashes.items(): self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),digest)
        registry=json.loads((self.root / "sku-registry.json").read_text())
        for old in old_registry["assignments"]: self.assertIn(old,registry["assignments"])
        self.assertEqual(report["summary"]["preserved"],len(old_skus))
        self.assertNotIn(new_sku, {assignment["sku"] for assignment in old_registry["assignments"]})
        retired = read_manifest(self.root / "retired-manifest.json")["records"]
        self.assertTrue({record["permanent_sku"] for record in retired}.isdisjoint(rows))
        seeds=seed.load_catalog_seeds(seed.load_cover_manifest(self.root / "generated/manifest-normalized.json"),
                                     self.root / "sku-registry.json", synthetic_staging(self.root))
        self.assertEqual({s.sku for s in seeds}, {new_sku})
        self.assertEqual({s.format for s in seeds}, {"EBOOK"})

    def test_additional_thematic_category_and_staged_jpg_input(self):
        source=self.root / "Ebook/Ciencia/originales/test.jpg"; source.parent.mkdir(parents=True)
        poster().save(source)
        doc={"schema":"test","libros":[{"portadaArchivo":"originales/test.jpg", "libro":{"titulo":"Ciencia", "subtitulo":None,"sinopsis":None,
            "autores":[{"nombre":"Autora","orden":1}],"categorias":["Ciencia"]},"edicion":{"formato":"EBOOK","editorial":"Editorial",
            "idioma":"es","isbn13":None,"paginas":None,"narrators":[],"portada":{"licencia":None,"atribucion":None,"fuente":"archivo_local"}}}]}
        path=source.parent.parent / "staging.json"; path.write_text(json.dumps(doc))
        report=batch.process_batch(self.root,[],[path])
        self.assertEqual(report["summary"]["accepted"],1)
        seeds=seed.load_catalog_seeds(seed.load_cover_manifest(self.root / "generated/manifest-normalized.json"),self.root / "sku-registry.json",(path,))
        self.assertEqual(seeds[0].category,"ciencia")


if __name__ == "__main__":
    unittest.main()
