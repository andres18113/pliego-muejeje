# Runtime applicability, October 24, 2026

This assessment includes advisories available through October 24, not future October disclosures. Package presence, reachable behavior and verified remediation are different claims. Tests used checksum-verified official Linux x64 binaries: Node.js 24.22.1 and Temurin 25.0.5+8. The system-wide development binaries were not replaced.

| Runtime | Observed before | Tested/configured after | Deployment observation |
| --- | --- | --- | --- |
| Java | Ubuntu OpenJDK 25.0.4.1+1 | Temurin 25.0.5+8; `.java-version` and CI pin 25.0.5 | VPS package upgraded to Temurin 25.0.5+8; running JVM verified with jcmd as the service account |
| Node.js | 24.21.0; npm 12.2.0 | 24.22.1; bundled npm 11.19.1; `.nvmrc`, engine constraints and CI | No Node.js runtime installed on VPS; Nginx serves compiled static files |
| PostgreSQL | Local server/client 18.6 | Disposable native PostgreSQL 18.6; CI minimum 18.6 | Installed server/client package and live database `SHOW server_version` both report 18.6 |
| Maven | 3.9.12 | 3.9.12 | Build tool, not a deployed application service |

SSH and explicitly authorized sudo access were used for the JVM-only update. The original running JVM (PID 21044) was verified as 25.0.4.1. After the native package update, jcmd verified PID 28272 as Temurin 25.0.5+8; the service is active with zero automatic restarts. Its configured executable remains `/usr/bin/java`. The backend JAR, frontend index, credential file, service unit, Nginx configuration and release pointers retain their preflight hashes/targets. Production Flyway remains 73/73 with an identical history fingerprint; runtime ownership/CREATE checks remain false. No application artifact release or database migration was performed.

## Node.js October 21 security release

The application is a static React frontend with a Java API. Node.js runs development, dependency installation, build and tests. The repository does not implement a production Node HTTP server, startup snapshot, single executable application, Permission Model sandbox, SQLite database or ZIP service. Tooling still performs DNS, HTTP/TLS and decompression, so updating the build runtime is necessary. No exploit against the application was attempted.

| CVE | Vendor severity | Applicability to Node 24.21.0 and this project |
| --- | --- | --- |
| CVE-2026-111497 | High | Affected Brotli decoder; attacker-supplied compressed data is the prerequisite. Build/network tooling is the relevant exposure. |
| CVE-2026-105482 | High | Affected DNS NUL validation; no application hostname-allowlist implementation in Node was found. |
| CVE-2026-105483 | High | Affected non-ASCII IPv4 TLS verification; conditional network-client exposure. |
| CVE-2026-106069 | High | Affected non-canonical IPv4 TLS verification; resolver/platform-dependent. |
| CVE-2026-105481 | Medium | Affected HTTP client socket reuse; requires an unsolicited response on a reused connection. |
| CVE-2026-106072 | Medium | Affected TLS numeric-host handling; requires a trusted DNS-only numeric certificate. |
| CVE-2026-106074 | Medium | Affected snapshot randomness; project does not create startup snapshots or SEAs. |
| CVE-2026-106070 | Low | Node 26 only; not applicable to this Node 24 project. |
| CVE-2026-106071 | Low | Node 26 only; not applicable to this Node 24 project. |
| CVE-2026-106073 | Low | Affected Permission Model API; project does not rely on that sandbox. |

