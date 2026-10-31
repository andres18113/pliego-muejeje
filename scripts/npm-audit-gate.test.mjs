import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AUDIT_ARGUMENTS, evaluateAudit, formatAppliedException } from './npm-audit-gate.mjs';

const fixtures = new URL('./npm-audit-gate.fixtures/', import.meta.url);
const allowedReport = JSON.parse(readFileSync(new URL('allowed-report.json', fixtures), 'utf8'));
const cleanReport = JSON.parse(readFileSync(new URL('clean-report.json', fixtures), 'utf8'));
const networkError = JSON.parse(readFileSync(new URL('network-error.json', fixtures), 'utf8'));
const exception = {
  advisory: 'GHSA-g3hv-75wg-m249',
  advisoryUrl: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
  package: 'minimatch',
  vulnerableRange: '<11.0.1',
  installedVersion: '5.1.9',
  lockfilePaths: ['node_modules/minimatch'],
  maxSeverity: 'moderate',
  effectPackages: {
    '@redocly/openapi-core': ['node_modules/@redocly/openapi-core'],
    'openapi-typescript': ['node_modules/openapi-typescript'],
  },
  justification: 'Fixture justification.',
  owner: 'PLIEGO maintainers',
  created: '2026-10-31',
  expires: '2026-11-30',
  removalCriteria: 'Remove when the upstream package chain is fixed or this exception expires.',
};
const register = { version: 1, exceptions: [exception] };
const lockfile = {
  lockfileVersion: 3,
  packages: {
    'node_modules/minimatch': { version: '5.1.9', dev: true },
    'node_modules/@redocly/openapi-core': { version: '1.34.20', dev: true },
    'node_modules/openapi-typescript': { version: '7.13.0', dev: true },
  },
};
const now = new Date('2026-10-31T12:00:00.000Z');

function evaluate(report = allowedReport, options = {}) {
  return evaluateAudit({
    auditText: JSON.stringify(report),
    auditExitCode: options.auditExitCode ?? 1,
    register: options.register ?? register,
    lockfile: options.lockfile ?? lockfile,
    now: options.now ?? now,
  });
}

function clone(value) {
  return structuredClone(value);
}

