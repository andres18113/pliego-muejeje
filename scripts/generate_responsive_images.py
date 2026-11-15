#!/usr/bin/env python3
"""Offline derivatives. Run after physical/digital normalization; never uploads.

responsive-v1 freezes Lanczos + quality 86/method 6 WebP at 160/240/360/480.
Changing that policy requires a new prefix; conflicting immutable bytes fail.
Original manifests and source objects are never modified. Pillow/NumPy are the
same dependencies as requirements-covers.txt. CLI requires explicit output paths.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import numpy as np
from PIL import Image, features
from cover_images import encode_webp

WIDTHS = (160, 240, 360, 480)
VARIANT_PREFIX = 'covers/editions/responsive-v1/'
SOURCE_KEY = re.compile(r'covers/editions/v2/(PLG-BK-\d{6,}-([0-9a-f]{12}))\.webp')


def immutable_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('xb') as stream:
            stream.write(data)
    except FileExistsError:
        if path.read_bytes() != data:
            raise ValueError(f'Objeto inmutable diferente: {path}')


def generate_covers(manifest_path: Path, source_root: Path, output_root: Path) -> dict:
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('schema') != 'pliego-cover-manifest-v1' or not isinstance(manifest.get('records'), list):
        raise ValueError('Manifiesto de portadas inválido.')
    rows, seen = [], set()
    source_root = source_root.resolve()
    for record in manifest['records']:
        key = record.get('r2_object_key', '')
        match = SOURCE_KEY.fullmatch(key)
        if not match or key in seen:
            raise ValueError(f'Clave v2 inválida o duplicada: {key}')
        seen.add(key)
        path = (source_root / key).resolve()
        if not path.is_relative_to(source_root):
            raise ValueError('Fuente fuera del directorio permitido.')
        source = path.read_bytes()
        if hashlib.sha256(source).hexdigest()[:12] != match[2]:
            raise ValueError(f'Hash de fuente diferente: {key}')
        with Image.open(io.BytesIO(source)) as opened:
            if opened.format != 'WEBP' or opened.size != (720, 1080) or getattr(opened, 'n_frames', 1) != 1:
                raise ValueError(f'Se requiere WebP 720×1080 estático: {key}')
            image = opened.convert('RGB')
        for width in WIDTHS:
            resized = image.resize((width, width * 3 // 2), Image.Resampling.LANCZOS)
            data, details = encode_webp(resized, {})
            if details['quality'] != 86:
                raise ValueError('La política responsive-v1 requiere calidad 86.')
            target_key = f'{VARIANT_PREFIX}{match[1]}-w{width}.webp'
            immutable_write(output_root / target_key, data)
            rows.append(dict(r2_object_key=target_key, source_key=key, width=width,
                             height=width*3//2, size=len(data), sha256=details['sha256']))
    return dict(schema='pliego-cover-variants-v1', records=rows)


def ssim_rgb(reference: Image.Image, decoded: Image.Image) -> float:
    """Wang SSIM: RGB channel mean, Gaussian 11×11 sigma=1.5, valid windows,
    population covariance, K1=.01/K2=.03, range=255. Pure NumPy offline fallback.
    No equivalence to scikit-image defaults (which use a uniform window) claimed.
    """
    x, y = np.asarray(reference, dtype=np.float64), np.asarray(decoded, dtype=np.float64)
    kernel = np.exp(-(np.arange(-5, 6, dtype=float)**2)/(2*1.5**2))
    kernel /= kernel.sum()
    def blur(a):
        a = sum(kernel[i] * a[i:a.shape[0]-10+i] for i in range(11))
        return sum(kernel[i] * a[:, i:a.shape[1]-10+i] for i in range(11))
    mx, my = blur(x), blur(y)
    vx, vy, cov = blur(x*x)-mx*mx, blur(y*y)-my*my, blur(x*y)-mx*my
    c1, c2 = (0.01*255)**2, (0.03*255)**2
    return float(np.mean(((2*mx*my+c1)*(2*cov+c2))/((mx*mx+my*my+c1)*(vx+vy+c2))))


def generate_discovery(asset_root: Path) -> dict:
    rows = []
    for kind in ('libros', 'ebooks', 'audiolibros'):
        source = asset_root / f'discovery-{kind}.webp'
        with Image.open(source) as opened:
            if opened.width != 1200 or opened.format != 'WEBP' or getattr(opened, 'n_frames', 1) != 1:
                raise ValueError(f'Foto de origen inesperada: {source}')
            image = opened.convert('RGB')
        rows.append(dict(file=source.name, width=image.width, height=image.height, bytes=source.stat().st_size, ssim=1.0))
        for width in (480, 800):
            height = round(image.height * width / image.width)
            reference = image.resize((width, height), Image.Resampling.LANCZOS)
            stream = io.BytesIO()
            reference.save(stream, format='WEBP', quality=86, method=6,
                           icc_profile=image.info.get('icc_profile', b''))
            data = stream.getvalue()
            target = asset_root / f'discovery-{kind}-{width}w.webp'
            immutable_write(target, data)
            decoded = Image.open(io.BytesIO(data)).convert('RGB')
            mse = np.mean((np.asarray(reference, dtype=float)-np.asarray(decoded, dtype=float))**2)
            rows.append(dict(file=target.name, width=width, height=height, bytes=len(data),
                             ssim=ssim_rgb(reference, decoded), psnr=float(10*np.log10(255**2/mse)),
                             sha256=hashlib.sha256(data).hexdigest()))
    return dict(environment=dict(pillow=Image.__version__, webp=features.version('webp')),
                quality=86, method=6, records=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    covers = sub.add_parser('covers')
    covers.add_argument('--manifest', required=True, type=Path)
    covers.add_argument('--source-root', required=True, type=Path)
    covers.add_argument('--output-root', required=True, type=Path)
    covers.add_argument('--output-manifest', required=True, type=Path)
    photos = sub.add_parser('discovery')
    photos.add_argument('--asset-root', required=True, type=Path)
    photos.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    if args.mode == 'covers':
        result = generate_covers(args.manifest, args.source_root, args.output_root)
        target = args.output_manifest
    else:
        result = generate_discovery(args.asset_root)
        target = args.report
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2, ensure_ascii=False)+'\n')
    print(f'{len(result["records"])} registros; {target}')

if __name__ == '__main__': main()
