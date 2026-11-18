import assert from 'node:assert/strict';
import test from 'node:test';

import { checkAudit } from './npm-audit-gate.mjs';

const id = 'GHSA-fc5q-39xc-vjpf';
const url = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const removal = /update picomatch and delete the exception/i;

const advisory = {
  source: 1247710,
  name: 'picomatch',
  dependency: 'picomatch',
  title: 'picomatch vulnerable to ReDoS through single-branch repeated extglobs',
  url,
  severity: 'high',
  cwe: ['CWE-1333'],
  cvss: { score: 7.5, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H' },
  range: '<=4.0.7',
};

// Captured npm 11 audit topology with fresh registry metadata.
const currentGraph = {
  '@vitejs/plugin-react': [true, '>=6.0.0-beta.0', ['vite'], []],
  fdir: [false, '>=5.2.1', ['picomatch'], ['tinyglobby']],
  picomatch: [false, '*', [id], ['fdir', 'tinyglobby', 'vite', 'vitest']],
  tinyglobby: [false, '*', ['fdir', 'picomatch'], ['vite', 'vitest']],
  vite: [true, '>=6.3.0-beta.0', ['picomatch', 'tinyglobby'], ['@vitejs/plugin-react', 'vitest']],
  vitest: [true, '>=3.1.2', ['picomatch', 'tinyglobby', 'vite'], []],
};

function affectedRows() {
  return Object.fromEntries(Object.entries(currentGraph).map(([name, [isDirect, range, via, effects]]) => [name, {
    isDirect,
    range,
    via: [...via],
    effects: [...effects],
    nodes: [`node_modules/${name}`],
  }]));
}

function policyFixture() {
  return {
    schemaVersion: 1,
    exceptions: [{
      id,
      url,
      npmSource: 1247710,
      package: 'picomatch',
      severity: 'high',
      range: '<=4.0.7',
      installedVersions: ['4.0.7'],
      project: 'frontend',
      expires: '2026-12-01',
      approved: '2026-11-17',
      justification: 'The audited glob patterns come from checked-in tooling and configuration. Production serves static assets.',
      affected: affectedRows(),
    }],
  };
}

function auditFixture({ clean = false } = {}) {
  const majorFixes = {
    '@vitejs/plugin-react': { name: '@vitejs/plugin-react', version: '5.2.0' },
    vite: { name: 'vite', version: '6.2.7' },
    vitest: { name: 'vitest', version: '3.1.4' },
  };
  const vulnerabilities = clean ? {} : Object.fromEntries(Object.entries(affectedRows()).map(([name, row]) => [name, {
    name,
    severity: 'high',
    ...row,
    via: name === 'picomatch' ? [structuredClone(advisory)] : row.via,
    fixAvailable: { ...(majorFixes[name] ?? majorFixes.vite), isSemVerMajor: true },
  }]));
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: clean ? 0 : 6, critical: 0, total: clean ? 0 : 6 },
      dependencies: clean
        ? { prod: 2, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 }
        : { prod: 93, dev: 108, optional: 56, peer: 8, peerOptional: 0, total: 256 },
    },
  };
}

function projectFiles() {
  return {
    'package-lock.json': {
      name: 'pliego-frontend',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'pliego-frontend', version: '1.0.0',
          dependencies: { '@tailwindcss/vite': '^4.3.3' },
          devDependencies: {
            '@testing-library/jest-dom': '^7.0.1', '@vitejs/plugin-react': '^6.1.1', vite: '^8.3.3', vitest: '^5.0.3',
          },
        },
        'node_modules/@tailwindcss/vite': { version: '4.3.3', peerDependencies: { vite: '^5.2.0 || ^6 || ^7 || ^8' } },
        'node_modules/@testing-library/jest-dom': { version: '7.0.1', peerDependencies: { vitest: '>= 0.32' } },
        'node_modules/@vitejs/plugin-react': { version: '6.1.1', peerDependencies: { vite: '^8.0.0' } },
        'node_modules/@vitest/mocker': { version: '5.0.5', peerDependencies: { vite: '^6.0.0 || ^7.0.0 || ^8.0.0' } },
        'node_modules/fdir': { version: '6.5.0', peerDependencies: { picomatch: '^3 || ^4' } },
        'node_modules/picomatch': { version: '4.0.7' },
        'node_modules/tinyglobby': { version: '0.2.17', dependencies: { fdir: '^6.5.0', picomatch: '^4.0.4' } },
        'node_modules/vite': { version: '8.3.5', dependencies: { picomatch: '^4.0.7', tinyglobby: '^0.2.17' } },
        'node_modules/vitest': {
          version: '5.0.5',
          dependencies: { '@vitest/mocker': '5.0.5', picomatch: '^4.0.7', tinyglobby: '^0.2.17' },
          peerDependencies: { vite: '^6.4.0 || ^7.0.0 || ^8.0.0' },
        },
      },
    },
    'node_modules/picomatch/package.json': { name: 'picomatch', version: '4.0.7' },
  };
}

