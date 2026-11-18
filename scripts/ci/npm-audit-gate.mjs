import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const emptyPolicy = { schemaVersion: 1, exceptions: [] };
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const packageName = /^(?:@[a-z\d][a-z\d._-]*\/)?[a-z\d][a-z\d._-]*$/;
const advisoryId = /^GHSA-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}$/;
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-z\d-]+(?:\.[a-z\d-]+)*)?(?:\+[a-z\d-]+(?:\.[a-z\d-]+)*)?$/i;
const dayMs = 86_400_000;
const affectedFields = ['isDirect', 'range', 'nodes', 'via', 'effects'];
const includeAll = ['--include=prod', '--include=dev', '--include=optional', '--include=peer'];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isSeverity = (value) => severities.includes(value);
const isPackage = (value) => typeof value === 'string' && packageName.test(value);
const isId = (value) => typeof value === 'string' && advisoryId.test(value);
const isVersion = (value) => typeof value === 'string' && versionPattern.test(value);

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function sameSet(actual, expected) {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

function hasFields(value, fields) {
  return isRecord(value) && Object.keys(value).length === fields.length &&
    fields.every((key) => Object.hasOwn(value, key));
}

function uniqueStrings(values, validate = isText) {
  return Array.isArray(values) && values.every(validate) && new Set(values).size === values.length;
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
}

function isPackageNode(path, name) {
  if (!isText(path) || !path.startsWith('node_modules/')) return false;
  const segments = path.slice('node_modules/'.length).split('/node_modules/');
  return segments.at(-1) === name && segments.every(isPackage);
}

function validAffected(row, name, validateVia) {
  return isPackage(name) && typeof row.isDirect === 'boolean' && typeof row.range === 'string' &&
    uniqueStrings(row.nodes, (path) => isPackageNode(path, name)) && row.nodes.length > 0 &&
    uniqueStrings(row.effects, isPackage) &&
    Array.isArray(row.via) && row.via.length > 0 && row.via.every(validateVia);
}

function validatePolicy(policy, project, today) {
  requireThat(hasFields(policy, ['schemaVersion', 'exceptions']) && policy.schemaVersion === 1 &&
    Array.isArray(policy.exceptions), 'Unknown or malformed audit policy schema.');

  const urls = new Set();
  for (const entry of policy.exceptions) {
    requireThat(hasFields(entry, [
      'id', 'npmSource', 'url', 'package', 'severity', 'range', 'installedVersions',
      'project', 'expires', 'approved', 'justification', 'affected',
    ]) && isId(entry.id) && isCount(entry.npmSource) &&
      entry.url === `https://github.com/advisories/${entry.id}` &&
      isPackage(entry.package) && isSeverity(entry.severity) && isText(entry.range) &&
      uniqueStrings(entry.installedVersions, isVersion) && entry.installedVersions.length > 0 &&
      isText(entry.project) && isText(entry.justification) && isRecord(entry.affected) &&
      parseDate(entry.approved) <= parseDate(entry.expires) && !urls.has(entry.url),
    'Malformed or duplicate audit policy exception.');
    urls.add(entry.url);

    requireThat(entry.project === project,
      `${entry.id} belongs to project ${entry.project}, but the audited project is ${project}.`);
    requireThat(today < parseDate(entry.expires), `${entry.id} expired on ${entry.expires} (UTC).`);
    requireThat(Object.hasOwn(entry.affected, entry.package) &&
      Object.entries(entry.affected).every(([name, row]) => hasFields(row, affectedFields) &&
        validAffected(row, name, (via) => via === entry.id || isPackage(via)) &&
        uniqueStrings(row.via)) && entry.affected[entry.package].via.includes(entry.id),
    `${entry.id} has a malformed affected dependency graph.`);
  }
}

function isAdvisory(advisory) {
  return hasFields(advisory, ['source', 'name', 'dependency', 'title', 'url', 'severity', 'cwe', 'cvss', 'range']) &&
    isCount(advisory.source) && isPackage(advisory.name) && isPackage(advisory.dependency) &&
    isText(advisory.title) && isText(advisory.url) && isSeverity(advisory.severity) &&
    uniqueStrings(advisory.cwe) && isText(advisory.range) &&
    hasFields(advisory.cvss, ['score', 'vectorString']) && Number.isFinite(advisory.cvss.score) &&
    (advisory.cvss.vectorString === null || isText(advisory.cvss.vectorString));
}

function validFix(fix) {
  return typeof fix === 'boolean' ||
    (hasFields(fix, ['name', 'version', 'isSemVerMajor']) && isPackage(fix.name) &&
      isVersion(fix.version) && typeof fix.isSemVerMajor === 'boolean');
}

function parseAudit(result) {
  requireThat(!result.error && !result.signal && [0, 1].includes(result.status),
  `npm audit failed (exit ${result.status ?? 'unknown'}${result.error ? `, ${result.error.message}` : ''}).`);
  const report = parseJson(result.stdout, 'npm audit');
  if (isRecord(report) && Object.hasOwn(report, 'error')) {
    const code = report.error?.code;
    throw new Error(`npm audit returned an error object${isText(code) ? ` (${code})` : ''}.`);
  }
  requireThat(!/^npm (?:ERR!|error)\b/im.test(result.stderr ?? ''), 'npm audit reported an error.');
  requireThat(hasFields(report, ['auditReportVersion', 'vulnerabilities', 'metadata']) &&
    report.auditReportVersion === 2 && isRecord(report.vulnerabilities) &&
    hasFields(report.metadata, ['vulnerabilities', 'dependencies']),
  'Malformed or unexpected npm audit JSON (expected audit report v2).');

  const counts = Object.fromEntries(severities.map((severity) => [severity, 0]));
  const rows = Object.entries(report.vulnerabilities);
  for (const [name, row] of rows) {
    const fields = ['name', 'severity', 'fixAvailable', ...affectedFields];
    if (row?.fixBlockedByReleaseAge !== undefined) fields.push('fixBlockedByReleaseAge');
    requireThat(hasFields(row, fields) &&
      row.name === name && isSeverity(row.severity) && validFix(row.fixAvailable) &&
      (row.fixBlockedByReleaseAge === undefined ||
        (hasFields(row.fixBlockedByReleaseAge, ['version', 'before']) &&
          isVersion(row.fixBlockedByReleaseAge.version) && isText(row.fixBlockedByReleaseAge.before))) &&
      validAffected(row, name, (via) => isPackage(via) ||
        (isAdvisory(via) && via.name === name && via.dependency === name)),
    `Malformed npm audit vulnerability row for ${name}.`);
    counts[row.severity]++;
  }

  const summary = report.metadata.vulnerabilities;
  const dependencyCounts = report.metadata.dependencies;
  requireThat(hasFields(summary, [...severities, 'total']) && summary.total === rows.length &&
    severities.every((severity) => summary[severity] === counts[severity]) &&
    hasFields(dependencyCounts, ['prod', 'dev', 'optional', 'peer', 'peerOptional', 'total']) &&
    Object.values(dependencyCounts).every(isCount),
  'Malformed or inconsistent npm audit metadata.');
  const expectedStatus = rows.length === 0 ? 0 : 1;
  requireThat(result.status === expectedStatus,
    `npm audit failed or returned an inconsistent exit status (exit ${result.status}, ${rows.length} affected packages).`);
  return report.vulnerabilities;
}

function matchException(entry, advisory, vulnerabilities, covered) {
  requireThat(advisory.source === entry.npmSource,
    `${entry.id} npm advisory source changed to ${advisory.source}.`);
  requireThat(advisory.severity === entry.severity,
    `${entry.id} advisory severity changed to ${advisory.severity}.`);
  requireThat(advisory.range === entry.range, `${entry.id} vulnerable range changed to ${advisory.range}.`);

  for (const [name, expected] of Object.entries(entry.affected)) {
    requireThat(!covered.has(name), `${name} is covered by multiple audit exceptions.`);
    const actual = vulnerabilities[name];
    requireThat(actual, `${entry.id} affected dependency set changed. Missing package ${name}.`);
    const via = actual.via.map((cause) => typeof cause === 'string' ? cause : entry.id);
    requireThat(actual.severity === entry.severity,
      `${entry.id} affected severity changed for ${name} to ${actual.severity}.`);
    requireThat(actual.isDirect === expected.isDirect && actual.range === expected.range &&
      sameSet(actual.nodes, expected.nodes) && sameSet(actual.effects, expected.effects) &&
      sameSet(via, expected.via) && new Set(via).size === via.length,
    `${entry.id} dependency path or affected package set changed for ${name}.`);
    covered.add(name);
  }
}

function checkInstalled(entry, readProjectJson, getInstalledPaths) {
  const lock = readProjectJson('package-lock.json');
  requireThat(lock?.lockfileVersion === 3 && isRecord(lock.packages),
    'Expected npm package-lock.json with lockfileVersion 3 and a packages map.');
  const packageRow = entry.affected[entry.package];
  const lockedPaths = Object.keys(lock.packages).filter((path) => isPackageNode(path, entry.package));
  requireThat(sameSet(lockedPaths, packageRow.nodes), `${entry.id} locked dependency paths changed.`);
  const installedPaths = getInstalledPaths(entry.package);
  requireThat(uniqueStrings(installedPaths) && sameSet(installedPaths, lockedPaths),
    `${entry.id} installed dependency paths changed for ${entry.package}.`);

  const versions = new Set();
  for (const path of lockedPaths) {
    const installed = readProjectJson(`${path}/package.json`);
    requireThat(installed?.name === entry.package && installed.version === lock.packages[path]?.version &&
      entry.installedVersions.includes(installed.version),
    `${entry.id} installed or locked version changed at ${path} (installed ${installed?.version ?? 'missing'}).`);
    versions.add(installed.version);
  }
  requireThat(sameSet([...versions], entry.installedVersions),
    `${entry.id} installed version set changed.`);

  const expectedDependents = packageRow.effects.flatMap((name) => entry.affected[name]?.nodes ?? []);
  const declaredDependents = [];
  const ranges = new Set();
  for (const [path, pkg] of Object.entries(lock.packages)) {
    const declared = ['dependencies', 'optionalDependencies', 'peerDependencies']
      .map((field) => pkg?.[field]?.[entry.package]).filter((range) => range !== undefined);
    if (declared.length === 0) continue;

    requireThat(declared.every(isText), `${entry.id} invalid dependency range at ${path}.`);
    declaredDependents.push(path);
    declared.forEach((range) => ranges.add(range));
  }
  requireThat(ranges.size > 0 && sameSet(declaredDependents, expectedDependents),
    `${entry.id} locked dependent paths changed.`);
  return ranges;
}

function requireExceptionRemoval(entry) {
  throw new Error(`${entry.id} has a patch available. Update ${entry.package} and delete the exception.`);
}

function checkAuditFix(entry, vulnerabilities) {
  for (const name of Object.keys(entry.affected)) {
    const fix = vulnerabilities[name]?.fixAvailable;
    if (fix === true || (fix && !fix.isSemVerMajor)) requireExceptionRemoval(entry);
  }
}

async function checkForPatch(entry, ranges, getAdvisory, getVersions) {
  const upstream = await getAdvisory(entry.id);
  const records = upstream?.vulnerabilities;
  requireThat(upstream?.ghsa_id === entry.id && Array.isArray(records),
    `${entry.id} returned unexpected GitHub advisory metadata.`);
  const entries = records.filter((record) => record?.package?.ecosystem === 'npm' &&
    record.package.name === entry.package);
  const patchedVersions = entries.map((record) => record.first_patched_version);
  requireThat(patchedVersions.length > 0 && patchedVersions.every((version) =>
    version === null || isVersion(version) || isVersion(version?.identifier)),
  `${entry.id} is missing GitHub patch metadata for ${entry.package}.`);
  if (patchedVersions.some((version) => version !== null)) requireExceptionRemoval(entry);

  requireThat(entries.length === 1 &&
    entries[0].vulnerable_version_range?.replace(/\s+/g, '') === entry.range.replace(/\s+/g, '') &&
    (upstream.severity === undefined || upstream.severity === entry.severity),
  `${entry.id} severity or vulnerable range changed in GitHub advisory metadata.`);

  // npm resolves each range so the gate uses the registry's npm SemVer semantics.
  const published = await getVersions(entry.package);
  requireThat(uniqueStrings(published, isVersion) && published.length > 0 &&
    entry.installedVersions.every((version) => published.includes(version)),
  `npm view returned invalid published versions for ${entry.package}.`);
  async function versionsIn(range) {
    const matches = await getVersions(entry.package, range);
    requireThat(uniqueStrings(matches, isVersion) && matches.length > 0 &&
      matches.every((version) => published.includes(version)),
    `npm view returned invalid versions for ${entry.package}@${range}.`);
    return matches;
  }

  const vulnerable = await versionsIn(entry.range);
  requireThat(entry.installedVersions.every((version) => vulnerable.includes(version)),
    `npm view disagrees with the audited vulnerable range for ${entry.package}.`);
  let candidates = published.filter((version) => !vulnerable.includes(version));
  for (const range of ranges) {
    if (candidates.length === 0) break;
    const compatible = await versionsIn(range);
    candidates = candidates.filter((version) => compatible.includes(version));
  }
  if (candidates.length > 0) requireExceptionRemoval(entry);
}

export async function checkAudit({
  auditResult, policy, project, now = new Date(), readProjectJson, getInstalledPaths, getAdvisory, getVersions,
}) {
  const today = parseDate(now.toISOString().slice(0, 10));
  validatePolicy(policy, project, today);
  const vulnerabilities = parseAudit(auditResult);

  for (const row of Object.values(vulnerabilities)) {
    for (const via of row.via) {
      if (typeof via === 'object') {
        requireThat(policy.exceptions.some((entry) => entry.url === via.url && entry.package === row.name),
          `Uncovered advisory for ${row.name} (${via.severity}): ${via.url}.`);
      }
    }
  }
  const covered = new Set();
  const summaries = [];
  for (const entry of policy.exceptions) {
    const advisory = vulnerabilities[entry.package]?.via.find((via) =>
      typeof via === 'object' && via.url === entry.url);
    requireThat(advisory, `${entry.id} exception is stale. Delete it from the policy.`);
    checkAuditFix(entry, vulnerabilities);
    const ranges = checkInstalled(entry, readProjectJson, getInstalledPaths);
    await checkForPatch(entry, ranges, getAdvisory, getVersions);
    matchException(entry, advisory, vulnerabilities, covered);
    const days = (parseDate(entry.expires) - today) / dayMs;
    const paths = Object.values(entry.affected).flatMap((row) => row.nodes).join(', ');
    summaries.push(`Exempted ${entry.id} (${entry.package}@${entry.installedVersions.join(', ')}, ${entry.severity})` +
      ` in ${project}. Expires ${entry.expires} UTC (${days} day(s) left). Affected paths: ${paths}.`);
  }
  const uncovered = Object.keys(vulnerabilities).filter((name) => !covered.has(name));
  requireThat(uncovered.length === 0, `Uncovered affected packages: ${uncovered.join(', ')}.`);
  return summaries;
}

function runNpm(cwd, args) {
  // npm can fall back to stale packuments after a failed revalidation.
  const cache = mkdtempSync(join(tmpdir(), 'pliego-npm-audit-'));
  try {
    return spawnSync('npm', [...args, '--cache', cache, '--offline=false', '--prefer-offline=false'], {
      cwd, encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024,
    });
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

async function fetchAdvisory(id) {
  try {
    // Shared CI runners exhaust GitHub's anonymous rate limit; the job's read-only token goes to this host only.
    const token = process.env.GITHUB_TOKEN;
    const response = await fetch(`https://api.github.com/advisories/${id}`, {
      headers: { accept: 'application/vnd.github+json', ...(isText(token) ? { authorization: `Bearer ${token}` } : {}) },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    requireThat(response.ok, `HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    throw new Error(`GitHub advisory lookup failed for ${id}: ${error.message}.`);
  }
}

async function main() {
  const { values } = parseArgs({ options: { project: { type: 'string' }, policy: { type: 'string' } } });
  requireThat(isText(values.project), 'Usage: npm-audit-gate.mjs --project DIR [--policy FILE]');
  requireThat(values.policy === undefined || isText(values.policy), 'Expected a non-empty --policy filename.');
  const cwd = realpathSync(resolve(values.project));
  const root = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));
  const project = relative(root, cwd).split('\\').join('/') || '.';
  const policy = values.policy === undefined ? emptyPolicy :
    parseJson(readFileSync(values.policy, 'utf8'), 'Audit policy');

  const auditResult = runNpm(cwd, [
    'audit', '--json', '--audit-level=info', '--package-lock=true', ...includeAll,
  ]);
  const summaries = await checkAudit({
    auditResult, policy, project,
    readProjectJson(path) {
      return parseJson(readFileSync(resolve(cwd, path), 'utf8'), path);
    },
    getInstalledPaths(name) {
      const result = runNpm(cwd, ['ls', name, '--all', '--parseable', ...includeAll]);
      requireThat(!result.error && !result.signal && result.status === 0,
        `npm ls failed for ${name} (exit ${result.status ?? 'unknown'}).`);
      return result.stdout.trim().split(/\r?\n/).filter(Boolean)
        .map((path) => relative(cwd, path).split('\\').join('/'));
    },
    getAdvisory: fetchAdvisory,
    getVersions(name, range) {
      const spec = range === undefined ? name : `${name}@${range}`;
      const result = runNpm(cwd, [
        'view', '--json', '--prefer-online', spec,
        range === undefined ? 'versions' : 'version',
      ]);
      requireThat(!result.error && !result.signal && result.status === 0,
        `npm view failed for ${spec} (exit ${result.status ?? 'unknown'}).`);
      const versions = parseJson(result.stdout, `npm view for ${spec}`);
      return range !== undefined && typeof versions === 'string' ? [versions] : versions;
    },
  });
  console.log(summaries.length > 0 ? summaries.join('\n') : `npm audit passed for ${project} with no vulnerabilities.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.error(`::error::${message}`);
    process.exitCode = 1;
  });
}