function addFinding(report, packageName, advisoryUrl, nodes = [`node_modules/${packageName}`]) {
  const advisory = {
    source: 9999999,
    name: packageName,
    dependency: packageName,
    title: 'Unrelated test advisory',
    url: advisoryUrl,
    severity: 'moderate',
    cwe: ['CWE-999'],
    cvss: { score: 5, vectorString: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N' },
    range: '<2.0.0',
  };
  report.vulnerabilities[packageName] = {
    name: packageName,
    severity: 'moderate',
    isDirect: false,
    via: [advisory],
    effects: [],
    range: '',
    nodes,
    fixAvailable: false,
  };
  report.metadata.vulnerabilities.moderate += 1;
  report.metadata.vulnerabilities.total += 1;
}

test('accepts the exact minimatch advisory and its two via effects', () => {
  const result = evaluate();
  assert.equal(result.appliedExceptions.length, 1);
  assert.equal(result.appliedExceptions[0].advisory, exception.advisory);
  assert.equal(result.appliedExceptions[0].daysRemaining, 30);
});

test('runs npm audit at low severity with development dependencies explicitly included', () => {
  assert.deepEqual(AUDIT_ARGUMENTS, [
    'audit',
    '--json',
    '--audit-level=low',
    '--include=prod',
    '--include=dev',
    '--include=optional',
    '--include=peer',
  ]);
});

test('rejects a different advisory at every severity', () => {
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    const report = clone(allowedReport);
    addFinding(report, 'unrelated-package', 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz');
    report.vulnerabilities['unrelated-package'].severity = severity;
    report.vulnerabilities['unrelated-package'].via[0].severity = severity;
    report.metadata.vulnerabilities.moderate -= 1;
    report.metadata.vulnerabilities[severity] += 1;
    const auditExitCode = severity === 'info' ? 0 : 1;
    assert.throws(() => evaluate(report, { auditExitCode }), /npm audit|unexcepted advisory|finding|package/i, severity);
  }
});

test('rejects the excepted advisory when attached to a different package', () => {
  const report = clone(allowedReport);
  addFinding(report, 'different-package', exception.advisoryUrl);
  assert.throws(() => evaluate(report), /unexcepted|package|advisory/i);
});

test('rejects the excepted package when an additional lockfile node path appears', () => {
  const report = clone(allowedReport);
  report.vulnerabilities.minimatch.nodes.push('node_modules/other/node_modules/minimatch');
  assert.throws(() => evaluate(report), /path|node/i);
});

test('rejects severity above the exception maximum', () => {
  const report = clone(allowedReport);
  report.vulnerabilities.minimatch.severity = 'high';
  report.vulnerabilities.minimatch.via[0].severity = 'high';
  report.metadata.vulnerabilities.moderate = 2;
  report.metadata.vulnerabilities.high = 1;
  assert.throws(() => evaluate(report), /severity/i);
});

test('rejects an expired exception', () => {
  assert.throws(() => evaluate(allowedReport, { now: new Date('2026-11-30T00:00:00.000Z') }), /expired/i);
});

test('rejects a stale exception when no matching finding remains', () => {
  assert.throws(() => evaluate(cleanReport, { auditExitCode: 0 }), /stale|no longer matches|unused/i);
});

test('rejects a malformed exceptions register', () => {
  assert.throws(() => evaluate(allowedReport, { register: { version: 1, exceptions: [{ advisory: exception.advisory }] } }), /register|exception|malformed/i);
});

test('rejects npm audit network errors even when they are JSON', () => {
  assert.throws(() => evaluate(networkError, { auditExitCode: 1 }), /npm audit|error|network|shape/i);
});

test('rejects non-finding npm audit failures', () => {
  assert.throws(() => evaluate(allowedReport, { auditExitCode: 2 }), /npm audit|exit|failed/i);
});

test('rejects an npm audit process that did not return an exit code', () => {
  assert.throws(() => evaluateAudit({
    auditText: JSON.stringify(allowedReport),
    auditExitCode: null,
    register,
    lockfile,
    now,
  }), /npm audit|exit/i);
});

test('rejects unexpected audit JSON versions and shapes', () => {
  const report = clone(allowedReport);
  report.auditReportVersion = 3;
  assert.throws(() => evaluate(report), /shape|version|audit/i);
  assert.throws(() => evaluate('{"auditReportVersion":2}'), /shape|metadata|audit/i);
});

test('rejects via chains that include findings outside the exception', () => {
  const report = clone(allowedReport);
  report.vulnerabilities['@redocly/openapi-core'].via.push('unknown-vulnerable-package');
  assert.throws(() => evaluate(report), /via|chain|package|finding/i);
});

test('rejects lockfile version drift from the registered installed version', () => {
  const changedLockfile = clone(lockfile);
  changedLockfile.packages['node_modules/minimatch'].version = '11.0.1';
  assert.throws(() => evaluate(allowedReport, { lockfile: changedLockfile }), /lockfile|version|range/i);
});

test('rejects a registered installed version outside the advisory range', () => {
  const changedException = { ...exception, installedVersion: '11.0.1' };
  const changedRegister = { version: 1, exceptions: [changedException] };
  const changedLockfile = clone(lockfile);
  changedLockfile.packages['node_modules/minimatch'].version = '11.0.1';
  assert.throws(() => evaluate(allowedReport, { register: changedRegister, lockfile: changedLockfile }), /range|version/i);
});

test('renders the advisory, path, expiry, and remaining days in a GitHub warning', () => {
  const applied = evaluate().appliedExceptions[0];
  const warning = formatAppliedException(applied);
  assert.match(warning, /::warning/);
  assert.match(warning, /GHSA-g3hv-75wg-m249/);
  assert.match(warning, /node_modules\/minimatch/);
  assert.match(warning, /2026-11-30/);
  assert.match(warning, /30 days remaining/);
});
