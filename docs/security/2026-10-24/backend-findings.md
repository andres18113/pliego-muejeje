# Backend dependency security audit — 2026-10-24

This subreport covers the dependency workstream; the separate production JVM upgrade is recorded in README.md.

Only repository change owned by this audit: `backend/pom.xml`. No approved baseline, migration, production state, or credentials changed.

## Result

- Spring Boot parent 4.1.1 → 4.1.2 (released 2026-10-23); BOM remains authoritative for all application dependencies.
- Jackson 2 core/databind 2.21.5 → 2.21.7; Jackson 3 core/databind 3.1.5 → 3.1.7; Tomcat 11.0.24 → 11.0.27; pgJDBC 42.7.13 → 42.7.14; Spring Framework 7.0.9 → 7.0.10; Spring Security 7.1.1 → 7.1.2.
- Direct libphonenumber 9.0.40 and springdoc 3.1.1 unchanged: no indexed OSV matches for their resolved graphs.
- Maven compiler 3.15.0 → 3.16.0, install/deploy 3.1.4 → 3.2.0, inherited site 3.12.1 → latest stable 3.22.0. Plugin-only dependencies patched: Plexus Utils 3.6.1/4.0.3 on their corresponding major lines, Commons Lang 3.18.0 in Boot plugin, BeanUtils 1.11.0 and jsoup 1.23.2 in site plugin.
- OSV baseline: 317 distinct Maven GAVs, 60 coordinate/advisory matches (46 unique advisories), including 17 matches across application dependencies (10 unique advisories). Final: 260 GAVs, 4 matches/4 advisories, all dormant site-plugin Jetty dependencies; zero matches in all 118 resolved project direct/transitive dependencies, including test scope.
- Repackaged runtime JAR has 77 libraries and zero Jetty libraries. Remaining plugin matches do not enter the application artifact.

## Verification

`JAVA_HOME=/tmp/pliego-security/runtime/jdk-25.0.5+8 PATH="$JAVA_HOME/bin:$PATH" mvn -B -ntp -Dmaven.repo.local=/tmp/pliego-security/backend/m2 clean verify` completed successfully at 2026-10-24 11:30:11 -05:00. Java 25.0.5; 291 tests; zero failures, errors, or skipped tests; compilation, resources, packaging, Boot repackage all passed. `git diff --check -- backend/pom.xml` passed.

The tests include controller/API suites with test doubles. This is not evidence of a live PostgreSQL integration pass; root agent is separately responsible for disposable database integration. No production deployment/restart was performed. Maven site generation and `site:run`, install and deploy goals were not executed; updated plugin dependency resolution succeeded.

## Additional vendor advisories missed by OSV

