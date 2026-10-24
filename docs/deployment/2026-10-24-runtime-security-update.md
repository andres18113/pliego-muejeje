# October 2026 runtime security update

This addendum defines the runtime baseline for the security changes in this checkout. Follow the [canonical production runbook](production-runbook.md) and the deployment skill for any production execution. It does not replace their authorization, locking, backup or rollback rules.

## Required versions

- Build/development Node.js: **24.22.1**, or a later patched 24.x release. `.nvmrc`, npm engine constraints and both CI Node setup steps select this line. The VPS serves static frontend assets and has no Node.js runtime to upgrade.
- Backend/build Java: **25.0.5**, or a later patched Java 25 distribution, plus a successful `CheckCerts.java` result against the actual effective trust store. `.java-version` and CI select Temurin 25.0.5; the tested build is 25.0.5+8.
- PostgreSQL: **18.6** or later in the 18.x line. Installed local and production packages already report 18.6. CI checks the server patch floor.
- No Docker configuration exists or is introduced. Do not replace the native deployment architecture.

Use the matching version manager with `.nvmrc` and `.java-version`, or explicitly set `JAVA_HOME` and `PATH` to verified installed distributions. This audit downloaded and checksum-verified binaries under `/tmp/pliego-security/runtime`; tests used those paths. It did not replace `/usr/bin/java`, `/usr/bin/node`, personal shell configuration, or system packages on the development host.

## Observed production state

Read-only SSH verification succeeded on October 24, 2026. `pliego.service` was running, configured with `/usr/bin/java`, which resolves to `/usr/lib/jvm/temurin-25-jdk-amd64/bin/java`. Installed package: `temurin-25-jdk=25.0.4.1.0+1-0`. The configured runtime is below the October CPU baseline. The default trust-store check already passes, but that does not replace the CPU update or establish custom process settings.

The explicitly authorized JVM-only update was completed using the configured Adoptium package **25.0.5.0.0+8-1**. `jcmd` as `pliego` verified the final live process, PID 28272, as **25.0.5+8**. The backend is active with zero automatic restarts. The certificate check passes as the service user, and no custom trust-store override appeared in allowlisted JVM properties. Public frontend/catalog requests returned 200; anonymous profile access returned 401. Browser-compatible requests were required because Cloudflare rejects the default Python user agent with error 1010.

The exclusive deployment lock was held during operating steps. Both old/new packages and private logs remain under `/opt/pliego/deployment/runtime-security-20261024/`. APT simulation and installation changed only Temurin. The first post-update service-user check could not read its source via `/dev/stdin`; the prepared package rollback restored the original runtime. After placing the public checker in a root-owned readable location, its command was preflighted and the JVM update completed. The backend was intentionally stopped during package replacements; rollback was exercised, not merely planned. Queued interactive commands after package installation were not executed, so the service start was reissued separately; execute and check each operating phase before sending the next.

Backend/frontend pointers remain `20261021-a298dc4`. Hash comparisons verified the JAR, frontend index, credentials, systemd unit and Nginx files unchanged. Production Flyway remains **73/73** with identical history fingerprint, PostgreSQL reports **18.6**, and all four runtime ownership/CREATE checks remain false. No application release, credential edit, privilege change or schema migration was performed.

## Prepared operating sequence

These steps are for the authorized privileged operator. Revalidate the exact installed/candidate versions first; the values below are a dated observation. Do not copy a password into commands or chat.

1. Acquire the production deployment lock in one persistent privileged shell, as in the canonical runbook. Record the current service state, package version, executable and release pointers in a private evidence directory. Confirm that this operation changes only the JVM package and restarts the existing artifact; it is not an application deployment or migration.
2. Download the installed Java package for rollback and the approved patched package using the configured, authenticated package repository. Preserve package checksums and APT metadata. If the installed package cannot be retained, arrange an equivalent tested side-by-side runtime rollback before stopping the service.

   ```bash
   # Run in the private evidence directory, in the privileged operator shell.
   apt-get download temurin-25-jdk=25.0.4.1.0+1-0
   apt-get download temurin-25-jdk=25.0.5.0.0+8-1
   sha256sum ./*.deb > java-package-sha256.txt
   ```

3. Extract the candidate package into a staging directory with `dpkg-deb --extract`. Run its `bin/java -version` and the repository's `scripts/security/CheckCerts.java` with that exact Java executable. Require Java 25.0.5 and a clean certificate check. Inspect APT's simulation and abort if it proposes unrelated removals, runtime-major changes or infrastructure changes.

   ```bash
   apt-get --simulate install --only-upgrade --no-install-recommends \
     temurin-25-jdk=25.0.5.0.0+8-1
   ```

4. Stop/drain the application before replacing files in the JVM installation used by the live process. Install only the selected package. Check the installed executable and effective default trust store again before restarting. Do not edit `/etc/pliego/pliego.env`, database privileges, Nginx, SSH or firewall configuration.

   ```bash
   systemctl stop pliego
   apt-get install --only-upgrade --no-install-recommends \
     temurin-25-jdk=25.0.5.0.0+8-1 </dev/null
   /usr/bin/java -version
   # Use the checked repository copy transferred to the private evidence directory.
   /usr/bin/java CheckCerts.java
   systemctl start pliego
   ```

5. Verify `ActiveState`, the new PID and start time. As the service account, use the matching JDK's `jcmd <pid> VM.version` to verify the **running JVM**, rather than relying only on package metadata. Check the effective trust-store configuration without printing credentials or unfiltered JVM arguments/environment. For the service-user certificate check, place only the public checker source in a root-owned readable temporary directory; an inherited `/dev/stdin` descriptor backed by a root-only file can fail permission checks.

   ```bash
   check_dir="$(mktemp -d /tmp/pliego-java-check.XXXXXX)"
   chmod 0755 "$check_dir"
   install -m 0644 CheckCerts.java "$check_dir/CheckCerts.java"
   runuser -u pliego -- /usr/bin/java "$check_dir/CheckCerts.java"
   rm -rf -- "$check_dir"
   ```
6. Run anonymous public API/catalog and frontend asset smoke checks, the existing service privacy checks and resource/restart checks from the runbook. Compare artifact pointers and Flyway history with the preflight snapshot. Do not create customers/orders or send mail as a smoke test.
7. If installation, certificate validation or startup fails, keep the service stopped until the failure is understood. Restore the retained original package with an explicit APT downgrade, verify its checksum and restart the unchanged artifact. Record that this rollback restores an older, vulnerable CPU level; do not label it remediation. Do not reverse Flyway or restore business data for a JVM-only rollback.

## Application release remains separate

The repository contains patched Maven/npm/Pillow dependencies, lockfiles, test-fixture fixes and private-draft cleanup. They are not active in production until an authorized release publishes the verified JAR/static assets following the existing pinned-CI procedure. Do not silently deploy this uncommitted checkout or mix it with the existing user changes.

Before a release, run the JVM certificate check, verify the build runtime versions and repeat the corresponding production runtime checks. CI runtime pinning does not update the VPS automatically. See the [security report](../security/2026-10-24/README.md) for scan results and remaining risks.
