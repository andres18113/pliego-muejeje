import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import exec from 'k6/execution';

import { validateBenchmarkTarget } from './target-guard.js';

const BASE = validateBenchmarkTarget(__ENV.BASE_URL || 'http://127.0.0.1:18085', __ENV);
if (!__ENV.FIXTURES) throw new Error('FIXTURES must point to synthetic seed output');
const fixtures = JSON.parse(open(__ENV.FIXTURES));
const VUS = Number(__ENV.VUS || 1);
const HOLD = __ENV.HOLD || '60s';
const SSE = __ENV.SSE === '1';
const STRESS = __ENV.STRESS === '1';
const duration = new Trend('endpoint_duration', true);
const ordinaryDuration = new Trend('ordinary_http_duration', true);
const errors = new Rate('unexpected_errors');
const requests = new Counter('endpoint_requests');
const completed = new Counter('completed_journeys');
const checkoutCreated = new Counter('checkout_created');
const sseDuration = new Trend('sse_stream_duration', true);
const sseErrors = new Rate('sse_errors');
const sseEvents = new Counter('sse_parsed_events');
const sseConnections = new Counter('sse_connections');
const groups = ['catalog', 'search', 'detail', 'auth', 'cart', 'checkout'];
const thresholds = { unexpected_errors: ['rate<0.01'], checks: ['rate>0.99'] };
for (const group of groups) {
  thresholds[`endpoint_duration{endpoint_group:${group}}`] = [`p(95)<${group === 'checkout' ? 3000 : ['auth','cart'].includes(group) ? 1500 : 800}`];
  thresholds[`unexpected_errors{endpoint_group:${group}}`] = ['rate<0.01'];
  thresholds[`endpoint_requests{endpoint_group:${group}}`] = ['count>0'];
}
if (SSE) {
  thresholds.sse_errors = ['rate<0.01'];
  thresholds.sse_connections = ['count>0'];
}
const httpStages = STRESS ? [
  { duration: '30s', target: 25 }, { duration: '120s', target: 25 },
  { duration: '30s', target: 40 }, { duration: '120s', target: 40 },
  { duration: '30s', target: 60 }, { duration: '120s', target: 60 },
  { duration: '30s', target: 100 }, { duration: '120s', target: 100 },
  { duration: '30s', target: 160 }, { duration: '120s', target: 160 },
  { duration: '30s', target: 0 },
] : [{ duration: '15s', target: VUS }, { duration: HOLD, target: VUS }, { duration: '15s', target: 0 }];
export const options = {
  scenarios: {
    ordinary: { executor: 'ramping-vus', exec: 'journey', startVUs: 0, stages: httpStages, gracefulRampDown: '35s', gracefulStop: '35s' },
    ...(SSE ? { streams: { executor: 'constant-vus', exec: 'stream', vus: VUS, duration: __ENV.SSE_DURATION || '660s', gracefulStop: '80s' } } : {}),
  },
  thresholds,
  noCookiesReset: true,
  maxRedirects: 0,
  summaryTrendStats: ['min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
};
let token = null;
let loggedIn = false;
function client() {
  const index = SSE ? (exec.vu.idInTest - 1) % VUS : exec.vu.idInTest - 1;
  return fixtures.customers[index % fixtures.customers.length];
}
function headers() {
  const id = exec.vu.idInTest;
  return { 'Content-Type': 'application/json', 'X-PLIEGO-SESSION-REQUEST': '1',
    'CF-Connecting-IP': `10.201.${Math.floor(id / 250)}.${id % 250 + 1}`,
    // Direct connector also works; nginx replaces this with CF-Connecting-IP.
    'X-Forwarded-For': `10.201.${Math.floor(id / 250)}.${id % 250 + 1}`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
function think() { sleep(2 + Math.random() * 4); }
function json(response) { try { return response.json(); } catch (_) { return null; } }
function request(group, method, path, body, expected = 200, template = path.split('?')[0]) {
  const response = http.request(method, BASE + path, body === null ? null : JSON.stringify(body), {
    headers: headers(), timeout: '35s', tags: { endpoint_group: group, name: `${method} ${template}` },
    redirects: 0,
  });
  const okay = check(response, { [`${group}: expected ${expected}`]: r => r.status === expected });
  duration.add(response.timings.duration, { endpoint_group: group });
  ordinaryDuration.add(response.timings.duration);
  errors.add(!okay, { endpoint_group: group });
  requests.add(1, { endpoint_group: group });
  return response;
}
function login() {
  const user = client();
  const response = request('auth', 'POST', '/api/v1/auth/login', { email: user.email, password: fixtures.password });
  const body = json(response);
  token = body && body.accessToken;
  loggedIn = !!token;
  return loggedIn;
}
function logout() {
  request('auth', 'POST', '/api/v1/auth/logout', null, 204);
  token = null;
  loggedIn = false;
}
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
export function journey() {
  // Stratified per-VU cycle: 70% browsing, 20% account/cart, 10% checkout.
  // The 1-VU smoke begins with checkout and covers every endpoint group.
  const slot = (exec.vu.iterationInScenario + exec.vu.idInTest - 1) % 10;
  const willAuth = slot < 3;
  const willCheckout = slot === 0;
  const page = (exec.vu.iterationInScenario + exec.vu.idInTest) % 3;
  request('catalog', 'GET', `/api/v1/catalog/editions?page=${page}&pageSize=20&sort=TITLE_ASC`, null);
  think();
  request('catalog', 'GET', '/api/v1/catalog/editions?productType=PHYSICAL&language=es&minPrice=1&maxPrice=100&page=0&pageSize=20&sort=PRICE_ASC', null);
  request('catalog', 'GET', '/api/v1/catalog/filter-options?scope=PHYSICAL', null);
  request('catalog', 'GET', '/api/v1/catalog/categories?scope=PHYSICAL', null);
  think();
  const terms = ['historia', 'novela', 'ciencia', 'literatura'];
  request('search', 'GET', `/api/v1/catalog/editions?que=${terms[(exec.vu.iterationInScenario + exec.vu.idInTest) % terms.length]}&page=0&pageSize=20`, null);
  const editions = fixtures.physicalEditions;
  const edition = editions[(exec.vu.idInTest + exec.vu.iterationInScenario) % editions.length];
  const editionId = String(typeof edition === 'object' ? edition.editionId : edition);
  request('detail', 'GET', `/api/v1/catalog/editions/${editionId}`, null, 200, '/api/v1/catalog/editions/{editionId}');
  think();
  if (willAuth && login()) {
    // Exercise the persistent per-VU cookie, not a manufactured JWT.
    const restored = json(request('auth', 'POST', '/api/v1/auth/refresh', null));
    if (restored && restored.accessToken) token = restored.accessToken;
    think();
    request('cart', 'POST', '/api/v1/cart/items', { editionId, quantity: 1 });
    let cart = json(request('cart', 'GET', '/api/v1/cart', null));
    const item = cart && cart.items && cart.items.find(i => i.editionId === editionId);
    if (item) {
      request('cart', 'PUT', `/api/v1/cart/items/${item.cartItemId}`, { quantity: 2 }, 200, '/api/v1/cart/items/{cartItemId}');
      request('cart', 'PUT', `/api/v1/cart/items/${item.cartItemId}`, { quantity: 1 }, 200, '/api/v1/cart/items/{cartItemId}');
      cart = json(request('cart', 'GET', '/api/v1/cart', null));
      think();
      if (willCheckout && cart) {
        const payload = {
          paymentMethod: 'TRANSFER', simulationOutcome: 'PENDING', fulfillmentMethod: 'HOME_DELIVERY',
          addressId: String(client().addressId), expectedCartId: cart.cartId,
          expectedQuoteFingerprint: cart.quoteFingerprint, billingRecipient: 'OTHER',
          billingIdentity: { type: 'EC_CEDULA', number: '1710034065' }, buyerName: 'Comprador sintético local',
          billingAddress: { line1: 'Calle local de pruebas 123', provinceId: '17', cityId: '893', countryCode: 'EC' },
        };
        const params = { headers: { ...headers(), 'Idempotency-Key': uuid() }, timeout: '35s',
          tags: { endpoint_group: 'checkout', name: 'POST /api/v1/checkout' }, redirects: 0 };
        const response = http.post(BASE + '/api/v1/checkout', JSON.stringify(payload), params);
        const body = json(response);
        const okay = check(response, { 'checkout: synthetic transfer remains pending': r => r.status === 201 && body && body.paymentState === 'PENDING' && body.orderState === 'PENDING_PAYMENT' });
        duration.add(response.timings.duration, { endpoint_group: 'checkout' }); ordinaryDuration.add(response.timings.duration);
        errors.add(!okay, { endpoint_group: 'checkout' }); requests.add(1, { endpoint_group: 'checkout' });
        if (okay) checkoutCreated.add(1);
      } else {
        request('cart', 'DELETE', `/api/v1/cart/items/${item.cartItemId}`, null, 204, '/api/v1/cart/items/{cartItemId}');
      }
    } else { check(false, { 'cart: added item present': () => false }); errors.add(true, { endpoint_group: 'cart' }); }
    logout();
  }
  completed.add(1, { journey: willCheckout ? 'checkout' : willAuth ? 'cart' : 'browse' });
  think();
}
export function stream() {
  // Separate cookies and measurements for long-lived streams; no extension.
  if (!loggedIn && !login()) { sseErrors.add(true); sleep(5); return; }
  const response = http.get(BASE + '/api/v1/auth/events', {
    headers: { ...headers(), Accept: 'text/event-stream', ...(exec.vu.iterationInScenario % 2 ? { 'Last-Event-ID': '0' } : {}) },
    timeout: '75s', tags: { endpoint_group: 'sse', name: 'GET /api/v1/auth/events' }, redirects: 0,
  });
  const body = response.body || '';
  const frames = body.replace(/\r\n/g, '\n').split('\n\n').filter(frame => frame.trim());
  const contentType = response.headers['Content-Type'] || '';
  const valid = response.status === 200 && !response.error && !response.error_code
    && contentType.includes('text/event-stream') && body.includes('heartbeat')
    && frames.length >= 3 && frames.every(frame => /(^|\n)(:|retry:|id:|event:|data:)/.test(frame))
    && response.timings.duration >= 55000 && response.timings.duration <= 65000;
  sseErrors.add(!valid); sseDuration.add(response.timings.duration); sseConnections.add(1);
  for (const frame of frames) {
    const kind = frame.includes('event:resync') || frame.includes('event: resync') ? 'resync'
      : /(^|\n)data:/.test(frame) ? 'event' : frame.includes('checkpoint') ? 'checkpoint' : 'heartbeat';
    sseEvents.add(1, { kind });
  }
  check(response, { 'sse: heartbeat and clean approximately 60s lifetime': () => valid });
  sleep(3);
}
export function handleSummary(data) {
  return { [__ENV.SUMMARY || 'summary.json']: JSON.stringify(data, null, 2) };
}
