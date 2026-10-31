import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REGISTER_PATH = path.join(SCRIPT_DIRECTORY, '../docs/security/npm-audit-exceptions.json');
export const AUDIT_ARGUMENTS = Object.freeze([
  'audit',
  '--json',
  '--audit-level=low',
  '--include=prod',
  '--include=dev',
  '--include=optional',
  '--include=peer',
]);
const SEVERITY_RANK = new Map([
  ['info', 0],
  ['low', 1],
  ['moderate', 2],
  ['high', 3],
  ['critical', 4],
]);
const VULNERABILITY_KEYS = [
  'name',
  'severity',
  'isDirect',
  'via',
  'effects',
  'range',
  'nodes',
  'fixAvailable',
];
const AUDIT_METADATA_SEVERITY_KEYS = ['info', 'low', 'moderate', 'high', 'critical', 'total'];
const DEPENDENCY_COUNT_KEYS = ['prod', 'dev', 'optional', 'peer', 'peerOptional', 'total'];

export function evaluateAudit({ auditText, auditExitCode, register, lockfile, now = new Date() }) {
  const exception = validateRegister(register, now);
  validateLockfile(lockfile, exception);
  const report = parseAuditReport(auditText, auditExitCode);
  validateFindingCounts(report);

  const findings = report.vulnerabilities;
  const effectNames = Object.keys(exception.effectPackages);
  const expectedNames = new Set([exception.package, ...effectNames]);
  for (const name of Object.keys(findings)) {
    if (!expectedNames.has(name)) {
      throw new Error(`Unexcepted vulnerable package in npm audit: ${name}.`);
    }
  }

  const expectedPresentNames = new Set([exception.package]);
  for (const name of effectNames) {
    if (findings[name]) {
      expectedPresentNames.add(name);
    }
  }
  if (!findings[exception.package]) {
    throw new Error(`Stale npm audit exception ${exception.advisory}: the vulnerable package finding no longer matches.`);
  }

  validateEffectEdges(findings);
  const visited = new Set();
  const visiting = new Set();
  for (const name of expectedPresentNames) {
    validateFindingChain(name, findings, exception, visited, visiting);
  }
  if (visited.size !== Object.keys(findings).length) {
    throw new Error('npm audit contains a finding outside the exception dependency chain.');
  }
  if (!visited.has(exception.package)) {
    throw new Error(`Stale npm audit exception ${exception.advisory}: its advisory did not match.`);
  }

  const today = now.toISOString().slice(0, 10);
  const daysRemaining = daysBetween(today, exception.expires);
  return {
    appliedExceptions: [{
      advisory: exception.advisory,
      paths: exception.lockfilePaths,
      expires: exception.expires,
      daysRemaining,
    }],
  };
}

export function formatAppliedException(applied) {
  const pathList = applied.paths.join(', ');
  const message = `${applied.advisory}; path ${pathList}; expires ${applied.expires}; ${applied.daysRemaining} days remaining`;
  return `::warning title=NPM audit exception::${escapeWorkflowCommand(message)}`;
}

