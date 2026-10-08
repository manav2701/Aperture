import { describe, expect, it } from 'vitest';
import { SEAT_PROVIDER_IDS, SEAT_PROVIDER_INFO, seatConnectorFor, type SeatProvider } from '../src';
import { fakeProvider, json, noSleep } from './fake-fetch';

/*
 * Contract tests: each fake answers with the response shapes from the vendor's docs (read
 * 2026-10-08), and each test asserts both what we send (auth, paths, bodies) and what we read.
 */

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

describe('Cursor Admin API', () => {
  it('lists members with cycle spend and reads daily usage with Basic auth', async () => {
    const fake = fakeProvider({
      'GET /teams/members': json({
        teamMembers: [
          { id: 1, email: 'Dev@Acme.example', name: 'Dev', role: 'member', isRemoved: false },
          { id: 2, email: 'old@acme.example', name: 'Old', role: 'member', isRemoved: true },
        ],
      }),
      'POST /teams/spend': json({
        teamMemberSpend: [{ userId: 1, email: 'dev@acme.example', spendCents: 1250 }],
        subscriptionCycleStart: Date.parse('2026-10-01T00:00:00Z'),
        totalPages: 1,
      }),
      'POST /teams/daily-usage-data': json({
        data: [
          {
            userId: 1,
            email: 'dev@acme.example',
            date: Date.parse('2026-10-06T00:00:00Z'),
            isActive: true,
            composerRequests: 3,
            chatRequests: 2,
            agentRequests: 5,
            cmdkUsages: 1,
            totalLinesAdded: 40,
          },
        ],
        pagination: { hasNextPage: false },
      }),
    });
    const connector = seatConnectorFor('seat:cursor', {
      secret: 'key_abc',
      config: {},
      fetch: fake.fetch,
      sleep: noSleep,
    });
    const seats = await connector.listSeats();
    expect(seats).toEqual([
      expect.objectContaining({
        email: 'dev@acme.example',
        active: true,
        extraUsageCycle: { cycleStart: '2026-10-01', amount: 12_500_000n },
      }),
      expect.objectContaining({ email: 'old@acme.example', active: false }),
    ]);
    const usage = await connector.usage(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-08T00:00:00Z'));
    expect(usage).toEqual([expect.objectContaining({ day: '2026-10-06', requests: 11, active: true, linesAdded: 40 })]);
    expect(fake.calls[0]?.headers.get('authorization')).toBe(`Basic ${btoa('key_abc:')}`);
    const usageCall = fake.calls.find((c) => c.url.pathname === '/teams/daily-usage-data');
    expect(usageCall?.body).toMatchObject({ startDate: Date.parse('2026-10-01T00:00:00Z'), page: 1 });
    expect((await connector.test()).fingerprint).toMatch(/^cursor:[0-9a-f]{24}$/);
  });

  it('caps a usage window at 30 days', async () => {
    const fake = fakeProvider({
      'POST /teams/daily-usage-data': json({ data: [], pagination: { hasNextPage: false } }),
    });
    const connector = seatConnectorFor('seat:cursor', { secret: 'k', config: {}, fetch: fake.fetch, sleep: noSleep });
    const until = new Date('2026-10-08T00:00:00Z');
    await connector.usage(new Date('2026-01-01T00:00:00Z'), until);
    const body = fake.calls[0]?.body as { startDate: number; endDate: number };
    expect(body.endDate - body.startDate).toBe(30 * 86_400_000);
  });
});

describe('Claude Enterprise Analytics API', () => {
  it('reads members over a range and daily activity with the analytics key', async () => {
    const row = (email: string, messages: number, sessions: number) => ({
      user: { type: 'user', id: `user_${email}`, email_address: email },
      last_activity_date: day(2),
      chat_metrics: { message_count: messages },
      claude_code_metrics: {
        core_metrics: {
          distinct_session_count: sessions,
          commit_count: 1,
          pull_request_count: 0,
          lines_of_code: { added_count: 10, removed_count: 2 },
        },
      },
      cowork_metrics: { message_count: 0 },
    });
    const fake = fakeProvider({
      'GET /v1/organizations/analytics/users': json({
        data: [row('a@acme.example', 12, 1), row('b@acme.example', 0, 0)],
        next_page: null,
      }),
    });
    const connector = seatConnectorFor('seat:claude_enterprise', {
      secret: 'sk-ant-analytics',
      config: {},
      fetch: fake.fetch,
      sleep: noSleep,
    });
    const seats = await connector.listSeats();
    expect(seats.map((s) => s.email)).toEqual(['a@acme.example', 'b@acme.example']);
    expect(seats[0]?.plan).toBe('enterprise');
    expect(fake.calls[0]?.url.searchParams.get('starting_date')).not.toBeNull();
    const usage = await connector.usage(new Date(Date.now() - 4 * 86_400_000), new Date());
    expect(usage.find((u) => u.email === 'a@acme.example')).toMatchObject({
      requests: 13,
      sessions: 1,
      commits: 1,
      active: true,
    });
    expect(fake.calls[0]?.headers.get('x-api-key')).toBe('sk-ant-analytics');
    expect(fake.calls[0]?.headers.get('anthropic-version')).toBe('2023-06-01');
  });
});

describe('Claude Code Analytics API', () => {
  it('reads per-developer sessions, tokens, and estimated cost (cents → µUSD)', async () => {
    const fake = fakeProvider({
      'GET /v1/organizations/usage_report/claude_code': json({
        data: [
          {
            date: `${day(1)}T00:00:00Z`,
            actor: { type: 'user_actor', email_address: 'Dev@Acme.example' },
            organization_id: 'org',
            customer_type: 'subscription',
            terminal_type: 'vscode',
            core_metrics: {
              num_sessions: 5,
              lines_of_code: { added: 1543, removed: 892 },
              commits_by_claude_code: 12,
              pull_requests_by_claude_code: 2,
            },
            model_breakdown: [
              {
                model: 'claude-opus-5-5',
                tokens: { input: 100000, output: 35000, cache_read: 10000, cache_creation: 5000 },
                estimated_cost: { currency: 'USD', amount: 113 },
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    });
    const connector = seatConnectorFor('seat:claude_code', {
      secret: 'sk-ant-admin01-x',
      config: {},
      fetch: fake.fetch,
      sleep: noSleep,
    });
    const usage = await connector.usage(new Date(Date.now() - 2 * 86_400_000), new Date());
    const dev = usage.find((u) => u.email === 'dev@acme.example');
    expect(dev).toMatchObject({ sessions: 5, commits: 12, pullRequests: 2, tokens: 150_000n });
    expect(dev?.models?.[0]).toMatchObject({ model: 'claude-opus-5-5', cost: 1_130_000n });
    const seats = await connector.listSeats();
    expect(seats[0]).toMatchObject({ email: 'dev@acme.example', plan: 'subscription' });
  });
});

describe('GitHub Copilot', () => {
  it('lists seats for the configured organization with the API version header', async () => {
    const fake = fakeProvider({
      'GET /orgs/acme/copilot/billing': json({ seat_breakdown: { total: 2 } }),
      'GET /orgs/acme/copilot/billing/seats': json({
        total_seats: 2,
        seats: [
          {
            assignee: { login: 'octo', id: 1 },
            last_activity_at: new Date(Date.now() - 86_400_000).toISOString(),
            pending_cancellation_date: null,
            plan_type: 'business',
            created_at: '2026-01-01T00:00:00Z',
          },
          {
            assignee: { login: 'gone', id: 2 },
            last_activity_at: null,
            pending_cancellation_date: '2026-11-01',
            plan_type: 'enterprise',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    });
    const connector = seatConnectorFor('seat:github_copilot', {
      secret: 'ghp_x',
      config: { org: 'acme' },
      fetch: fake.fetch,
      sleep: noSleep,
    });
    expect((await connector.test()).fingerprint).toBe('github:acme');
    const seats = await connector.listSeats();
    expect(seats).toEqual([
      expect.objectContaining({ externalId: 'octo', plan: 'business', active: true }),
      expect.objectContaining({ externalId: 'gone', plan: 'enterprise', active: false }),
    ]);
    expect((await connector.usage(new Date(Date.now() - 7 * 86_400_000), new Date())).map((d) => d.externalId)).toEqual(
      ['octo'],
    );
    expect(fake.calls[0]?.headers.get('x-github-api-version')).toBe('2022-11-28');
  });

  it('refuses an organization name that could change the path', () => {
    expect(() => seatConnectorFor('seat:github_copilot', { secret: 'x', config: { org: '../users' } })).toThrow(
      /organization/,
    );
  });
});

describe('Microsoft 365 Copilot', () => {
  it('signs in with client credentials and pages through the usage report on Graph only', async () => {
    const tenant = '11111111-2222-3333-4444-555555555555';
    const fake = fakeProvider({
      [`POST /${tenant}/oauth2/v2.0/token`]: json({ access_token: 'graph-token', expires_in: 3600 }),
      "GET /beta/reports/getMicrosoft365CopilotUsageUserDetail(period='D30')": [
        json({
          '@odata.nextLink':
            "https://graph.microsoft.com/beta/reports/getMicrosoft365CopilotUsageUserDetail(period='D30')?$skiptoken=abc",
          value: [{ userPrincipalName: 'sara@acme.example', displayName: 'Sara', lastActivityDate: day(3) }],
        }),
        json({
          value: [{ userPrincipalName: 'DC8C64D6EC3A3AA17481D7E5EB5B68A6', displayName: 'C65E', lastActivityDate: '' }],
        }),
      ],
    });
    const connector = seatConnectorFor('seat:m365_copilot', {
      secret: JSON.stringify({ tenantId: tenant, clientId: 'app', clientSecret: 's3cret' }),
      config: {},
      fetch: fake.fetch,
      sleep: noSleep,
    });
    const seats = await connector.listSeats();
    expect(seats).toEqual([
      expect.objectContaining({ email: 'sara@acme.example', plan: 'm365_copilot' }),
      expect.objectContaining({ email: null, lastActiveAt: null }),
    ]);
    const token = fake.calls[0];
    expect(String(token?.body)).toContain('grant_type=client_credentials');
    expect(fake.calls[1]?.headers.get('authorization')).toBe('Bearer graph-token');
  });

  it('rejects a secret that is not the expected JSON', () => {
    expect(() => seatConnectorFor('seat:m365_copilot', { secret: 'not json', config: {} })).toThrow(/tenantId/);
  });
});

describe('seat provider registry', () => {
  it('describes every provider', () => {
    for (const provider of SEAT_PROVIDER_IDS as readonly SeatProvider[]) {
      expect(SEAT_PROVIDER_INFO[provider].provider).toBe(provider);
      expect(SEAT_PROVIDER_INFO[provider].steps.length).toBeGreaterThan(0);
    }
  });
});
