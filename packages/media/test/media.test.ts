import { fakeProvider, json } from '@aperture/connectors/testing';
import { describe, expect, it } from 'vitest';
import {
  estimateImages,
  estimateVideo,
  fetchMediaCatalog,
  googleMedia,
  videoRate,
  type MediaPrice,
} from '../src/index';

const veoLite: MediaPrice = {
  provider: 'openrouter',
  model: 'google/veo-3.1-lite',
  kind: 'video',
  perImage: null,
  perImageTokenPerM: null,
  perSecond: 80_000n,
  skus: {
    duration_seconds_with_audio: '0.08',
    duration_seconds_without_audio: '0.05',
    duration_seconds_with_audio_720p: '0.05',
    duration_seconds_without_audio_720p: '0.03',
  },
  source: 'test',
};

describe('video rates', () => {
  it('pick the SKU matching resolution and audio, never below what could be charged', () => {
    expect(videoRate(veoLite, { resolution: '720p', audio: false })).toBe(30_000n);
    expect(videoRate(veoLite, { resolution: '720p', audio: true })).toBe(50_000n);
    expect(videoRate(veoLite, { audio: true })).toBe(80_000n);
    expect(videoRate(veoLite, {})).toBe(80_000n);
    expect(estimateVideo(veoLite, { seconds: 4, resolution: '720p', audio: false })).toBe(120_000n);
  });

  it('read cents-per-second SKUs', () => {
    const runway: MediaPrice = {
      ...veoLite,
      skus: { cents_per_second_output: '12', minimum_cents_per_generation: '56' },
    };
    expect(videoRate(runway, {})).toBe(120_000n);
  });
});

describe('image estimates', () => {
  it('multiply per-image prices, and bound token-priced models by the most tokens an image can take', () => {
    const perImage: MediaPrice = { ...veoLite, kind: 'image', perImage: 35_000n, perSecond: null, skus: {} };
    expect(estimateImages(perImage, { count: 3 })).toBe(105_000n);
    const gemini: MediaPrice = {
      ...perImage,
      model: 'google/gemini-3.1-flash-lite-image',
      perImage: null,
      perImageTokenPerM: 30_000_000n,
    };
    expect(estimateImages(gemini, { count: 1 })).toBe(42_000n); // 1,400 tokens × $30/M
    const unpriced: MediaPrice = { ...perImage, perImage: null };
    expect(estimateImages(unpriced, { count: 1 })).toBeNull();
  });
});

describe('media catalog', () => {
  it('normalises OpenRouter video and image prices and derives direct entries', async () => {
    const provider = fakeProvider({
      'GET /api/v1/videos/models': json({
        data: [
          {
            id: 'google/veo-3.1-lite',
            pricing_skus: { duration_seconds_without_audio_720p: '0.03', duration_seconds_with_audio: '0.08' },
          },
          { id: 'bytedance/seedance-2.0', pricing_skus: { video_tokens: '0.000007' } },
        ],
      }),
      'GET /api/v1/images/models': json({ data: [{ id: 'openai/gpt-image-1-mini' }, { id: 'broken/model' }] }),
      'GET /api/v1/images/models/openai/gpt-image-1-mini/endpoints': json({
        endpoints: [
          {
            pricing: [
              { billable: 'input_text', unit: 'token', cost_usd: 0.000002 },
              { billable: 'output_image', unit: 'token', cost_usd: 0.000008 },
            ],
          },
        ],
      }),
      'GET /api/v1/images/models/broken/model/endpoints': json({ error: 'nope' }, 500),
    });
    const catalog = await fetchMediaCatalog({ fetch: provider.fetch });
    const byKey = new Map(catalog.map((p) => [`${p.provider}:${p.model}:${p.kind}`, p]));
    expect(byKey.get('openrouter:google/veo-3.1-lite:video')?.perSecond).toBe(80_000n);
    expect(byKey.get('google:veo-3.1-lite-generate-preview:video')?.perSecond).toBe(80_000n);
    expect(byKey.get('openrouter:bytedance/seedance-2.0:video')?.perSecond).toBeNull(); // token-priced video: unpriced
    expect(byKey.get('openai:gpt-image-1-mini:image')?.perImageTokenPerM).toBe(8_000_000n);
    expect(byKey.has('openrouter:broken/model:image')).toBe(false);
  });
});

describe('Veo (Gemini API)', () => {
  it('submits, polls, and downloads with the key only on Google’s host, even across a redirect', async () => {
    const provider = fakeProvider({
      'POST /v1beta/models/veo-3.1-lite-generate-preview:predictLongRunning': json({
        name: 'models/veo-3.1-lite-generate-preview/operations/op1',
      }),
      'GET /v1beta/models/veo-3.1-lite-generate-preview/operations/op1': json({
        name: 'models/veo-3.1-lite-generate-preview/operations/op1',
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [
              { video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc:download' } },
            ],
          },
        },
      }),
      'GET /v1beta/files/abc:download': () =>
        new Response(null, { status: 302, headers: { location: 'https://storage.example.com/video.mp4' } }),
      'GET /video.mp4': () => new Response(new Uint8Array([7]), { headers: { 'content-type': 'video/mp4' } }),
    });
    const veo = googleMedia('gemini-key', provider.fetch);
    const operation = await veo.submitVideo({
      model: 'veo-3.1-lite-generate-preview',
      prompt: 'x',
      seconds: 4,
      resolution: '720p',
    });
    expect(provider.calls[0]?.body).toMatchObject({
      instances: [{ prompt: 'x' }],
      parameters: { durationSeconds: 4, resolution: '720p' },
    });
    const status = await veo.pollVideo(operation);
    expect(status.state).toBe('succeeded');
    const file = await veo.downloadVideo(operation, status.state === 'succeeded' ? (status.outputs[0] ?? '') : '');
    expect(file.bytes).toEqual(new Uint8Array([7]));
    const redirected = provider.calls.find((c) => c.url.host === 'storage.example.com');
    expect(redirected?.headers.get('x-goog-api-key')).toBeNull();
    await expect(veo.downloadVideo(operation, 'https://evil.example.com/x')).rejects.toThrow(
      /not on the Gemini API host/,
    );
    await expect(veo.pollVideo('../../etc')).rejects.toThrow(/operation name/);
  });
});
