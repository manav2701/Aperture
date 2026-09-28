/* global __ENV, __VU, __ITER */
// k6 load test of the real-time card authorization webhook (K1: p99 < 400 ms at 50 rps).
// Signs synthetic `issuing_authorization.request` events with the connection's authorization
// webhook secret, for a card issued through Aperture in a test org.
//
//   k6 run -e API=https://api.example.com -e CONNECTION=<connection id> -e SECRET=whsec_… \
//          -e CARD=ic_… tools/load/card-auth.js
//
// Each event is a new authorization of 0.01 USD, so the test org's budget must cover
// rate × duration × 0.01 (holds are released by the nightly reconciliation or expiry).
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';

export const options = {
  scenarios: {
    stripe: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 50),
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: 60,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(99)<400'],
  },
};

export default function () {
  const id = `iauth_load${Date.now()}${__VU}${__ITER}`;
  const event = JSON.stringify({
    id: `evt_load${Date.now()}${__VU}${__ITER}`,
    type: 'issuing_authorization.request',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id,
        object: 'issuing.authorization',
        approved: false,
        status: 'pending',
        amount: 1,
        currency: 'usd',
        card: { id: __ENV.CARD },
        merchant_data: {
          category: 'computer_software_stores',
          category_code: '5734',
          country: 'US',
          name: 'Load Test',
        },
        pending_request: { amount: 1, currency: 'usd', is_amount_controllable: false },
        request_history: [],
      },
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.hmac('sha256', __ENV.SECRET, `${timestamp}.${event}`, 'hex');
  const response = http.post(`${__ENV.API}/webhooks/stripe/${__ENV.CONNECTION}/authorization`, event, {
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
  });
  check(response, { 'answered 200': (r) => r.status === 200, approved: (r) => r.json('approved') === true });
}
