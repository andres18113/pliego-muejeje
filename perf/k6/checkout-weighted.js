import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';

import { validateBenchmarkTarget } from './target-guard.js';

// Additive review cohort: the original journeys.js and matrix stay unchanged.
const BASE = validateBenchmarkTarget(__ENV.BASE_URL || 'http://127.0.0.1:18085', __ENV);
if (!__ENV.FIXTURES) throw new Error('Synthetic FIXTURES are required');
const fixtures = JSON.parse(open(__ENV.FIXTURES));
const users = Number(__ENV.VUS || 15);
const iterations = Number(__ENV.CHECKOUT_ITERATIONS_PER_VU || 10);
const target = users * iterations;
if (!Number.isInteger(users) || users < 1 || users > fixtures.customers.length || target < 100) {
  throw new Error('Require unique synthetic users and at least100 planned checkout calls');
}

const duration = new Trend('endpoint_duration', true);
const ordinaryDuration = new Trend('ordinary_http_duration', true);
const requests = new Counter('endpoint_requests');
const errors = new Rate('unexpected_errors');
const checkoutRequests = new Counter('checkout_requests');
const checkoutCreated = new Counter('checkout_created');
const pendingChecks = new Rate('pending_checkout_checks');
const completed = new Counter('completed_journeys');
const thresholds = {
  unexpected_errors: ['rate<0.01'],
  checks: ['rate>0.99'],
  checkout_requests: [`count>=${target}`],
  checkout_created: [`count>=${target}`],
  pending_checkout_checks: ['rate>0.99'],
};
for (const group of ['auth', 'cart', 'checkout']) {
  thresholds[`endpoint_duration{endpoint_group:${group}}`] = [`p(95)<${group === 'checkout' ? 3000 : 1500}`];
  thresholds[`endpoint_requests{endpoint_group:${group}}`] = ['count>0'];
  thresholds[`unexpected_errors{endpoint_group:${group}}`] = ['rate<0.01'];
}
export const options = {
  scenarios: {
    checkout_focus: {
      executor: 'per-vu-iterations', vus: users, iterations,
      maxDuration: '10m', gracefulStop: '35s', exec: 'checkoutJourney',
    },
  },
  thresholds, noCookiesReset: true, maxRedirects: 0,
  summaryTrendStats: ['min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
};

let token = null;
function user() { return fixtures.customers[exec.vu.idInTest - 1]; }
function headers() {
  const id = exec.vu.idInTest;
  return {
    'Content-Type': 'application/json', 'X-PLIEGO-SESSION-REQUEST': '1',
    'CF-Connecting-IP': `10.201.${Math.floor(id / 250)}.${id % 250 + 1}`,
    'X-Forwarded-For': `10.201.${Math.floor(id / 250)}.${id % 250 + 1}`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
function think() { sleep(2 + Math.random() * 4); }
function json(response) { try { return response.json(); } catch (_) { return null; } }
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
function request(group, method, path, body, expected = 200, template = path, extra = {}) {
  const response = http.request(method, BASE + path, body === null ? null : JSON.stringify(body), {
    headers: { ...headers(), ...extra }, timeout: '35s', redirects: 0,
    tags: { endpoint_group: group, name: `${method} ${template}` },
  });
  const valid = check(response, { [`${group}: expected ${expected}`]: r => r.status === expected });
  duration.add(response.timings.duration, { endpoint_group: group });
  ordinaryDuration.add(response.timings.duration);
  requests.add(1, { endpoint_group: group });
  errors.add(!valid, { endpoint_group: group });
  return response;
}

export function checkoutJourney() {
  token = null;
  const actor = user();
  const login = json(request('auth', 'POST', '/api/v1/auth/login', {
    email: actor.email, password: fixtures.password,
  }));
  if (!login || !login.accessToken) {
    check(false, { 'checkout precondition: authenticated synthetic customer': () => false });
    think(); return;
  }
  token = login.accessToken;
  const restored = json(request('auth', 'POST', '/api/v1/auth/refresh', null));
  if (restored && restored.accessToken) token = restored.accessToken;
  think();

  // Previous observational journeys may leave an unfinished cart. Clear only
  // this synthetic customer's cart, through its actual public contract.
  const before = json(request('cart', 'GET', '/api/v1/cart', null));
  for (const item of (before && before.items) || []) {
    request('cart', 'DELETE', `/api/v1/cart/items/${item.cartItemId}`, null, 204,
      '/api/v1/cart/items/{cartItemId}');
  }
  const ids = fixtures.physicalEditions;
  const selected = ids[(exec.vu.idInTest + exec.vu.iterationInScenario) % ids.length];
  const editionId = String(typeof selected === 'object' ? selected.editionId : selected);
  request('cart', 'POST', '/api/v1/cart/items', { editionId, quantity: 1 });
  const cart = json(request('cart', 'GET', '/api/v1/cart', null));
  const validCart = !!(cart && cart.cartId && cart.quoteFingerprint && cart.items.length === 1
    && cart.items[0].editionId === editionId && cart.items[0].quantity === 1);
  check(validCart, { 'checkout precondition: one eligible item and current quote': valid => valid });
  if (!validCart) {
    errors.add(true, { endpoint_group: 'cart' });
    request('auth', 'POST', '/api/v1/auth/logout', null, 204); token = null;
    think(); return;
  }
  think();

  checkoutRequests.add(1);
  const response = request('checkout', 'POST', '/api/v1/checkout', {
    paymentMethod: 'TRANSFER', simulationOutcome: 'PENDING', fulfillmentMethod: 'HOME_DELIVERY',
    addressId: String(actor.addressId), expectedCartId: cart.cartId,
    expectedQuoteFingerprint: cart.quoteFingerprint, billingRecipient: 'OTHER',
    billingIdentity: { type: 'EC_CEDULA', number: '1710034065' }, buyerName: 'Comprador sintético local',
    billingAddress: { line1: 'Calle local de pruebas 123', provinceId: '17', cityId: '893', countryCode: 'EC' },
  }, 201, '/api/v1/checkout', { 'Idempotency-Key': uuid() });
  const outcome = json(response);
  const pending = response.status === 201 && !!outcome && !!outcome.orderId
    && outcome.paymentState === 'PENDING' && outcome.orderState === 'PENDING_PAYMENT';
  check(pending, { 'checkout: created order with transfer still pending': valid => valid });
  pendingChecks.add(pending);
  if (pending) checkoutCreated.add(1);
  else errors.add(true, { endpoint_group: 'checkout' });
  request('auth', 'POST', '/api/v1/auth/logout', null, 204);
  token = null;
  completed.add(1, { journey: 'checkout' });
  think();
}

export function handleSummary(data) {
  return { [__ENV.SUMMARY || 'summary.json']: JSON.stringify(data, null, 2) };
}
