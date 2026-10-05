#!/usr/bin/env python3
"""Sync locally prepared cover assets to an S3-compatible R2 bucket."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlsplit


CONTENT_TYPE = "image/webp"
CACHE_CONTROL = "public, max-age=31536000, immutable"
SHA256_METADATA_KEY = "sha256"
REQUIRED_ENV = (
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_ENDPOINT",
    "R2_BUCKET",
)


class UploadError(Exception):
    pass


@dataclass(frozen=True)
class UploadAsset:
    key: str
    path: Path
    size: int
    sha256: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_upload_plan(manifest_path: Path, assets_dir: Path) -> tuple[list[UploadAsset], str]:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise UploadError(f"Cannot read manifest: {type(error).__name__}") from None
    if not isinstance(manifest, dict) or not isinstance(manifest.get("records"), list):
        raise UploadError("Manifest must contain a records array")

    root = assets_dir.resolve()
    assets: list[UploadAsset] = []
    seen_keys: set[str] = set()
    prefixes: set[str] = set()
    for index, record in enumerate(manifest["records"]):
        if not isinstance(record, dict):
            raise UploadError(f"Manifest record {index} must be an object")
        key = record.get("r2_object_key")
        if not isinstance(key, str) or not key:
            raise UploadError(f"Manifest record {index} is missing r2_object_key")
        posix_key = PurePosixPath(key)
        if posix_key.is_absolute() or ".." in posix_key.parts or "\\" in key or posix_key.as_posix() != key:
            raise UploadError(f"Manifest record {index} has an unsafe object key")
        if posix_key.suffix.casefold() != ".webp":
            raise UploadError(f"Manifest object key must end in .webp: {key}")
        if key in seen_keys:
            raise UploadError(f"Manifest contains duplicate object key: {key}")
        seen_keys.add(key)
        prefixes.add(key.rpartition("/")[0] + "/" if "/" in key else "")

        local_path = (root / Path(*posix_key.parts)).resolve()
        try:
            local_path.relative_to(root)
        except ValueError:
            raise UploadError(f"Manifest object key escapes the local asset directory: {key}") from None
        if not local_path.is_file():
            raise UploadError(f"Local asset is missing for object key: {key}")
        try:
            size = local_path.stat().st_size
            digest = sha256_file(local_path)
        except OSError as error:
            raise UploadError(f"Cannot read local asset for {key}: {type(error).__name__}") from None
        assets.append(UploadAsset(key=key, path=local_path, size=size, sha256=digest))

    if len(prefixes) > 1:
        raise UploadError("Manifest object keys must share one object-key prefix")
    prefix = next(iter(prefixes), "")
    return assets, prefix


def required_configuration(environ: dict[str, str] | os._Environ[str] = os.environ) -> dict[str, str]:
    missing = [name for name in REQUIRED_ENV if not environ.get(name)]
    if missing:
        raise UploadError("Missing required environment variables: " + ", ".join(missing))
    endpoint = environ["R2_ENDPOINT"]
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        raise UploadError("R2_ENDPOINT must be an HTTP or HTTPS endpoint URL")
    return {
        "access_key_id": environ["R2_ACCESS_KEY_ID"],
        "secret_access_key": environ["R2_SECRET_ACCESS_KEY"],
        "endpoint": endpoint,
        "bucket": environ["R2_BUCKET"],
    }


def create_s3_client(configuration: dict[str, str]) -> Any:
    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        raise UploadError("boto3 is required; install scripts/requirements-r2.txt") from None
    return boto3.client(
        "s3",
        endpoint_url=configuration["endpoint"],
        region_name="auto",
        aws_access_key_id=configuration["access_key_id"],
        aws_secret_access_key=configuration["secret_access_key"],
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 4, "mode": "standard"},
        ),
    )


def _is_missing_object(error: Exception) -> bool:
    if isinstance(error, FileNotFoundError):
        return True
    response = getattr(error, "response", {})
    error_code = response.get("Error", {}).get("Code")
    status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return error_code in {"404", "NoSuchKey", "NotFound"} or status == 404


def _safe_error(error: Exception) -> str:
    response = getattr(error, "response", {})
    error_code = response.get("Error", {}).get("Code")
    status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    if error_code or status:
        return f"{error_code or 'S3Error'}" + (f" (HTTP {status})" if status else "")
    return type(error).__name__


def _is_current_object(head: dict[str, Any], asset: UploadAsset) -> bool:
    metadata = head.get("Metadata") or {}
    return (
        head.get("ContentLength") == asset.size
        and head.get("ContentType") == CONTENT_TYPE
        and head.get("CacheControl") == CACHE_CONTROL
        and metadata.get(SHA256_METADATA_KEY) == asset.sha256
    )


def _list_keys(client: Any, bucket: str, prefix: str) -> set[str]:
    keys: set[str] = set()
    continuation_token: str | None = None
    while True:
        request: dict[str, Any] = {"Bucket": bucket, "Prefix": prefix}
        if continuation_token:
            request["ContinuationToken"] = continuation_token
        response = client.list_objects_v2(**request)
        for item in response.get("Contents", []):
            key = item.get("Key")
            if isinstance(key, str):
                keys.add(key)
        if not response.get("IsTruncated"):
            return keys
        continuation_token = response.get("NextContinuationToken")
        if not continuation_token:
            raise UploadError("R2 object listing was truncated without a continuation token")


def sync_assets(client: Any, bucket: str, assets: list[UploadAsset], prefix: str,
                allowed_existing_keys: set[str] | None = None) -> dict[str, Any]:
    errors: list[str] = []
    uploaded = 0
    skipped = 0
    expected_keys = {asset.key for asset in assets}

    for asset in assets:
        try:
            head = client.head_object(Bucket=bucket, Key=asset.key)
        except Exception as error:
            if _is_missing_object(error):
                head = None
            else:
                errors.append(f"{asset.key}: HEAD failed ({_safe_error(error)})")
                continue

        if head is not None and _is_current_object(head, asset):
            skipped += 1
            continue
        try:
            with asset.path.open("rb") as source:
                client.put_object(
                    Bucket=bucket,
                    Key=asset.key,
                    Body=source,
                    ContentLength=asset.size,
                    ContentType=CONTENT_TYPE,
                    CacheControl=CACHE_CONTROL,
                    Metadata={SHA256_METADATA_KEY: asset.sha256},
                )
            uploaded += 1
        except Exception as error:
            errors.append(f"{asset.key}: upload failed ({_safe_error(error)})")

    try:
        remote_keys = _list_keys(client, bucket, prefix)
        unexpected = sorted(remote_keys - expected_keys - (allowed_existing_keys or set()))
        missing = sorted(expected_keys - remote_keys)
        if unexpected:
            errors.append(
                f"R2 contains {len(unexpected)} unexpected key(s) under {prefix!r}: "
                + ", ".join(unexpected[:10])
            )
        if missing:
            errors.append(
                f"R2 is missing {len(missing)} manifest key(s): " + ", ".join(missing[:10])
            )
    except Exception as error:
        errors.append(f"R2 key listing failed ({_safe_error(error)})")
        remote_keys = set()

    verified = 0
    for asset in assets:
        if asset.key not in remote_keys:
            continue
        try:
            head = client.head_object(Bucket=bucket, Key=asset.key)
        except Exception as error:
            errors.append(f"{asset.key}: verification HEAD failed ({_safe_error(error)})")
            continue
        if not _is_current_object(head, asset):
            errors.append(f"{asset.key}: uploaded metadata or content checksum does not match local asset")
            continue
        verified += 1

    return {
        "local_count": len(assets),
        "uploaded": uploaded,
        "skipped": skipped,
        "verified_count": verified,
        "prefix": prefix,
        "errors": errors,
    }


def main(argv: list[str] | None = None) -> int:
    repository_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=repository_root / "covers/generated/manifest.json")
    parser.add_argument("--assets-dir", type=Path, default=repository_root / "covers/generated/r2")
    args = parser.parse_args(argv)

    try:
        assets, prefix = load_upload_plan(args.manifest, args.assets_dir)
        configuration = required_configuration()
        client = create_s3_client(configuration)
    except UploadError as error:
        print(f"R2 cover sync failed: {error}", file=sys.stderr)
        return 1

    result = sync_assets(client, configuration["bucket"], assets, prefix)
    print(
        f"Local assets: {result['local_count']}; uploaded: {result['uploaded']}; "
        f"skipped: {result['skipped']}; verified R2 objects: {result['verified_count']}"
    )
    print(f"Object-key prefix: {result['prefix']}")
    for error in result["errors"]:
        print(f"Error: {error}", file=sys.stderr)
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