OSV is an index, not a proof of absence. Vendor review found pgJDBC CVE-2026-107314 (requireAuth exclusions fail open) and CVE-2026-107315 (padding leaks earlier statement bytes), affecting baseline 42.7.13 and fixed by the final 42.7.14. Source review found no requireAuth property, ByteStreamWriter, CopyIn, LargeObject, or Blob use. Existing setBytes calls pass whole arrays. These conditions reduce observed reachability, without proving every environment configuration. [pgJDBC security](https://jdbc.postgresql.org/security/).

Tomcat vendor advisories published through 2026-10-20 include further 11.0.24-affected issues not indexed in the OSV response: CVE-2026-103119, CVE-2026-101356, CVE-2026-101296, CVE-2026-93446, CVE-2026-88041, CVE-2026-74049, CVE-2026-74048, CVE-2026-87022, CVE-2026-86350, CVE-2026-86248, CVE-2026-79677, CVE-2026-78437, CVE-2026-78383, CVE-2026-77791, CVE-2026-77762, CVE-2026-77756, CVE-2026-76183, CVE-2026-75973, CVE-2026-73581, CVE-2026-73180, CVE-2026-68763, CVE-2026-68569, CVE-2026-66422, CVE-2026-66299, CVE-2026-65927, CVE-2026-65637, CVE-2026-65183. All listed vendor fixed versions are <= 11.0.27, now selected. Several need optional AJP, HTTP/2, Realm, WebSocket, FFM, JSP or examples configurations; we do not assert these optional paths are active. No such customizations were found in backend source. [Apache Tomcat 11 advisories](https://tomcat.apache.org/security-11.html).

Spring Security CVE-2026-41707, CVE-2026-47842 and CVE-2026-47841 were reviewed against official affected ranges: baseline 7.1.1 already contained their fixes; final 7.1.2 also does. They are not new baseline findings. [Spring advisories](https://spring.io/security/).

## Remaining site-only Jetty exposure

OSV no longer returns CVE-2025-11143 for the selected Jetty version, but the official Jetty matrix still lists versions <=9.4.58 as affected. This is a residual vendor finding, not a verified remediation.

The latest stable Maven Site Plugin 3.22.0 retains Jetty 9.4.58.v20250814 for its optional `site:run` preview server. The repository CI invokes `mvn verify`; neither application runtime nor that build starts Jetty. No public Maven Central Jetty 9.4 release newer than 9.4.58 was available during this audit. Vendor fixes in later 9.4 releases require vendor availability; substituting Jetty 12 breaks the javax.servlet/API compatibility of the site plugin. We retained stable compatible builds and report the residual findings explicitly. Do not expose `mvn site:run` as a public service.

Four exact OSV matches remain:

| Component | Advisory/CVE | Condition |
| --- | --- | --- |
| jetty-http 9.4.58 | [GHSA-355h-qmc2-wpwf / CVE-2026-2332](https://github.com/jetty/jetty.project/security/advisories/GHSA-355h-qmc2-wpwf) | Active Jetty HTTP server; chunked framing request smuggling |
| jetty-http 9.4.58 | [GHSA-qh8g-58pp-2wxh / CVE-2024-6763](https://github.com/jetty/jetty.project/security/advisories/GHSA-qh8g-58pp-2wxh) | Legacy HttpURI invalid authority parsing; vendor recommends supported Jetty 12 |
| jetty-security 9.4.58 | [GHSA-2fvj-hgj9-j2gr / CVE-2026-10050](https://github.com/jetty/jetty.project/security/advisories/GHSA-2fvj-hgj9-j2gr) | Active DigestAuthenticator; not configured by PLIEGO |
| jetty-server 9.4.58 | [GHSA-7p3p-8qv8-m2vh / CVE-2026-6790](https://github.com/jetty/jetty.project/security/advisories/GHSA-7p3p-8qv8-m2vh) | Active HTTP server/proxy authority mismatch |

Official Jetty security index additionally flags the 9.4 series for CVE-2025-11143, CVE-2026-5795, CVE-2026-12611, CVE-2026-19203, CVE-2026-77711, CVE-2026-76184, CVE-2026-18660, CVE-2026-18661, CVE-2026-19864, CVE-2026-76182, CVE-2026-18659 and CVE-2026-18662. These additional version-range matches were not returned by OSV; reachability of each optional Jetty feature was not independently demonstrated. Same dormant plugin-only scope applies. [Jetty security index](https://jetty.org/security.html).

## Application reachability notes

Jackson is present in REST JSON handling and springdoc. Source review found no custom DataInput parser, default typing, JsonTypeInfo, polymorphic type validator, or Path deserialization. Therefore package presence is confirmed but specific advisory exploitability is not asserted. Patching both Jackson major lines removes reliance on these conditions. Authentication uses Spring Security; source review did not identify Tomcat DIGEST/FORM/Realm customizations.

## Evidence and sources

- `before-inventory.csv` and `final-inventory.csv`: full direct/transitive project dependency and plugin dependency inventory, including owning plugin.
- `before-effective-pom.xml`, `final-effective-pom.xml`, `before-tree.txt`, `final-tree.txt`, `*-list.txt`, `*-plugins.txt`: resolved Maven evidence.
- `*-osv-batch.json`, `*-osv-findings.json`, `*-coordinates.json`, `*-osv-summary.txt`, `GHSA-*.json`: machine-readable advisory evidence from https://api.osv.dev/v1/querybatch.
- `final-verify.log`, `final-jar-libraries.txt`: build/test and packaged runtime verification.
- [Spring Boot 4.1.2 release](https://spring.io/blog/2026/10/23/spring-boot-4-1-2-available-now/), [Maven compiler 3.16 dependencies](https://maven.apache.org/plugins/maven-compiler-plugin/dependencies.html), [Maven site stable version](https://maven.apache.org/plugins/maven-site-plugin/plugin-info.html), [jsoup 1.23.2 release](https://github.com/jhy/jsoup/releases/tag/jsoup-1.23.2).

## Complete indexed baseline advisory disposition

| Advisory / CVE | Baseline Maven components | Final disposition |
| --- | --- | --- |
| [GHSA-2f88-5hg8-9x2x](https://osv.dev/vulnerability/GHSA-2f88-5hg8-9x2x) / CVE-2021-26291 | org.apache.maven:maven-core:3.2.5 | Patched or removed from final graph |
| [GHSA-2fvj-hgj9-j2gr](https://github.com/jetty/jetty.project/security/advisories/GHSA-2fvj-hgj9-j2gr) / CVE-2026-10050 | org.eclipse.jetty:jetty-security:9.4.46.v20220331 | Remaining dormant site-only Jetty dependency |
| [GHSA-355h-qmc2-wpwf](https://github.com/jetty/jetty.project/security/advisories/GHSA-355h-qmc2-wpwf) / CVE-2026-2332 | org.eclipse.jetty:jetty-http:9.4.46.v20220331 | Remaining dormant site-only Jetty dependency |
| [GHSA-4g9r-vxhx-9pgx](https://osv.dev/vulnerability/GHSA-4g9r-vxhx-9pgx) / CVE-2024-25710 | org.apache.commons:commons-compress:1.20 | Patched or removed from final graph |
| [GHSA-58qw-p7qm-5rvh](https://github.com/eclipse/jetty.project/security/advisories/GHSA-58qw-p7qm-5rvh) / No CVE assigned | org.eclipse.jetty:jetty-xml:9.4.46.v20220331 | Patched or removed from final graph |
| [GHSA-59j4-wjwp-mw9m](https://osv.dev/vulnerability/GHSA-59j4-wjwp-mw9m) / CVE-2020-13936 | org.apache.velocity:velocity:1.7 | Patched or removed from final graph |
| [GHSA-5mg8-w23w-74h3](https://osv.dev/vulnerability/GHSA-5mg8-w23w-74h3) / CVE-2020-8908 | com.google.guava:guava:16.0.1 | Patched or removed from final graph |
| [GHSA-65r4-943x-97jj](https://osv.dev/vulnerability/GHSA-65r4-943x-97jj) / CVE-2026-75140 | org.jsoup:jsoup:1.10.2 | Patched or removed from final graph |
| [GHSA-6fmv-xxpf-w3cw](https://osv.dev/vulnerability/GHSA-6fmv-xxpf-w3cw) / CVE-2025-67030 | org.codehaus.plexus:plexus-utils:3.4.2; org.codehaus.plexus:plexus-utils:3.5.1; org.codehaus.plexus:plexus-utils:3.6.0; org.codehaus.plexus:plexus-utils:4.0.1; org.codehaus.plexus:plexus-utils:4.0.2 | Patched or removed from final graph |
| [GHSA-6pcc-3rfx-4gpm](https://osv.dev/vulnerability/GHSA-6pcc-3rfx-4gpm) / CVE-2018-1000632 | dom4j:dom4j:1.1 | Patched or removed from final graph |
| [GHSA-6phf-73q6-gh87](https://osv.dev/vulnerability/GHSA-6phf-73q6-gh87) / CVE-2019-10086 | commons-beanutils:commons-beanutils:1.7.0 | Patched or removed from final graph |
| [GHSA-78wr-2p64-hpwj](https://osv.dev/vulnerability/GHSA-78wr-2p64-hpwj) / CVE-2024-47554 | commons-io:commons-io:2.11.0; commons-io:commons-io:2.6 | Patched or removed from final graph |
| [GHSA-7g45-4rm6-3mm3](https://osv.dev/vulnerability/GHSA-7g45-4rm6-3mm3) / CVE-2023-2976 | com.google.guava:guava:16.0.1 | Patched or removed from final graph |
| [GHSA-7hfm-57qf-j43q](https://osv.dev/vulnerability/GHSA-7hfm-57qf-j43q) / CVE-2021-35515 | org.apache.commons:commons-compress:1.20 | Patched or removed from final graph |
| [GHSA-7hhh-6rmp-j9qf](https://github.com/FasterXML/jackson-core/security/advisories/GHSA-7hhh-6rmp-j9qf) / CVE-2026-89425 | com.fasterxml.jackson.core:jackson-core:2.21.5; tools.jackson.core:jackson-core:3.1.5 | Patched or removed from final graph |
| [GHSA-7p3p-8qv8-m2vh](https://github.com/jetty/jetty.project/security/advisories/GHSA-7p3p-8qv8-m2vh) / CVE-2026-6790 | org.eclipse.jetty:jetty-server:9.4.46.v20220331 | Remaining dormant site-only Jetty dependency |
| [GHSA-8wh2-6qhj-h7j9](https://github.com/dain/snappy/security/advisories/GHSA-8wh2-6qhj-h7j9) / CVE-2024-36124 | org.iq80.snappy:snappy:0.4 | Patched or removed from final graph |
| [GHSA-9xv2-5v5q-p794](https://osv.dev/vulnerability/GHSA-9xv2-5v5q-p794) / CVE-2026-65905 | org.apache.tomcat.embed:tomcat-embed-core:11.0.24 | Patched or removed from final graph |
| [GHSA-cj7v-27pg-wf7q](https://github.com/eclipse/jetty.project/security/advisories/GHSA-cj7v-27pg-wf7q) / CVE-2022-2047 | org.eclipse.jetty:jetty-http:9.4.46.v20220331 | Patched or removed from final graph |
| [GHSA-crv7-7245-f45f](https://osv.dev/vulnerability/GHSA-crv7-7245-f45f) / CVE-2021-35516 | org.apache.commons:commons-compress:1.20 | Patched or removed from final graph |
| [GHSA-cxp5-3px4-pw24](https://github.com/FasterXML/jackson-databind/security/advisories/GHSA-cxp5-3px4-pw24) / CVE-2026-91777 | com.fasterxml.jackson.core:jackson-databind:2.21.5; tools.jackson.core:jackson-databind:3.1.5 | Patched or removed from final graph |
| [GHSA-fh63-4r66-jc7v](https://osv.dev/vulnerability/GHSA-fh63-4r66-jc7v) / CVE-2020-13959 | org.apache.velocity:velocity-tools:2.0 | Patched or removed from final graph |
| [GHSA-g8m5-722r-8whq](https://github.com/jetty/jetty.project/security/advisories/GHSA-g8m5-722r-8whq) / CVE-2024-8184 | org.eclipse.jetty:jetty-server:9.4.46.v20220331 | Patched or removed from final graph |
| [GHSA-gcx9-497g-6cp6](https://osv.dev/vulnerability/GHSA-gcx9-497g-6cp6) / CVE-2026-65182 | org.apache.tomcat.embed:tomcat-embed-core:11.0.24 | Patched or removed from final graph |
| [GHSA-gp7f-rwcx-9369](https://github.com/jhy/jsoup/security/advisories/GHSA-gp7f-rwcx-9369) / CVE-2022-36033 | org.jsoup:jsoup:1.10.2 | Patched or removed from final graph |
| [GHSA-gwrp-pvrq-jmwv](https://osv.dev/vulnerability/GHSA-gwrp-pvrq-jmwv) / CVE-2021-29425 | commons-io:commons-io:2.6 | Patched or removed from final graph |
| [GHSA-gx83-3vf8-gh7j](https://github.com/FasterXML/jackson-databind/security/advisories/GHSA-gx83-3vf8-gh7j) / CVE-2026-83557 | com.fasterxml.jackson.core:jackson-databind:2.21.5; tools.jackson.core:jackson-databind:3.1.5 | Patched or removed from final graph |
| [GHSA-h3x4-894j-xpx5](https://osv.dev/vulnerability/GHSA-h3x4-894j-xpx5) / CVE-2026-68525 | org.apache.tomcat.embed:tomcat-embed-core:11.0.24 | Patched or removed from final graph |
| [GHSA-hmr7-m48g-48f6](https://github.com/eclipse/jetty.project/security/advisories/GHSA-hmr7-m48g-48f6) / CVE-2023-40167 | org.eclipse.jetty:jetty-http:9.4.46.v20220331 | Patched or removed from final graph |
| [GHSA-hwj3-m3p6-hj38](https://osv.dev/vulnerability/GHSA-hwj3-m3p6-hj38) / CVE-2020-10683 | dom4j:dom4j:1.1 | Patched or removed from final graph |
| [GHSA-j288-q9x7-2f5v](https://osv.dev/vulnerability/GHSA-j288-q9x7-2f5v) / CVE-2025-48924 | commons-lang:commons-lang:2.4; org.apache.commons:commons-lang3:3.16.0; org.apache.commons:commons-lang3:3.8.1 | Patched or removed from final graph |
| [GHSA-m72m-mhq2-9p6c](https://github.com/jhy/jsoup/security/advisories/GHSA-m72m-mhq2-9p6c) / CVE-2021-37714 | org.jsoup:jsoup:1.10.2 | Patched or removed from final graph |
| [GHSA-mc84-pj99-q6hh](https://osv.dev/vulnerability/GHSA-mc84-pj99-q6hh) / CVE-2021-36090 | org.apache.commons:commons-compress:1.20 | Patched or removed from final graph |
| [GHSA-mvr2-9pj6-7w5j](https://osv.dev/vulnerability/GHSA-mvr2-9pj6-7w5j) / CVE-2018-10237 | com.google.guava:guava:16.0.1 | Patched or removed from final graph |
| [GHSA-p26g-97m4-6q7c](https://github.com/eclipse/jetty.project/security/advisories/GHSA-p26g-97m4-6q7c) / CVE-2023-26049 | org.eclipse.jetty:jetty-server:9.4.46.v20220331 | Patched or removed from final graph |
| [GHSA-p6pp-m3f8-5c89](https://github.com/FasterXML/jackson-core/security/advisories/GHSA-p6pp-m3f8-5c89) / CVE-2026-89407 | com.fasterxml.jackson.core:jackson-core:2.21.5; tools.jackson.core:jackson-core:3.1.5 | Patched or removed from final graph |
| [GHSA-q4rv-gq96-w7c5](https://github.com/jetty/jetty.project/security/advisories/GHSA-q4rv-gq96-w7c5) / CVE-2024-13009 | org.eclipse.jetty:jetty-server:9.4.46.v20220331 | Patched or removed from final graph |
| [GHSA-q4xh-88c3-wmh7](https://github.com/FasterXML/jackson-databind/security/advisories/GHSA-q4xh-88c3-wmh7) / CVE-2026-68497 | com.fasterxml.jackson.core:jackson-databind:2.21.5; tools.jackson.core:jackson-databind:3.1.5 | Patched or removed from final graph |
| [GHSA-qh8g-58pp-2wxh](https://github.com/jetty/jetty.project/security/advisories/GHSA-qh8g-58pp-2wxh) / CVE-2024-6763 | org.eclipse.jetty:jetty-http:9.4.46.v20220331 | Remaining dormant site-only Jetty dependency |
| [GHSA-qw69-rqj8-6qw8](https://github.com/eclipse/jetty.project/security/advisories/GHSA-qw69-rqj8-6qw8) / CVE-2023-26048 | org.eclipse.jetty:jetty-server:9.4.46.v20220331 | Patched or removed from final graph |
| [GHSA-wh3p-fphp-9h2m](https://github.com/codehaus-plexus/plexus-archiver/security/advisories/GHSA-wh3p-fphp-9h2m) / CVE-2023-37460 | org.codehaus.plexus:plexus-archiver:4.2.7 | Patched or removed from final graph |
| [GHSA-wjgm-6hv5-3cvf](https://github.com/FasterXML/jackson-databind/security/advisories/GHSA-wjgm-6hv5-3cvf) / CVE-2026-19032 | com.fasterxml.jackson.core:jackson-databind:2.21.5; tools.jackson.core:jackson-databind:3.1.5 | Patched or removed from final graph |
| [GHSA-wjpw-4j6x-6rwh](https://github.com/jetty/jetty.project/security/advisories/GHSA-wjpw-4j6x-6rwh) / CVE-2025-11143 | org.eclipse.jetty:jetty-http:9.4.46.v20220331 | Vendor still affects final 9.4.58; absent from final OSV response, not resolved |
| [GHSA-wv8q-qhhj-9h54](https://github.com/FasterXML/jackson-databind/security/advisories/GHSA-wv8q-qhhj-9h54) / CVE-2026-91776 | com.fasterxml.jackson.core:jackson-databind:2.21.5; tools.jackson.core:jackson-databind:3.1.5 | Patched or removed from final graph |
| [GHSA-wxr5-93ph-8wr9](https://osv.dev/vulnerability/GHSA-wxr5-93ph-8wr9) / CVE-2025-48734 | commons-beanutils:commons-beanutils:1.7.0 | Patched or removed from final graph |
| [GHSA-xqfj-vm6h-2x34](https://osv.dev/vulnerability/GHSA-xqfj-vm6h-2x34) / CVE-2021-35517 | org.apache.commons:commons-compress:1.20 | Patched or removed from final graph |
