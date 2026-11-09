// Pure init-time validation shared by k6 and Node. No URL normalization or DNS lookup.
export function validateBenchmarkTarget(raw, env = {}) {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\s\\%?#@]/.test(raw)) {
    throw new Error('Unsafe benchmark URL: credentials, escapes, queries and fragments refused');
  }
  const match = /^(http|https):\/\/([a-zA-Z0-9.-]+):([0-9]+)\/?$/.exec(raw);
  if (!match) throw new Error('Benchmark URL requires canonical host and explicit port');
  const [, scheme, rawHost, portText] = match;
  const host = rawHost.toLowerCase();
  // This rejection precedes every opt-in and allowlist comparison.
  if (host === 'pliegolibros.com' || host.endsWith('.pliegolibros.com')) {
    throw new Error('Production benchmark targets are forbidden');
  }
  if (host.endsWith('.') || host.includes('..') || host.split('.').some(x => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x))) {
    throw new Error('Noncanonical benchmark host');
  }
  const port = Number(portText);
  if (!/^[1-9][0-9]{0,4}$/.test(portText) || port > 65535) throw new Error('Invalid benchmark port');
  if (env.BENCHMARK_DISPOSABLE !== '1') throw new Error('BENCHMARK_DISPOSABLE=1 required');
  const loopback = host === '127.0.0.1' || host === 'localhost';
  if (loopback) {
    if (scheme !== 'http') throw new Error('Local benchmark uses HTTP');
  } else {
    if (/^[0-9.]+$/.test(host)) {
      if (!/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(host) || host.split('.').some(x => Number(x) > 255 || (x.length > 1 && x[0] === '0'))) {
        throw new Error('Noncanonical IPv4 target');
      }
      if (host.startsWith('127.') || host === '0.0.0.0' || host === '169.254.169.254') throw new Error('Unsafe address alias');
    } else if (!host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local')) {
      throw new Error('Local hostname aliases refused');
    }
    if (env.BENCHMARK_STAGING !== '1') throw new Error('BENCHMARK_STAGING=1 required');
    const allowed = (env.BENCHMARK_ALLOWED_HOSTS || '').split(',');
    if (!allowed.includes(host)) throw new Error('Benchmark hostname not in exact allowlist');
  }
  return `${scheme}://${host}:${port}`;
}
