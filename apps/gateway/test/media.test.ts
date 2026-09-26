import { json } from '@aperture/connectors/testing';
import { eq, schema, upsertMediaPrices, withSystem } from '@aperture/db';
import { pollMediaJobs, type JobDeps } from '@aperture/jobs';
import { memoryStorage } from '@aperture/media/testing';
import { createLogger } from '@aperture/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGatewayHarness, gateway, ledgerOf, ring, seedGatewayOrg, type GatewayHarness } from './harness';

let h: GatewayHarness;
beforeAll(async () => {
  h = await createGatewayHarness();
  await withSystem(h.system.db, (tx) =>
    upsertMediaPrices(tx, [
      // $0.035 per image.
      {
        provider: 'openrouter',
        model: 'bytedance-seed/seedream-5-0-lite',
        kind: 'image',
        perImage: 35_000n,
        perImageTokenPerM: null,
        perSecond: null,
        skus: {},
        source: 'test',
      },
      // $0.03/s at 720p without audio, $0.08/s with audio: estimates use the matching SKU.
      {
        provider: 'openrouter',
        model: 'google/veo-3.1-lite',
        kind: 'video',
        perImage: null,
        perImageTokenPerM: null,
        perSecond: 80_000n,
        skus: { duration_seconds_with_audio: '0.08', duration_seconds_without_audio_720p: '0.03' },
        source: 'test',
      },
    ]),
  );
});
afterAll(async () => {
  await h.close();
});

const PNG = Buffer.from('fake-png-bytes').toString('base64');
const image = { model: 'bytedance-seed/seedream-5-0-lite', prompt: 'a coffee cup on a desk', n: 2 };
const video = { model: 'google/veo-3.1-lite', prompt: 'waves at sunset', seconds: 4, resolution: '720p', audio: false };

function jobDeps(storage: ReturnType<typeof memoryStorage>, fetch: JobDeps['fetch']): JobDeps {
  return {
    database: h.app,
    ring,
    logger: createLogger({ service: 'media-test', level: 'silent' }),
    email: { send: () => Promise.resolve() },
    webOrigin: 'http://localhost:3000',
    fetch,
    storage,
  };
}

describe('images', () => {
  it('generates, stores privately, settles the exact cost, and returns signed URLs', async () => {
    const org = await seedGatewayOrg(h);
    const storage = memoryStorage();
    const { call, upstream } = gateway(
      h,
      {
        'POST /api/v1/images': json({
          data: [
            { b64_json: PNG, media_type: 'image/png' },
            { b64_json: PNG, media_type: 'image/png' },
          ],
          usage: { cost: 0.07 },
        }),
      },
      { storage },
    );
    const response = await call('/v1/images/generations', org.key, image);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { url: string }[]; aperture: { job_id: string; cost_usd: string } };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]?.url).toMatch(
      new RegExp(`^https://storage\\.test/org/${org.org.id}/media/${body.aperture.job_id}/0\\.png\\?expires=900`),
    );
    expect(body.aperture.cost_usd).toBe('0.07');
    expect(storage.objects.size).toBe(2);
    expect(upstream.calls[0]?.body).toMatchObject({ model: image.model, n: 2 });

    const entries = await ledgerOf(h, org.org.id);
    expect(entries.find((e) => e.kind === 'hold')?.amount).toBe(70_000n); // 2 × $0.035 reserved
    expect(entries.find((e) => e.kind === 'capture')?.amount).toBe(70_000n);
    const [job] = await h.system.db.select().from(schema.mediaJobs).where(eq(schema.mediaJobs.orgId, org.org.id));
    expect(job).toMatchObject({ kind: 'image', status: 'succeeded', cost: 70_000n, prompt: image.prompt });
  });

  it('releases the hold when the provider refuses, and never calls it past policy or budget', async () => {
    const org = await seedGatewayOrg(h, { agent: '0.05' });
    const storage = memoryStorage();
    const { call, upstream } = gateway(
      h,
      { 'POST /api/v1/images': json({ error: 'content policy' }, 400) },
      { storage },
    );
    const refused = await call('/v1/images/generations', org.key, { ...image, n: 1 });
    expect(refused.status).toBe(400);
    expect((await ledgerOf(h, org.org.id)).map((e) => e.kind).sort()).toEqual(['hold', 'release']);

    const overBudget = await call('/v1/images/generations', org.key, { ...image, n: 2 }); // $0.07 > $0.05
    expect(overBudget.status).toBe(402);

    await h.system.db.insert(schema.policies).values({
      id: crypto.randomUUID(),
      orgId: org.org.id,
      scope: 'org',
      scopeId: org.org.id,
      version: 1,
      document: { rules: [{ id: 'one-image', type: 'media_limits', maxImages: 1 }] },
      createdBy: (await h.system.db.select().from(schema.users).limit(1))[0]?.id ?? '',
    });
    const tooMany = await gateway(h, {}, { storage }).call('/v1/images/generations', org.key, { ...image, n: 2 });
    expect(tooMany.status).toBe(403);
    expect(upstream.calls).toHaveLength(1);
  });

  it('refuses unpriced models and deployments without storage', async () => {
    const org = await seedGatewayOrg(h);
    expect(
      (
        await gateway(h, {}, { storage: memoryStorage() }).call('/v1/images/generations', org.key, {
          ...image,
          model: 'mystery/model',
        })
      ).status,
    ).toBe(403);
    expect((await gateway(h, {}).call('/v1/images/generations', org.key, image)).status).toBe(503);
  });
});