function validateRegister(register, now) {
  requireObject(register, 'exceptions register');
  requireExactKeys(register, ['version', 'exceptions'], 'exceptions register');
  if (register.version !== 1 || !Array.isArray(register.exceptions) || register.exceptions.length !== 1) {
    throw new Error('Malformed exceptions register: expected version 1 and exactly one exception.');
  }

  const exception = register.exceptions[0];
  const exceptionKeys = [
    'advisory',
    'advisoryUrl',
    'package',
    'vulnerableRange',
    'installedVersion',
    'lockfilePaths',
    'maxSeverity',
    'effectPackages',
    'justification',
    'owner',
    'created',
    'expires',
    'removalCriteria',
  ];
  requireObject(exception, 'exception');
  requireExactKeys(exception, exceptionKeys, 'exception');

  if (!/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(exception.advisory)) {
    throw new Error('Malformed exception advisory id.');
  }
  if (exception.advisoryUrl !== `https://github.com/advisories/${exception.advisory}`) {
    throw new Error('Malformed exception advisory URL.');
  }
  requireNonEmptyString(exception.package, 'exception package');
  if (!/^<\d+\.\d+\.\d+$/.test(exception.vulnerableRange)) {
    throw new Error('Malformed exception vulnerable range.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(exception.installedVersion)) {
    throw new Error('Malformed exception installed version.');
  }
  const rangeMaximum = exception.vulnerableRange.slice(1).split('.').map(Number);
  const installedVersion = exception.installedVersion.split('.').map(Number);
  const firstDifferentPart = installedVersion.findIndex((part, index) => part !== rangeMaximum[index]);
  if (firstDifferentPart === -1 || installedVersion[firstDifferentPart] > rangeMaximum[firstDifferentPart]) {
    throw new Error('Malformed exception: the installed version is outside the vulnerable range.');
  }
  if (!Array.isArray(exception.lockfilePaths) || exception.lockfilePaths.length === 0 ||
      exception.lockfilePaths.some((entry) => typeof entry !== 'string' || !entry.startsWith('node_modules/')) ||
      new Set(exception.lockfilePaths).size !== exception.lockfilePaths.length) {
    throw new Error('Malformed exception lockfile paths.');
  }
  if (!SEVERITY_RANK.has(exception.maxSeverity)) {
    throw new Error('Malformed exception maximum severity.');
  }

  requireObject(exception.effectPackages, 'exception effect packages');
  if (Object.keys(exception.effectPackages).length === 0) {
    throw new Error('Malformed exception effect packages: expected at least one parent package.');
  }
  for (const [name, paths] of Object.entries(exception.effectPackages)) {
    requireNonEmptyString(name, 'exception effect package name');
    if (!Array.isArray(paths) || paths.length === 0 ||
        paths.some((entry) => typeof entry !== 'string' || !entry.startsWith('node_modules/')) ||
        new Set(paths).size !== paths.length) {
      throw new Error(`Malformed lockfile paths for effect package ${name}.`);
    }
  }
  for (const field of ['justification', 'owner', 'removalCriteria']) {
    requireNonEmptyString(exception[field], `exception ${field}`);
  }
  validateIsoDate(exception.created, 'exception creation date');
  validateIsoDate(exception.expires, 'exception expiry date');
  if (exception.expires > '2026-12-31') {
    throw new Error('Malformed exception expiry: it must be no later than 2026-12-31.');
  }
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new Error('Malformed evaluation date.');
  }
  const today = now.toISOString().slice(0, 10);
  if (exception.expires <= today) {
    throw new Error(`Expired npm audit exception ${exception.advisory} (expired ${exception.expires}).`);
  }
  if (exception.expires <= exception.created) {
    throw new Error('Malformed exception expiry: it must follow creation.');
  }
  return exception;
}

function validateLockfile(lockfile, exception) {
  requireObject(lockfile, 'package-lock.json');
  if (lockfile.lockfileVersion !== 3 || !isPlainObject(lockfile.packages)) {
    throw new Error('Unexpected package-lock.json shape or lockfile version.');
  }
  const registeredPackages = [
    [exception.package, exception.lockfilePaths, exception.installedVersion],
    ...Object.entries(exception.effectPackages).map(([name, paths]) => [name, paths, undefined]),
  ];
  for (const [name, paths, installedVersion] of registeredPackages) {
    for (const lockfilePath of paths) {
      const entry = lockfile.packages[lockfilePath];
      if (!isPlainObject(entry) || entry.dev !== true) {
        throw new Error(`Exception lockfile path is missing or is not dev-only: ${lockfilePath}.`);
      }
      if (name === exception.package && entry.version !== installedVersion) {
        throw new Error(`Lockfile version mismatch at ${lockfilePath}: expected ${installedVersion}, found ${entry.version}.`);
      }
    }
  }
}

