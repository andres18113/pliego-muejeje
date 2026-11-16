// Native Chromium EventSource lifecycle probe. Credentials are fixture-only input,
// and neither requests' Cookie headers nor fixture credentials are logged.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const require = createRequire(fileURLToPath(new URL('../../frontend/package.json', import.meta.url)));
const { chromium } = require('playwright');
if(process.env.PLIEGO_TEST_DISPOSABLE_DB!=='1')throw Error('Explicit disposable environment required');
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
if(input.length!==2||new Set(input.map(value=>value.port)).size!==2||input.some(({port,cookie})=>![18085,18086].includes(port)||!/^[A-Za-z0-9_-]{43}$/.test(cookie)))throw Error('Only disposable proxy ports and fixture credentials accepted');
if (!process.env.TMPDIR?.includes('/.release-evidence/2026-11-03/proxy/')) throw Error('Retained browser TMPDIR required');
await mkdir(process.env.TMPDIR, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'], downloadsPath: process.env.TMPDIR });
try {
 const outcomes = await Promise.allSettled(input.map(async ({ port, cookie }) => {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'pliego_session', value: cookie, domain: '127.0.0.1', path: '/api/v1/auth', httpOnly: true, secure: false, sameSite: 'Strict' }]);
  const page = await context.newPage();
  const probeId=randomUUID();const requests=[];
  page.on('request', async request => {
   if(request.url().includes(`/api/v1/auth/events?probe=${probeId}`)) {
    const entry={at:Date.now(),method:request.method(),lastEventId:null};requests.push(entry);
    entry.lastEventId=(await request.allHeaders())['last-event-id']??null;
   }
  });
  await page.route('**/*', route => {
   const url=new URL(route.request().url());
   if(url.origin!==`http://127.0.0.1:${port}`)return route.abort('blockedbyclient');
   if(url.pathname==='/native-probe')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local SSE lifecycle probe</title>'});
   if(url.pathname==='/api/v1/auth/events')return route.continue();
   return route.abort('blockedbyclient');
  });
  await page.goto(`http://127.0.0.1:${port}/native-probe`);
  await page.evaluate(probeId => {
   window.probe={opens:[],errors:[],resync:[]};
   window.source=new EventSource(`/api/v1/auth/events?probe=${probeId}`,{withCredentials:true});
   source.onopen=()=>probe.opens.push(Date.now());
   source.onerror=()=>probe.errors.push({at:Date.now(),state:source.readyState});
   source.addEventListener('resync',event=>probe.resync.push({at:Date.now(),id:event.lastEventId,data:event.data}));
  },probeId);
  await page.waitForFunction(()=>probe.opens.length>=2, undefined, { timeout: 75000 });
  const result=await page.evaluate(()=>{ source.close(); return probe; });
  result.port=port; result.probeId=probeId;result.requests=requests;
  result.browserVersion=browser.version();result.cookiePolicyScope='Same-origin loopback HTTP with fixture HttpOnly, SameSite=Strict, secure=false; no production Secure or cross-origin cookie proof';
  result.reconnectAfterErrorMs=result.opens[1]-result.errors[0].at;
  result.lifetimeMs=result.errors[0].at-result.opens[0];
  await context.close();
  // Chromium's automatic Last-Event-ID is omitted by Playwright's request
  // header APIs here. Assert the value actually received by the real nginx.
  for(let attempt=0;attempt<20&&!result.nginxReconnectCursor;attempt++) {
   const log=await readFile(process.argv[4],'utf8');
   const own=log.trim().split('\n').map(line=>line.split(' ')).filter(([,serverPort,method,path,status,,probe])=>Number(serverPort)===port&&method==='GET'&&path==='/api/v1/auth/events'&&status==='200'&&probe===`probe=${probeId}`);
   result.nginxRequests=own.map(([timestamp,serverPort,method,path,status,cursor,probe,duration,upstream])=>({completedEpochMs:Number(timestamp)*1000,port:Number(serverPort),method,path,status:Number(status),cursor:cursor==='cursor=-'?null:cursor.slice(7),probe:probe.slice(6),durationSeconds:Number(duration.slice(9)),upstreamSeconds:upstream.slice(9)}));
   const resumed=own.filter(([, , , , ,cursor])=>/^cursor=\d+$/.test(cursor));
   if(resumed.length===1)result.nginxReconnectCursor=resumed[0][5].slice(7);
   if(!result.nginxReconnectCursor)await new Promise(resolve=>setTimeout(resolve,50));
  }
  await writeFile(process.argv[3]+'.'+port+'.debug.json',JSON.stringify(result,null,2));
  if(result.lifetimeMs<59000||result.lifetimeMs>63000)throw Error('Unexpected native stream lifetime');
  if(result.reconnectAfterErrorMs<2900||result.reconnectAfterErrorMs>4200)throw Error('retry3000 not honored');
  if(!result.nginxReconnectCursor)throw Error('Nginx did not receive native automatic Last-Event-ID');
  if(result.nginxRequests.length!==2||result.nginxRequests[0].cursor!==null)throw Error('Expected fresh request and exactly one automatic cursor resume for unique probe');
  if(BigInt(result.nginxReconnectCursor)<BigInt(result.resync[0].id))throw Error('Automatic cursor regressed');
  if(result.resync.length!==1)throw Error('Automatic reconnect unexpectedly resynced');
  return result;
 }));
 await writeFile(process.argv[3]+'.outcomes.json',JSON.stringify(outcomes.map(value=>value.status==='fulfilled'?{status:value.status,port:value.value.port}:{status:value.status,error:String(value.reason)}),null,2));
 const failures=outcomes.filter(value=>value.status==='rejected');
 if(failures.length)throw Error(failures.map(value=>String(value.reason)).join('; '));
 const results=outcomes.map(value=>value.value);
 await writeFile(process.argv[3],JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
} finally { await browser.close(); }
