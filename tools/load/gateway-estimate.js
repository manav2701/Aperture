/* global __ENV */
// k6 load test of the gateway's decision path without spending money upstream
// (plan/phases/phase-10 §10.5): POST /v1/estimate runs key auth, policy, mandates and
// budget reads, but never calls a provider.
//
//   k6 run -e GATEWAY=https://gw.example.com -e KEY=apk_live_… tools/load/gateway-estimate.js
//   docker run --rm -i grafana/k6 run -e GATEWAY=… -e KEY=… - < tools/load/gateway-estimate.js
//
// Per-key limits apply (600/min by default): use a key with raised limits, or several keys.
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 200),
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: 100,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(99)<300'],
  },
};

const body = JSON.stringify({ type: 'chat', model: 'openai/gpt-4o-mini', prompt: 'hello', max_tokens: 64 });

export default function () {
  const response = http.post(`${__ENV.GATEWAY}/v1/estimate`, body, {
    headers: { authorization: `Bearer ${__ENV.KEY}`, 'content-type': 'application/json' },
  });
  check(response, { 'status 200': (r) => r.status === 200 });
}