function parseAuditReport(auditText, auditExitCode) {
  if (typeof auditText !== 'string' || auditText.trim() === '') {
    throw new Error('npm audit failed: it returned no JSON output.');
  }
  let report;
  try {
    report = JSON.parse(auditText);
  } catch {
    throw new Error('npm audit failed: output was not valid JSON.');
  }
  requireObject(report, 'npm audit report');
  if ('error' in report) {
    throw new Error(`npm audit failed: ${report.error?.code ?? 'registry or network error'}.`);
  }
  requireExactKeys(report, ['auditReportVersion', 'metadata', 'vulnerabilities'], 'npm audit report');
  if (report.auditReportVersion !== 2) {
    throw new Error('Unexpected npm audit JSON version; expected auditReportVersion 2.');
  }
  if (!Number.isInteger(auditExitCode) || ![0, 1].includes(auditExitCode)) {
    throw new Error(`npm audit failed with exit code ${auditExitCode}.`);
  }
  requireObject(report.metadata, 'npm audit metadata');
  requireExactKeys(report.metadata, ['vulnerabilities', 'dependencies'], 'npm audit metadata');
  requireObject(report.metadata.vulnerabilities, 'npm audit vulnerability counts');
  requireExactKeys(report.metadata.vulnerabilities, AUDIT_METADATA_SEVERITY_KEYS, 'npm audit vulnerability counts');
  for (const field of AUDIT_METADATA_SEVERITY_KEYS) {
    if (!Number.isSafeInteger(report.metadata.vulnerabilities[field]) || report.metadata.vulnerabilities[field] < 0) {
      throw new Error(`Unexpected npm audit JSON shape: invalid metadata.vulnerabilities.${field}.`);
    }
  }
  requireObject(report.metadata.dependencies, 'npm audit dependency counts');
  requireExactKeys(report.metadata.dependencies, DEPENDENCY_COUNT_KEYS, 'npm audit dependency counts');
  for (const field of DEPENDENCY_COUNT_KEYS) {
    if (!Number.isSafeInteger(report.metadata.dependencies[field]) || report.metadata.dependencies[field] < 0) {
      throw new Error(`Unexpected npm audit JSON shape: invalid metadata.dependencies.${field}.`);
    }
  }
  requireObject(report.vulnerabilities, 'npm audit vulnerabilities');
  if (auditExitCode === 0 && report.metadata.vulnerabilities.total !== 0) {
    throw new Error('npm audit returned findings but exited successfully despite --audit-level=low.');
  }
  if (auditExitCode === 1 && report.metadata.vulnerabilities.total === 0) {
    throw new Error('npm audit exited with an error but reported no vulnerabilities.');
  }
  for (const [key, finding] of Object.entries(report.vulnerabilities)) {
    validateFindingShape(key, finding);
  }
  return report;
}

function validateFindingCounts(report) {
  const counts = Object.fromEntries([...AUDIT_METADATA_SEVERITY_KEYS].map((severity) => [severity, 0]));
  for (const finding of Object.values(report.vulnerabilities)) {
    counts[finding.severity] += 1;
  }
  counts.total = Object.keys(report.vulnerabilities).length;
  for (const severity of AUDIT_METADATA_SEVERITY_KEYS) {
    if (report.metadata.vulnerabilities[severity] !== counts[severity]) {
      throw new Error(`Unexpected npm audit JSON shape: metadata count for ${severity} does not match findings.`);
    }
  }
}

function validateFindingShape(key, finding) {
  requireObject(finding, `npm audit finding ${key}`);
  requireExactKeys(finding, VULNERABILITY_KEYS, `npm audit finding ${key}`);
  if (finding.name !== key || !SEVERITY_RANK.has(finding.severity) || typeof finding.isDirect !== 'boolean' ||
      !Array.isArray(finding.via) || finding.via.length === 0 ||
      !Array.isArray(finding.effects) || finding.effects.some((name) => typeof name !== 'string') ||
      typeof finding.range !== 'string' || !Array.isArray(finding.nodes) || finding.nodes.length === 0 ||
      finding.nodes.some((node) => typeof node !== 'string') ||
      !(typeof finding.fixAvailable === 'boolean' || isPlainObject(finding.fixAvailable))) {
    throw new Error(`Unexpected npm audit JSON shape for finding ${key}.`);
  }
  for (const via of finding.via) {
    if (typeof via === 'string') {
      if (via.length === 0) {
        throw new Error(`Unexpected empty via package in npm audit finding ${key}.`);
      }
      continue;
    }
    requireObject(via, `npm audit advisory in ${key}`);
    if (typeof via.url !== 'string' || typeof via.name !== 'string' || typeof via.dependency !== 'string' ||
        typeof via.severity !== 'string' || typeof via.range !== 'string' || !SEVERITY_RANK.has(via.severity)) {
      throw new Error(`Unexpected npm audit advisory shape in ${key}.`);
    }
  }
}

function validateEffectEdges(findings) {
  for (const [name, finding] of Object.entries(findings)) {
    const expectedEffects = Object.entries(findings)
      .filter(([, dependent]) => dependent.via.some((via) => via === name))
      .map(([dependentName]) => dependentName)
      .sort();
    if ([...finding.effects].sort().join('\0') !== expectedEffects.join('\0')) {
      throw new Error(`Unexpected npm audit via/effects graph for ${name}.`);
    }
  }
}

