import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBenchmarkTarget as guard } from './target-guard.js';
const opt = {BENCHMARK_DISPOSABLE:'1',BENCHMARK_STAGING:'1',BENCHMARK_ALLOWED_HOSTS:'10.33.0.8,load.staging.invalid'};
for (const [url, expected] of [['http://127.0.0.1:18085/','http://127.0.0.1:18085'],['http://localhost:8080','http://localhost:8080'],['http://10.33.0.8:80','http://10.33.0.8:80'],['https://load.staging.invalid:443','https://load.staging.invalid:443']]) {
 test(`allows ${url}`,()=>assert.equal(guard(url,opt),expected));
}
for (const url of ['https://pliegolibros.com:443','https://api.pliegolibros.com:443','https://a.b.pliegolibros.com:443','https://API.PLIEGOLIBROS.COM:443']) {
 test(`hard refuses ${url} even allowlisted`,()=>assert.throws(()=>guard(url,{...opt,BENCHMARK_ALLOWED_HOSTS:url.split('/')[2].split(':')[0].toLowerCase()}),/Production/));
}
for (const url of ['http://a@10.33.0.8:80','http://api.pliegolibros.com@10.33.0.8:80','http://10.33.0.8:80@api.pliegolibros.com','http://10.33.0.8:80/path','http://10.33.0.8:80?redirect=x','http://10.33.0.8:80#x','http://10.33.0.8%2f:80','http://10.33.0.8\\x:80','http://10.33.0.8:0','http://10.33.0.8:65536','http://10.33.0.8:080','http://10.33.0.8:-1','http://10.33.0.8','ftp://10.33.0.8:80','http://10.033.0.8:80','http://2130706433:80','http://127.1:80','http://127.0.0.2:80','http://0.0.0.0:80','http://169.254.169.254:80','http://localhost.local:80','http://x.localhost:80','http://load:80','http://load.staging.invalid.:80','http://a..invalid:80','http://[::1]:80','http://-a.invalid:80',' http://10.33.0.8:80']) {
 test(`rejects malformed/alias ${url}`,()=>assert.throws(()=>guard(url,{...opt,BENCHMARK_ALLOWED_HOSTS:'10.33.0.8,10.033.0.8,2130706433,127.1,127.0.0.2,0.0.0.0,169.254.169.254,localhost.local,x.localhost,load,load.staging.invalid.,a..invalid,-a.invalid'})));
}
for (const env of [{},{BENCHMARK_DISPOSABLE:'1'}, {...opt,BENCHMARK_DISPOSABLE:'0'}, {...opt,BENCHMARK_STAGING:'0'}, {...opt,BENCHMARK_ALLOWED_HOSTS:'10.33.0.80'}, {...opt,BENCHMARK_ALLOWED_HOSTS:'*.staging.invalid'}, {...opt,BENCHMARK_ALLOWED_HOSTS:'other.staging.invalid'}, {...opt,BENCHMARK_ALLOWED_HOSTS:' load.staging.invalid'}]) {
 test(`rejects missing opt-in/allowlist ${JSON.stringify(env)}`,()=>assert.throws(()=>guard('http://load.staging.invalid:80',env)));
}
test('DNS name requires exact hostname even when another name resolves to same address',()=>assert.throws(()=>guard('http://alias.staging.invalid:80',opt)));
test('localhost still needs disposable opt-in',()=>assert.throws(()=>guard('http://localhost:8080',{})));