describe('videos', () => {
  it('reserves the per-second estimate, then the poller stores the video and settles the reported cost', async () => {
    const org = await seedGatewayOrg(h);
    const storage = memoryStorage();
    let polls = 0;
    const routes = {
      'POST /api/v1/videos': json({ id: 'gen-vid-1', status: 'pending', polling_url: '/x' }),
      'GET /api/v1/videos/gen-vid-1': () => {
        polls += 1;
        return polls < 3
          ? Response.json({ id: 'gen-vid-1', status: 'in_progress', polling_url: '/x' })
          : Response.json({
              id: 'gen-vid-1',
              status: 'completed',
              polling_url: '/x',
              unsigned_urls: ['u'],
              usage: { cost: 0.11 },
            });
      },
      'GET /api/v1/videos/gen-vid-1/content': () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } }),
    };
    const { call, upstream } = gateway(h, routes, { storage });
    const submitted = await call('/v1/videos', org.key, video);
    expect(submitted.status).toBe(202);
    const job = (await submitted.json()) as { id: string; held_usd: string };
    expect(job.held_usd).toBe('0.12'); // 4 s × $0.03 (720p, no audio)
    expect(upstream.calls[0]?.body).toMatchObject({
      model: video.model,
      duration: 4,
      resolution: '720p',
      generate_audio: false,
    });

    const deps = jobDeps(storage, upstream.fetch);
    await pollMediaJobs(deps);
    await pollMediaJobs(deps);
    const running = await gateway(h, routes, { storage }).app.request(`/v1/media/${job.id}`, {
      headers: { authorization: `Bearer ${org.key}` },
    });
    expect(await running.json()).toMatchObject({ status: 'running', outputs: [] });
    await pollMediaJobs(deps);

    const done = await gateway(h, routes, { storage }).app.request(`/v1/media/${job.id}`, {
      headers: { authorization: `Bearer ${org.key}` },
    });
    expect(await done.json()).toMatchObject({
      status: 'succeeded',
      cost_usd: '0.11',
      outputs: [{ content_type: 'video/mp4' }],
    });
    expect([...storage.objects.keys()]).toEqual([`org/${org.org.id}/media/${job.id}/0.mp4`]);
    expect((await ledgerOf(h, org.org.id)).find((e) => e.kind === 'capture')?.amount).toBe(110_000n);
    const [request] = await h.system.db
      .select()
      .from(schema.gatewayRequests)
      .where(eq(schema.gatewayRequests.orgId, org.org.id));
    expect(request?.cost).toBe(110_000n);

    // Another principal (even in the same org) can't read the job.
    const other = await seedGatewayOrg(h);
    const hidden = await gateway(h, routes, { storage }).app.request(`/v1/media/${job.id}`, {
      headers: { authorization: `Bearer ${other.key}` },
    });
    expect(hidden.status).toBe(404);
  });

  it('does not charge failed generations from providers that don’t bill failures (G13)', async () => {
    const org = await seedGatewayOrg(h);
    const storage = memoryStorage();
    const routes = {
      'POST /api/v1/videos': json({ id: 'gen-vid-2', status: 'pending', polling_url: '/x' }),
      'GET /api/v1/videos/gen-vid-2': json({
        id: 'gen-vid-2',
        status: 'failed',
        polling_url: '/x',
        error: 'moderation',
      }),
    };
    const { call, upstream } = gateway(h, routes, { storage });
    const { id } = (await (await call('/v1/videos', org.key, video)).json()) as { id: string };
    await pollMediaJobs(jobDeps(storage, upstream.fetch));
    const [job] = await h.system.db.select().from(schema.mediaJobs).where(eq(schema.mediaJobs.id, id));
    expect(job).toMatchObject({ status: 'failed', cost: 0n, error: 'moderation' });
    expect((await ledgerOf(h, org.org.id)).map((e) => e.kind).sort()).toEqual(['hold', 'release']);
  });

  it('keeps asking after the hold expires and settles a late success (G12)', async () => {
    const org = await seedGatewayOrg(h);
    const storage = memoryStorage();
    let finished = false;
    const routes = {
      'POST /api/v1/videos': json({ id: 'gen-vid-3', status: 'pending', polling_url: '/x' }),
      'GET /api/v1/videos/gen-vid-3': () =>
        Response.json(
          finished
            ? { id: 'gen-vid-3', status: 'completed', polling_url: '/x', unsigned_urls: ['u'], usage: { cost: 0.1 } }
            : { id: 'gen-vid-3', status: 'in_progress', polling_url: '/x' },
        ),
      'GET /api/v1/videos/gen-vid-3/content': () =>
        new Response(new Uint8Array([9]), { headers: { 'content-type': 'video/mp4' } }),
    };
    const { call, upstream } = gateway(h, routes, { storage });
    const { id } = (await (await call('/v1/videos', org.key, video)).json()) as { id: string };

    // Simulate the hold passing its TTL: holds.expire marks it reconciling.
    const [job] = await h.system.db.select().from(schema.mediaJobs).where(eq(schema.mediaJobs.id, id));
    await h.system.db
      .update(schema.holds)
      .set({ status: 'expired_reconciling' })
      .where(eq(schema.holds.id, job?.holdId ?? ''));
    const deps = jobDeps(storage, upstream.fetch);
    await pollMediaJobs(deps);
    expect((await h.system.db.select().from(schema.mediaJobs).where(eq(schema.mediaJobs.id, id)))[0]?.status).toBe(
      'expired_reconciling',
    );

    finished = true;
    await pollMediaJobs(deps);
    const [settled] = await h.system.db.select().from(schema.mediaJobs).where(eq(schema.mediaJobs.id, id));
    expect(settled).toMatchObject({ status: 'succeeded', cost: 100_000n });
    expect((await ledgerOf(h, org.org.id)).find((e) => e.kind === 'capture')?.amount).toBe(100_000n);
  });
});

describe('estimate', () => {
  it('previews cost and whether a request would be allowed, without reserving', async () => {
    const org = await seedGatewayOrg(h, { agent: '0.10' });
    const { call } = gateway(h, {}, { storage: memoryStorage() });
    const fits = (await (
      await call('/v1/estimate', org.key, {
        type: 'video',
        model: video.model,
        seconds: 2,
        resolution: '720p',
        audio: false,
      })
    ).json()) as Record<string, unknown>;
    expect(fits).toMatchObject({
      allowed: true,
      estimate_usd: '0.06',
      remaining_usd: '0.10',
      remaining_after_usd: '0.04',
    });
    const tooBig = (await (
      await call('/v1/estimate', org.key, { type: 'video', model: video.model, seconds: 8, audio: true })
    ).json()) as Record<string, unknown>;
    expect(tooBig).toMatchObject({ allowed: false, outcome: 'budget_exceeded', estimate_usd: '0.64' });
    expect(await ledgerOf(h, org.org.id)).toEqual([]);
  });
});