All applicable listed version ranges are addressed by the verified Node 24.22.1 binary; Node 22/26 changes are unnecessary. This is release/version verification, not ten exploit reproductions. Source: [official Node.js October release advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

### Bundled libraries and certificates

These are actual `process.versions` values from the binaries used, not inferred npm dependency versions.

| Bundled component | Node 24.21.0 | Node 24.22.1 | Assessment |
| --- | --- | --- | --- |
| c-ares | 1.34.8 | 1.34.9 | Security update covering DNS memory safety, reply validation and cache handling |
| OpenSSL | 3.5.8 | 3.5.9 | September security fixes included in October Node release |
| Undici | 7.29.1 | 7.30.1 | Bundled fetch client updated; separately installed npm Undici dependencies also patched |
| SQLite | 3.53.4 | 3.53.4 | Already on the relevant patch; October SQLite change concerns Node 22, not this line |
| Brotli | 1.2.0 | 1.2.0 | Node backports the decoder fix without changing this reported upstream version |
| Root certificates | Contains emSign ECC Root CA - G3 | Neither affected root found | Verified in bundled roots and all 118 effective default certificates from tls.getCACertificates; release updates NSS roots |

c-ares 1.34.9 fixes GHSA-wpr3-8q3r-4q8c, GHSA-fqh5-3x7m-wp44, GHSA-97vq-4mxv-7vhm, GHSA-rf6g-ww74-97qh, GHSA-mw23-pfg6-2x9r, GHSA-v33j-65h4-4ch8, GHSA-pj7p-v3cw-hq66, GHSA-grv7-fq5q-9vfc, GHSA-ph6c-3cvx-mq6v, GHSA-cfcv-8v2j-qj6r and GHSA-wrgc-prmw-27xh. Not every native callback prerequisite is exposed through Node's API. [c-ares changelog](https://c-ares.org/changelog.html).

OpenSSL's September advisory lists CVE-2026-84782 (high), CVE-2026-84783 (moderate), CVE-2026-35189, CVE-2026-35191, CVE-2026-42772 and CVE-2026-54872 (low). DTLS, QUIC and special CRL/curve paths are conditional; no application use was identified. The compatible bundled patch avoids relying on that assessment. [OpenSSL advisory](https://openssl-library.org/news/secadv/20260929.txt), [Node 24.22.1 release](https://nodejs.org/en/blog/release/v24.22.1), [SQLite 3.53.4 release](https://sqlite.org/releaselog/3_53_4.html).

## Java October 20 Critical Patch Update

Java 25.0.5 is the compatible CPU baseline. The following table uses the Oracle affected-version matrix, not a blanket assertion that every Oracle Java CVE affects a Java 25 server.

| CVE | CVSS | Java 25 / application applicability |
| --- | --- | --- |
| CVE-2026-91415 | 7.0 | Java 25 affected; no server-side 2D/image-processing path identified. Java runtime patched. |
| CVE-2026-91398 | 6.8 | Java 25 affected; SOCKS5 prerequisite. No SOCKS configuration found; production JVM/environment override could not be fully checked. |
| CVE-2026-91382 | 6.5 | Oracle Java 25 is outside the listed affected range; do not report this as a Java 25 finding. |
| CVE-2026-87294 | 6.5 | Java 25 affected; security API usage makes library-level applicability relevant. Specific exploit not demonstrated. |
| CVE-2026-91395 | 6.5 | Oracle Java 25 is outside the listed affected range. |
| CVE-2026-87290 | 5.9 | Java 25 affected; billing uses JAXP/XML schema validation. Existing external-resource restrictions help but do not replace the runtime patch. |
| CVE-2026-91394 | 5.9 | Java 25 affected; backend has outbound Java HTTP clients. Exact exploit prerequisites not demonstrated. |
| CVE-2026-91484 | 7.5 | Legacy Java 8 Plugin/client issue; no Plugin or Java 8 runtime here. |
| CVE-2026-43660 | 7.5 | JavaFX/WebKit client issue; no JavaFX dependency or client runtime here. |

The patched runtime covers additional CPU fixes beyond this requested subset. [Oracle October 2026 CPU and affected-version matrix](https://www.oracle.com/security-alerts/cpuoct2026.html), [Java 25.0.5 release notes](https://www.oracle.com/java/technologies/javase/25-0-5-relnotes.html).

### Additional certificate alert: CVE-2026-91403

The October 21 JSSE certificate alert has CVSS 9.1. An October CPU version alone does not prove remediation. OpenJDK recommends inspecting the active trust store and removing the affected trust anchors or applying the documented revocation mitigation. Vendor package and operating-system trust-store behavior differ. [Oracle alert](https://www.oracle.com/security-alerts/alert-cve-2026-91403.html), [OpenJDK operating guidance](https://openjdk.org/emudhra).

The unmodified, BSD-licensed upstream [CheckCerts.java](../../../scripts/security/CheckCerts.java) is included for repeatable verification and runs in CI. Its copyright/license is retained. It uses the JVM's default trust-manager configuration and exits nonzero for either affected root.

- Original local Ubuntu OpenJDK 25.0.4.1: check failed; emSign ECC Root CA - G3 remained trusted.
- Downloaded/tested Temurin 25.0.5+8: check passed; neither affected root was trusted.
- VPS original Temurin 25.0.4.1: the same check ran over SSH and passed for its default store.
- VPS final Temurin 25.0.5+8: the check passed both normally and as the service user. Allowlisted running-JVM properties showed the patched version and no custom javax.net.ssl.trustStore override.

No production credentials or trust stores were edited. Do not infer that every Temurin or Ubuntu installation with a matching version has the same certificate state.

## Deployment and infrastructure boundaries

No tracked Dockerfile, Compose file or Docker-based workflow exists. Repository instructions prohibit adding Docker. Native deployment remains unchanged. Ubuntu's installed Nginx is `1.24.0-2ubuntu7.18`, OpenSSL `3.0.13-0ubuntu3.16`, and ca-certificates `20260816ubuntu0.24.04.1`; upstream version numbers alone cannot determine Ubuntu backport status. This audit did not patch or certify all host packages.

See the [runtime deployment addendum](../../deployment/2026-10-24-runtime-security-update.md) for the prepared Java package update and the required live-process verification. Production application dependencies remain those of the currently deployed artifact until the repository changes complete the normal pinned-CI release process.