function githubAdvisory(firstPatched = null) {
  return {
    ghsa_id: id,
    html_url: url,
    severity: 'high',
    vulnerabilities: [{
      package: { ecosystem: 'npm', name: 'picomatch' },
      vulnerable_version_range: '<= 4.0.7',
      first_patched_version: firstPatched,
    }],
  };
}

function registryVersions({ versions = ['3.0.2', '4.0.6', '4.0.7'], compatible = [] } = {}) {
  const byRange = new Map([
    [undefined, versions],
    ['<=4.0.7', ['3.0.2', '4.0.6', '4.0.7'].filter((version) => versions.includes(version))],
    ['^3 || ^4', ['3.0.2', '4.0.6', '4.0.7', ...compatible].filter((version) => versions.includes(version))],
    ['^4.0.4', ['4.0.6', '4.0.7', ...compatible].filter((version) => versions.includes(version))],
    ['^4.0.7', ['4.0.7', ...compatible].filter((version) => versions.includes(version))],
  ]);
  return async (name, range) => {
    assert.equal(name, 'picomatch');
    assert.ok(byRange.has(range), `unrecorded npm view range ${range}`);
    return byRange.get(range);
  };
}

function check({ audit = auditFixture(), files = projectFiles(), ...overrides } = {}) {
  const status = audit.metadata.vulnerabilities.total === 0 ? 0 : 1;
  return checkAudit({
    auditResult: { status, stdout: JSON.stringify(audit) },
    policy: policyFixture(),
    project: 'frontend',
    now: new Date('2026-11-17T00:00:00Z'),
    readProjectJson(relativePath) {
      if (!Object.hasOwn(files, relativePath)) throw new Error(`No fixture for ${relativePath}`);
      return files[relativePath];
    },
    getInstalledPaths: () => ['node_modules/picomatch'],
    getVersions: registryVersions(),
    async getAdvisory() { return githubAdvisory(); },
    ...overrides,
  });
}

function addUnrelatedVulnerability(audit) {
  audit.vulnerabilities.unrelated = {
    name: 'unrelated', severity: 'low', isDirect: true, range: '<1.0.1',
    nodes: ['node_modules/unrelated'], effects: [], fixAvailable: true,
    via: [{
      source: 5678, name: 'unrelated', dependency: 'unrelated', title: 'Unrelated vulnerability',
      url: 'https://github.com/advisories/GHSA-2222-3333-4444', severity: 'low', range: '<1.0.1',
      cwe: [], cvss: { score: 0, vectorString: null },
    }],
  };
  audit.metadata.vulnerabilities.low++;
  audit.metadata.vulnerabilities.total++;
}

test('accepts the exact current frontend audit and logs its exception', async () => {
  const summary = (await check()).join('\n');
  for (const expected of [id, 'node_modules/picomatch', 'node_modules/@vitejs/plugin-react', '2026-12-01', '14']) {
    assert.ok(summary.includes(expected), `missing ${expected} in ${summary}`);
  }
});

test('rejects an unrelated low-severity advisory alongside the exception', async () => {
  const audit = auditFixture();
  addUnrelatedVulnerability(audit);
  await assert.rejects(check({ audit }));
});