function validateFindingChain(name, findings, exception, visited, visiting) {
  if (visited.has(name)) {
    return;
  }
  if (visiting.has(name)) {
    throw new Error(`Cycle in npm audit via chain at ${name}.`);
  }
  const finding = findings[name];
  if (!finding) {
    throw new Error(`npm audit via chain references missing package ${name}.`);
  }
  if (SEVERITY_RANK.get(finding.severity) > SEVERITY_RANK.get(exception.maxSeverity)) {
    throw new Error(`Finding severity for ${name} exceeds exception maximum ${exception.maxSeverity}.`);
  }
  visiting.add(name);

  if (name === exception.package) {
    const expectedNodes = [...exception.lockfilePaths].sort();
    if ([...finding.nodes].sort().join('\0') !== expectedNodes.join('\0')) {
      throw new Error(`Advisory ${exception.advisory} appeared on a different or additional node path: ${finding.nodes.join(', ')}.`);
    }
    if (finding.via.length !== 1 || typeof finding.via[0] === 'string') {
      throw new Error(`Unexpected direct advisory chain for ${exception.package}.`);
    }
    const advisory = finding.via[0];
    const advisoryId = advisory.url.split('/').at(-1);
    if (advisoryId !== exception.advisory || advisory.url !== exception.advisoryUrl ||
        advisory.name !== exception.package || advisory.dependency !== exception.package ||
        advisory.range !== exception.vulnerableRange || advisory.severity !== finding.severity ||
        SEVERITY_RANK.get(advisory.severity) > SEVERITY_RANK.get(exception.maxSeverity)) {
      throw new Error(`Advisory on ${exception.package} did not match the registered id, range, and severity.`);
    }
  } else {
    const expectedNodes = exception.effectPackages[name];
    if (!expectedNodes) {
      throw new Error(`Via chain reached unexcepted package ${name}.`);
    }
    if ([...finding.nodes].sort().join('\0') !== [...expectedNodes].sort().join('\0')) {
      throw new Error(`Via effect ${name} appeared on a different or additional node path.`);
    }
    if (finding.via.some((via) => typeof via !== 'string')) {
      throw new Error(`The excepted advisory appeared directly on effect package ${name}.`);
    }
    for (const dependency of finding.via) {
      validateFindingChain(dependency, findings, exception, visited, visiting);
    }
    if (finding.via.length === 0) {
      throw new Error(`Via effect ${name} does not reduce to the excepted advisory.`);
    }
  }

  visiting.delete(name);
  visited.add(name);
}

function requireObject(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`Malformed ${label}: expected an object.`);
  }
}

function requireExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.join('\0') !== expected.join('\0')) {
    throw new Error(`Unexpected ${label} shape: expected keys ${expected.join(', ')}; found ${actual.join(', ')}.`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Malformed ${label}: expected a non-empty string.`);
  }
}

function validateIsoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ||
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`Malformed ${label}; expected a valid YYYY-MM-DD date.`);
  }
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

function escapeWorkflowCommand(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A').replaceAll(':', '%3A').replaceAll(',', '%2C');
}

function parseCwdArgument(args) {
  if (args.length === 0) {
    return process.cwd();
  }
  if (args.length !== 2 || args[0] !== '--cwd' || args[1].trim() === '') {
    throw new Error('Usage: node npm-audit-gate.mjs [--cwd <directory>].');
  }
  return path.resolve(args[1]);
}

function run() {
  const cwd = parseCwdArgument(process.argv.slice(2));
  const register = JSON.parse(readFileSync(REGISTER_PATH, 'utf8'));
  const lockfile = JSON.parse(readFileSync(path.join(cwd, 'package-lock.json'), 'utf8'));
  const audit = spawnSync('npm', AUDIT_ARGUMENTS, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (audit.error) {
    throw new Error(`Could not run npm audit: ${audit.error.message}`);
  }
  const result = evaluateAudit({
    auditText: audit.stdout,
    auditExitCode: audit.status,
    register,
    lockfile,
  });
  for (const applied of result.appliedExceptions) {
    console.log(formatAppliedException(applied));
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## npm audit exceptions',
      ...result.appliedExceptions.map((applied) =>
        `- **${applied.advisory}** — \`${applied.paths.join(', ')}\`; expires ${applied.expires} (${applied.daysRemaining} days remaining).`),
      '',
    ];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
  }
  console.log('npm audit gate passed.');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(`npm audit gate failed: ${error.message}`);
    process.exitCode = 1;
  }
}
