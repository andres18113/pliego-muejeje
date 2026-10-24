# Auxiliary Python dependency security audit — 2026-10-24

Scope: scripts/requirements-covers.txt plus the resolved scripts/requirements-r2.txt graph. Project change is exactly Pillow==12.3.0 → Pillow==13.0.0. NumPy==2.5.3 and the boto3>=1.34,<2 constraint remain unchanged. No application, UI, database, production, or image assets changed.

## Security release and compatibility

- PyPI release metadata: https://pypi.org/pypi/Pillow/json (snapshot pillow-pypi.json). Last 12.x release is 12.3.0 (2026-07-01); no patched 12.x backport exists in published history as of cutoff. 13.0.0 published 2026-10-16T22:15:24.672561Z. All 37 baseline Pillow records specify 13.0.0 as fixed version. This major change is necessary for security remediation.
- Official security release notes: https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html . Release fixes include native storage corruption, JPEG decoder overflow, TIFF encoder overflow, image parsing denial of service and other advisories.
- Pillow13 requires Python>=3.11, dropping3.10. Existing NumPy2.5.3 already requires >=3.12 (https://pypi.org/pypi/numpy/2.5.3/json). Test interpreter is Python3.14.4 and CI uses ubuntu-latest Python. No new effective runtime minimum is introduced into this requirements set.
- Reviewed used API surface: Image.open/load/convert/resize/save, ImageOps.exif_transpose, ImageCms profiles, ImageFilter.FIND_EDGES, RGB/RGBA/L modes, WebP encoding. None of the removed APIs/mode behaviors listed under backwards incompatible changes is used.

## Evidence

- Install: python-install-final.log, exit0. Temporary scanner venv pip25.1.1 upgraded to26.2.2 (published2026-10-20) only to remediate scanner environment advisories; pip is not an application dependency; the root audit subsequently pinned CI pip to 26.2.2 before cover dependency installation and added weekly pip update coverage.
- Existing full suite: python -m unittest discover -s scripts -p test_*.py; 132tests, 6.699seconds, OK, exit0 (python-tests-final.log).
- python -m pip check: No broken requirements found, exit0.
- Full installed environment pip-audit (both requirements files plus scanner tooling):36packages, zero known vulnerabilities, exit0 (python-audit-final.json/log). No ignore flags or suppressions.
- Eight fixed source fixtures generated with isolated Pillow12.3.0 and normalized/encoded independently under12.3.0 and13.0.0: alpha PNG, gradient PNG, grayscale PNG, ICC PNG, EXIF oriented JPEG, RGB JPEG/PNG/WebP. All eight match pixel SHA256, output WebP byte SHA256, quality, sizes and full normalization details exactly. Evidence pillow12-outputs.json, pillow13-outputs.json, compare-pillow-output.py. This is fixture coverage, not a proof for every possible image.

## Original Pillow findings

All 37 advisory records were publicly available before 2026-10-24. 29 publication dates are GitHub global advisory API published_at; remaining8 are repository publication timestamps embedded in GitHub global advisory HTML (date type marked). Full API/HTML snapshots are retained alongside this report. Scanner raw severity can differ from publisher release-note grouping; no severity filtering was applied. Each listed advisory is resolved by13.0.0.

| CVE or ID | GHSA | Publication (UTC) | Metadata source | Fixed |
|---|---|---|---|---|
| CVE-2026-112895 | [GHSA-p4wg-p73j-c528](https://github.com/python-pillow/Pillow/security/advisories/GHSA-p4wg-p73j-c528) | 2026-10-20T20:50:49Z | global API | 13.0.0 |
| CVE-2026-112400 | [GHSA-65qm-jvmh-6pqg](https://github.com/python-pillow/Pillow/security/advisories/GHSA-65qm-jvmh-6pqg) | 2026-10-20T20:53:36Z | global API | 13.0.0 |
| CVE-2026-112397 | [GHSA-58r4-6rv3-gfh8](https://github.com/python-pillow/Pillow/security/advisories/GHSA-58r4-6rv3-gfh8) | 2026-10-20T20:56:22Z | global API | 13.0.0 |
| CVE-2026-112896 | [GHSA-pchr-8j38-3x4p](https://github.com/python-pillow/Pillow/security/advisories/GHSA-pchr-8j38-3x4p) | 2026-10-20T20:51:40Z | global API | 13.0.0 |
| CVE-2026-112897 | [GHSA-q45j-58j2-45rg](https://github.com/python-pillow/Pillow/security/advisories/GHSA-q45j-58j2-45rg) | 2026-10-20T20:52:43Z | global API | 13.0.0 |
| CVE-2026-112395 | [GHSA-462x-pgg6-55fp](https://github.com/python-pillow/Pillow/security/advisories/GHSA-462x-pgg6-55fp) | 2026-10-20T20:49:26Z | global API | 13.0.0 |
| CVE-2026-112404 | [GHSA-c6hw-5grf-ff96](https://github.com/python-pillow/Pillow/security/advisories/GHSA-c6hw-5grf-ff96) | 2026-10-20T20:42:00Z | global API | 13.0.0 |
| CVE-2026-112899 | [GHSA-vx6w-vv9f-6gvg](https://github.com/python-pillow/Pillow/security/advisories/GHSA-vx6w-vv9f-6gvg) | 2026-10-20T20:53:21Z | global API | 13.0.0 |
| CVE-2026-112402 | [GHSA-7mwm-ghpf-9vrm](https://github.com/python-pillow/Pillow/security/advisories/GHSA-7mwm-ghpf-9vrm) | 2026-10-21T20:03:56Z | global API | 13.0.0 |
| CVE-2026-112900 | [GHSA-w889-685w-c8fh](https://github.com/python-pillow/Pillow/security/advisories/GHSA-w889-685w-c8fh) | 2026-10-21T19:58:44Z | global API | 13.0.0 |
| CVE-2026-112893 | [GHSA-j4m9-6w36-pw47](https://github.com/python-pillow/Pillow/security/advisories/GHSA-j4m9-6w36-pw47) | 2026-10-21T20:06:34Z | global API | 13.0.0 |
| CVE-2026-112392 | [GHSA-27h8-gf7j-v5hc](https://github.com/python-pillow/Pillow/security/advisories/GHSA-27h8-gf7j-v5hc) | 2026-10-21T20:32:37Z | global API | 13.0.0 |
| CVE-2026-112891 | [GHSA-fc9g-5qg7-mf45](https://github.com/python-pillow/Pillow/security/advisories/GHSA-fc9g-5qg7-mf45) | 2026-10-21T20:38:43Z | global API | 13.0.0 |
| CVE-2026-112405 | [GHSA-cp9v-662q-vvx9](https://github.com/python-pillow/Pillow/security/advisories/GHSA-cp9v-662q-vvx9) | 2026-10-21T20:30:25Z | global API | 13.0.0 |
| CVE-2026-112390 | [GHSA-22hg-r758-rrw9](https://github.com/python-pillow/Pillow/security/advisories/GHSA-22hg-r758-rrw9) | 2026-10-21T20:39:49Z | global API | 13.0.0 |
| CVE-2026-112401 | [GHSA-74r2-7ff9-mjj2](https://github.com/python-pillow/Pillow/security/advisories/GHSA-74r2-7ff9-mjj2) | 2026-10-21T20:42:11Z | global API | 13.0.0 |
| CVE-2026-112901 | [GHSA-xgh8-jp6q-p5x8](https://github.com/python-pillow/Pillow/security/advisories/GHSA-xgh8-jp6q-p5x8) | 2026-10-21T20:45:06Z | global API | 13.0.0 |
| CVE-2026-112391 | [GHSA-254f-3936-288h](https://github.com/python-pillow/Pillow/security/advisories/GHSA-254f-3936-288h) | 2026-10-21T21:11:07Z | global API | 13.0.0 |
| CVE-2026-112894 | [GHSA-jg86-v3jv-hrpm](https://github.com/python-pillow/Pillow/security/advisories/GHSA-jg86-v3jv-hrpm) | 2026-10-21T21:11:44Z | global API | 13.0.0 |
| CVE-2026-112406 | [GHSA-f2g6-542v-9j58](https://github.com/python-pillow/Pillow/security/advisories/GHSA-f2g6-542v-9j58) | 2026-10-21T21:21:07Z | global API | 13.0.0 |
| CVE-2026-112399 | [GHSA-5xm2-6676-qcp9](https://github.com/python-pillow/Pillow/security/advisories/GHSA-5xm2-6676-qcp9) | 2026-10-21T21:17:56Z | global API | 13.0.0 |
| CVE-2026-112892 | [GHSA-gg2r-wvfm-q9rx](https://github.com/python-pillow/Pillow/security/advisories/GHSA-gg2r-wvfm-q9rx) | 2026-10-21T21:12:56Z | global API | 13.0.0 |
| CVE-2026-112393 | [GHSA-332p-7hrc-92wf](https://github.com/python-pillow/Pillow/security/advisories/GHSA-332p-7hrc-92wf) | 2026-10-21T21:28:09Z | global API | 13.0.0 |
| CVE-2026-112396 | [GHSA-4rr5-89j8-mwwm](https://github.com/python-pillow/Pillow/security/advisories/GHSA-4rr5-89j8-mwwm) | 2026-10-21T21:24:19Z | global API | 13.0.0 |
| CVE-2026-96638 | [GHSA-24rc-8hj2-v98c](https://github.com/python-pillow/Pillow/security/advisories/GHSA-24rc-8hj2-v98c) | 2026-10-22T15:59:35Z | global API | 13.0.0 |
| CVE-2026-96641 | [GHSA-4rm8-3hmm-39fg](https://github.com/python-pillow/Pillow/security/advisories/GHSA-4rm8-3hmm-39fg) | 2026-10-22T16:01:14Z | global API | 13.0.0 |
| CVE-2026-96640 | [GHSA-mrfp-p49p-3hf2](https://github.com/python-pillow/Pillow/security/advisories/GHSA-mrfp-p49p-3hf2) | 2026-10-22T16:00:47Z | global API | 13.0.0 |
| CVE-2026-96642 | [GHSA-3j72-p6qg-6xp7](https://github.com/python-pillow/Pillow/security/advisories/GHSA-3j72-p6qg-6xp7) | 2026-10-22T16:01:46Z | global API | 13.0.0 |
| CVE-2026-96639 | [GHSA-v9pv-5gc8-w2m6](https://github.com/python-pillow/Pillow/security/advisories/GHSA-v9pv-5gc8-w2m6) | 2026-10-22T16:00:15Z | global API | 13.0.0 |
| CVE-2026-96643 | [GHSA-g4qv-2jxx-769h](https://github.com/python-pillow/Pillow/security/advisories/GHSA-g4qv-2jxx-769h) | 2026-10-17T10:35:16Z | repository HTML | 13.0.0 |
| CVE-2026-96637 | [GHSA-g842-9rc4-69pw](https://github.com/python-pillow/Pillow/security/advisories/GHSA-g842-9rc4-69pw) | 2026-10-17T10:34:57Z | repository HTML | 13.0.0 |
| CVE-2026-96644 | [GHSA-9v9v-9qvf-h2hj](https://github.com/python-pillow/Pillow/security/advisories/GHSA-9v9v-9qvf-h2hj) | 2026-10-17T10:34:42Z | repository HTML | 13.0.0 |
| CVE-2026-96778 | [GHSA-g7cr-3p24-7wf7](https://github.com/python-pillow/Pillow/security/advisories/GHSA-g7cr-3p24-7wf7) | 2026-10-17T10:35:22Z | repository HTML | 13.0.0 |
| CVE-2026-96636 | [GHSA-p8hx-v2p6-rp84](https://github.com/python-pillow/Pillow/security/advisories/GHSA-p8hx-v2p6-rp84) | 2026-10-17T10:43:29Z | repository HTML | 13.0.0 |
| GHSA-78g4-xqwv-q3g8 | [GHSA-78g4-xqwv-q3g8](https://github.com/python-pillow/Pillow/security/advisories/GHSA-78g4-xqwv-q3g8) | 2026-10-17T10:33:53Z | repository HTML | 13.0.0 |
| CVE-2026-114501 | [GHSA-654x-cwwv-5j9c](https://github.com/python-pillow/Pillow/security/advisories/GHSA-654x-cwwv-5j9c) | 2026-10-19T09:47:19Z | repository HTML | 13.0.0 |
| CVE-2026-112398 | [GHSA-5x8w-8jj5-q52h](https://github.com/python-pillow/Pillow/security/advisories/GHSA-5x8w-8jj5-q52h) | 2026-10-17T20:36:23Z | repository HTML | 13.0.0 |

## Final resolved inventory

Includes audit tooling and installer; not all packages are application requirements.

| Package | Version |
|---|---|
| boolean.py | 5.0 |
| boto3 | 1.43.118 |
| botocore | 1.43.118 |
| CacheControl | 0.14.4 |
| certifi | 2026.10.23 |
| charset-normalizer | 3.5.2 |
| cyclonedx-python-lib | 11.12.0 |
| defusedxml | 0.7.1 |
| filelock | 4.2.4 |
| idna | 3.20 |
| jmespath | 1.1.0 |
| license-expression | 30.4.4 |
| markdown-it-py | 4.2.0 |
| mdurl | 0.1.2 |
| msgpack | 1.2.3 |
| numpy | 2.5.3 |
| packageurl-python | 0.17.6 |
| packaging | 26.3 |
| pillow | 13.0.0 |
| pip | 26.2.2 |
| pip_api | 0.0.35 |
| pip_audit | 2.10.1 |
| pip-requirements-parser | 32.0.1 |
| platformdirs | 4.13.5 |
| py-serializable | 2.1.0 |
| Pygments | 2.21.0 |
| pyparsing | 3.3.3 |
| python-dateutil | 2.9.0.post0 |
| requests | 2.34.2 |
| rich | 15.0.0 |
| s3transfer | 0.19.3 |
| six | 1.17.0 |
| sortedcontainers | 2.4.0 |
| tomli | 2.5.0 |
| tomli_w | 1.2.0 |
| urllib3 | 2.8.0 |