test('rejects another advisory for the same package even when the approved advisory remains', async () => {
  const audit = auditFixture();
  audit.vulnerabilities.picomatch.via.push({
    ...advisory, source: 5678, url: 'https://github.com/advisories/GHSA-2222-3333-4444',
  });
  await assert.rejects(check({ audit }));
});

test('rejects an increase in the advisory severity', async () => {
  const audit = auditFixture();
  audit.vulnerabilities.picomatch.severity = 'critical';
  audit.vulnerabilities.picomatch.via[0].severity = 'critical';
  audit.metadata.vulnerabilities.high--;
  audit.metadata.vulnerabilities.critical++;
  await assert.rejects(check({ audit }));
});

test('rejects a changed vulnerable range', async () => {
  const audit = auditFixture();
  audit.vulnerabilities.picomatch.via[0].range = '<=4.0.8';
  await assert.rejects(check({ audit }));
});

test('rejects a changed affected package range even when the advisory is unchanged', async () => {
  const audit = auditFixture();
  audit.vulnerabilities.vite.range = '<=8.3.5';
  await assert.rejects(check({ audit }));
});

test('rejects an additional installed dependency path', async () => {
  const audit = auditFixture();
  const node = 'node_modules/vite/node_modules/picomatch';
  audit.vulnerabilities.picomatch.nodes.push(node);
  const files = projectFiles();
  files['package-lock.json'].packages[node] = { version: '4.0.7' };
  files[`${node}/package.json`] = { name: 'picomatch', version: '4.0.7' };
  await assert.rejects(check({ audit, files }));
});

test('rejects an installed copy that is missing from the audit and lockfile', async () => {
  const getInstalledPaths = () => ['node_modules/picomatch', 'node_modules/vite/node_modules/picomatch'];
  await assert.rejects(check({ getInstalledPaths }), /installed dependency paths changed/i);
});

test('rejects a new affected package in the same advisory chain', async () => {
  const audit = auditFixture();
  audit.vulnerabilities['new-dependent'] = {
    name: 'new-dependent', severity: 'high', isDirect: true, range: '*',
    via: ['vite'], effects: [], nodes: ['node_modules/new-dependent'], fixAvailable: false,
  };
  audit.vulnerabilities.vite.effects.push('new-dependent');
  audit.metadata.vulnerabilities.high++;
  audit.metadata.vulnerabilities.total++;
  await assert.rejects(check({ audit }));
});

test('rejects dependency-edge drift among the same affected packages', async () => {
  const audit = auditFixture();
  audit.vulnerabilities['@vitejs/plugin-react'].via.push('tinyglobby');
  audit.vulnerabilities.tinyglobby.effects.push('@vitejs/plugin-react');
  await assert.rejects(check({ audit }));
});

test('rejects a different installed version even when the lockfile agrees', async () => {
  const files = projectFiles();
  files['package-lock.json'].packages['node_modules/picomatch'].version = '4.0.6';
  files['node_modules/picomatch/package.json'].version = '4.0.6';
  await assert.rejects(check({ files }));
});

test('rejects disagreement between the installed version and the lockfile', async () => {
  const files = projectFiles();
  files['node_modules/picomatch/package.json'].version = '4.0.6';
  await assert.rejects(check({ files }));
});

test('rejects the exception on its expiry date in UTC', async () => {
  await assert.rejects(check({ now: new Date('2026-12-01T00:00:00Z') }), /expired/i);
});

test('accepts the exception throughout the preceding UTC day', async () => {
  assert.ok((await check({ now: new Date('2026-11-30T23:59:59Z') })).length);
});

test('rejects a stale exception on a clean frontend audit', async () => {
  await assert.rejects(check({ audit: auditFixture({ clean: true }) }), /stale/i);
});

test('rejects an audit that omits required vulnerability fields', async () => {
  const audit = auditFixture();
  delete audit.vulnerabilities.picomatch.nodes;
  await assert.rejects(check({ audit }));
});

test('rejects an audit whose counts disagree with its rows', async () => {
  const audit = auditFixture({ clean: true });
  audit.metadata.vulnerabilities.low = 1;
  audit.metadata.vulnerabilities.total = 1;
  await assert.rejects(check({ audit }));
});

