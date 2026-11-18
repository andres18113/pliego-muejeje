"""Offline checks for immutable responsive derivatives and upload safety."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
from test_upload_r2_covers import FakeS3, upload_module

class ResponsiveCoversTests(unittest.TestCase):
    def fixture(self, root):
        from cover_images import encode_webp
        data, _ = encode_webp(Image.new('RGB', (720, 1080), '#b24c36'), {})
        key = f'covers/editions/v2/PLG-BK-000001-{hashlib.sha256(data).hexdigest()[:12]}.webp'
        source = root / 'source' / key
        source.parent.mkdir(parents=True)
        source.write_bytes(data)
        manifest = root / 'source.json'
        manifest.write_text(json.dumps({'schema': 'pliego-cover-manifest-v1', 'records': [{'r2_object_key': key}]}))
        return manifest, root / 'source'

    def generate(self, root):
        from generate_responsive_images import generate_covers
        manifest, source = self.fixture(root)
        output = root / 'output'
        plan = generate_covers(manifest, source, output)
        return source, output, plan

    def test_manifest_generates_four_sizes_without_changing_original_and_is_repeatable(self):
        from generate_responsive_images import generate_covers
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, output, plan = self.generate(root)
            original = next(source.rglob('*.webp')).read_bytes()
            self.assertEqual(len(plan['records']), 4)
            self.assertEqual(plan['schema'], 'pliego-cover-variants-v1')
            for row, width in zip(plan['records'], (160, 240, 360, 480)):
                with Image.open(output / row['r2_object_key']) as image:
                    self.assertEqual(image.size, (width, width * 3 // 2))
            self.assertEqual(generate_covers(root/'source.json', source, output), plan)
            self.assertEqual(next(source.rglob('*.webp')).read_bytes(), original)
            target = output / plan['records'][0]['r2_object_key']
            target.write_bytes(b'conflict')
            with self.assertRaises(ValueError):
                generate_covers(root/'source.json', source, output)
            self.assertEqual(target.read_bytes(), b'conflict')

    def test_source_hash_mismatch_or_traversal_cannot_create_variants(self):
        from generate_responsive_images import generate_covers
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest, source = self.fixture(root)
            next(source.rglob('*.webp')).write_bytes(b'altered')
            with self.assertRaises(ValueError): generate_covers(manifest, source, root/'output')
            manifest.write_text(json.dumps({'schema':'pliego-cover-manifest-v1','records':[{'r2_object_key':'../escape.webp'}]}))
            with self.assertRaises(ValueError): generate_covers(manifest, source, root/'output')

    def test_variant_upload_defaults_offline_and_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as temp:
            _, output, plan = self.generate(Path(temp))
            manifest = output/'manifest.json'; manifest.write_text(json.dumps(plan))
            with patch.object(upload_module, 'create_s3_client') as client:
                self.assertEqual(upload_module.main(['--variants', '--manifest', str(manifest), '--assets-dir', str(output)]), 0)
                client.assert_not_called()
            (output/plan['records'][0]['r2_object_key']).write_bytes(b'changed')
            with self.assertRaises(upload_module.UploadError): upload_module.load_upload_plan(manifest, output)

    def test_variant_conflict_or_race_never_overwrites_and_preserves_unlisted(self):
        with tempfile.TemporaryDirectory() as temp:
            _, output, plan = self.generate(Path(temp))
            manifest=output/'manifest.json'; manifest.write_text(json.dumps(plan))
            assets,prefix=upload_module.load_upload_plan(manifest,output)
            client=FakeS3(); client.objects[assets[-1].key]={'ContentLength':9}
            result=upload_module.sync_variant_assets(client,'pliego-covers',assets,prefix)
            self.assertTrue(result['errors']); self.assertEqual(client.put_count,0)
            client=FakeS3(); client.objects['covers/editions/responsive-v1/history.webp']={'Body':b'history'}
            result=upload_module.sync_variant_assets(client,'pliego-covers',assets,prefix)
            self.assertEqual(result['errors'],[])
            self.assertEqual(client.objects['covers/editions/responsive-v1/history.webp']['Body'],b'history')
            self.assertEqual(upload_module.sync_variant_assets(client,'pliego-covers',assets,prefix)['skipped'],4)
            class Race(FakeS3):
                def put_object(self, **kwargs):
                    self.objects[kwargs['Key']]={'Body':b'raced'}
                    super().put_object(**kwargs)
            race=Race(); result=upload_module.sync_variant_assets(race,'pliego-covers',assets,prefix)
            self.assertTrue(result['errors']); self.assertEqual(race.put_count,0)
            self.assertTrue(all(v['Body']==b'raced' for v in race.objects.values()))
            wrong=FakeS3(); self.assertTrue(upload_module.sync_variant_assets(wrong,'private',assets,prefix)['errors'])
            self.assertEqual(wrong.put_count,0)

    def test_discovery_preserves_native_aspect_and_ssim_identity(self):
        from generate_responsive_images import generate_discovery, ssim_rgb
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for kind, height in [('libros',900),('ebooks',896),('audiolibros',901)]:
                Image.new('RGB',(1200,height),'#a43656').save(root/f'discovery-{kind}.webp',icc_profile=b'profile-fixture')
            before = {p.name:p.read_bytes() for p in root.glob('*.webp')}
            report = generate_discovery(root)
            self.assertEqual(len(report['records']),9)
            for row in report['records']:
                if row['width'] != 1200:
                    with Image.open(root/row['file']) as output:
                        self.assertEqual(output.info.get('icc_profile'), b'profile-fixture')
                if row['width'] == 480:
                    kind = row['file'].split('-')[1]
                    with Image.open(root/f'discovery-{kind}.webp') as source:
                        self.assertEqual(row['height'], round(source.height*480/1200))
            for name,data in before.items(): self.assertEqual((root/name).read_bytes(),data)
            image = Image.new('RGB',(24,24),'red')
            self.assertAlmostEqual(ssim_rgb(image,image),1.0)
            self.assertLess(ssim_rgb(image,Image.new('RGB',(24,24),'blue')),0.5)

if __name__ == '__main__': unittest.main()