for (const [name, auditResult] of [
  ['malformed JSON', { status: 1, stdout: '{"auditReportVersion":' }],
  ['non-JSON audit output', { status: 1, stdout: 'npm ERR! registry request failed' }],
  ['an audit error object', { status: 1, stdout: '{"error":{"code":"E503","summary":"registry unavailable"}}' }],
  ['an empty JSON object', { status: 0, stdout: '{}' }],
  ['an unexpected report schema', { status: 0, stdout: '{"auditReportVersion":1,"vulnerabilities":{}}' }],
  ['an audit that could not start', { status: null, stdout: '', error: new Error('spawn npm ENOENT') }],
  ['a clean-looking failed audit', { status: 1, stdout: JSON.stringify(auditFixture({ clean: true })) }],
]) {
  test(`rejects ${name}`, async () => {
    await assert.rejects(check({ auditResult, policy: { schemaVersion: 1, exceptions: [] }, project: 'root' }));
  });
}

test('rejects an unknown policy schema', async () => {
  await assert.rejects(check({ policy: { schemaVersion: 2, exceptions: [] } }));
});

test('rejects malformed fix metadata', async () => {
  const audit = auditFixture();
  audit.vulnerabilities.picomatch.fixAvailable.version = 'latest';
  await assert.rejects(check({ audit }), /malformed npm audit vulnerability row/i);
});

for (const fixAvailable of [true, { name: 'picomatch', version: '4.0.8', isSemVerMajor: false }]) {
  test(`instructs removal when npm audit reports a ${fixAvailable === true ? 'boolean' : 'non-major'} fix`, async () => {
    const audit = auditFixture();
    audit.vulnerabilities.picomatch.fixAvailable = fixAvailable;
    await assert.rejects(check({ audit }), removal);
  });
}

test('accepts the exception when npm audit only offers an incompatible major update', async () => {
  const audit = auditFixture();
  audit.vulnerabilities.picomatch.fixAvailable = { name: 'picomatch', version: '5.0.0', isSemVerMajor: true };
  assert.ok((await check({ audit })).length);
});

test('instructs removal when a compatible audit fix also changes the affected graph', async () => {
  const audit = auditFixture();
  const picomatch = audit.vulnerabilities.picomatch;
  picomatch.fixAvailable = true;
  picomatch.range = '<=4.0.7';
  await assert.rejects(check({ audit }), removal);
});

test('instructs removal when the advisory lists a first patched version', async () => {
  await assert.rejects(check({ async getAdvisory() { return githubAdvisory({ identifier: '4.0.8' }); } }), removal);
});

test('instructs removal when the registry contains a compatible patched version', async () => {
  const getVersions = registryVersions({ versions: ['4.0.7', '4.0.8'], compatible: ['4.0.8'] });
  await assert.rejects(check({ getVersions }), removal);
});

test('accepts the exception when only an incompatible registry version exists', async () => {
  const getVersions = registryVersions({ versions: ['4.0.7', '5.0.0'] });
  assert.ok((await check({ getVersions })).length);
});

test('rejects the exception if the package registry lookup fails', async () => {
  await assert.rejects(check({ async getVersions() { throw new Error('registry unavailable'); } }), /registry/i);
});

test('rejects the exception if the advisory lookup fails', async () => {
  await assert.rejects(check({ async getAdvisory() { throw new Error('advisory service unavailable'); } }), /advisory/i);
});

test('rejects an exception-free policy against the affected frontend', async () => {
  await assert.rejects(check({ policy: { schemaVersion: 1, exceptions: [] } }));
});

test('rejects an exception from another project', async () => {
  await assert.rejects(check({ project: 'root' }), /project/i);
});

test('accepts a clean root audit with zero exceptions', async () => {
  await check({ audit: auditFixture({ clean: true }), policy: { schemaVersion: 1, exceptions: [] }, project: 'root' });
});

test('rejects all vulnerabilities in the root project with zero exceptions', async () => {
  const audit = auditFixture({ clean: true });
  addUnrelatedVulnerability(audit);
  await assert.rejects(check({ audit, policy: { schemaVersion: 1, exceptions: [] }, project: 'root' }));
});
