import { sql } from '@aperture/db';
import { createServiceApp } from '@aperture/runtime';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { anthropicAdapter, geminiAdapter, openAiAdapter, type Json, type OpenAiRoute } from './adapters';
import { GatewayError, errorResponse } from './errors';
import { governedRequest, type BuildInput, type GatewayDeps } from './pipeline';

const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * OpenAI-format routing: `vendor/model` ids go to OpenRouter when it is connected (or to OpenAI
 * for `openai/…` when only OpenAI is); bare ids like `gpt-4o-mini` go to OpenAI.
 */
function routeOpenAi(route: OpenAiRoute) {
  return ({ body, connected, cap }: BuildInput) => {
    const model = typeof body.model === 'string' ? body.model : '';
    const base = { route, body, cap };
    if (model.includes('/')) {
      if (connected.has('openrouter')) return openAiAdapter({ ...base, provider: 'openrouter', model });
      if (model.startsWith('openai/') && connected.has('openai'))
        return openAiAdapter({ ...base, provider: 'openai', model: model.slice(7) });
      throw new GatewayError('aperture_provider_not_connected', `connect OpenRouter to use ${model}`);
    }
    if (connected.has('openai')) return openAiAdapter({ ...base, provider: 'openai', model });
    throw new GatewayError(
      'aperture_provider_not_connected',
      connected.has('openrouter')
        ? `use an OpenRouter model id such as openai/${model}`
        : 'connect OpenAI or OpenRouter to use this route',
    );
  };
}

export function buildApp(deps: GatewayDeps) {
  const app = new Hono();

  app.route(
    '/',
    createServiceApp({
      service: 'gateway',
      logger: deps.logger,
      readinessChecks: [
        {
          name: 'database',
          check: async () => {
            await deps.db.execute(sql`select 1`);
          },
        },
      ],
    }),
  );

  const tooLarge = () =>
    errorResponse(
      new GatewayError('aperture_invalid_request', 'the request body is larger than 10 MB'),
      'openai',
      'none',
    );
  app.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge }));

  const openAi = (route: OpenAiRoute, path: string) =>
    app.post(path, (c) => governedRequest(deps, c.req.raw, path, 'openai', routeOpenAi(route)));
  openAi('chat', '/v1/chat/completions');
  openAi('embeddings', '/v1/embeddings');
  openAi('responses', '/v1/responses');

  app.post('/anthropic/v1/messages', (c) =>
    governedRequest(deps, c.req.raw, '/anthropic/v1/messages', 'anthropic', ({ body, cap }) =>
      anthropicAdapter({ body, cap }),
    ),
  );

  // Gemini puts the model and method in the path: /v1beta/models/gemini-2.5-flash:generateContent
  app.post('/google/v1beta/models/:call', (c) => {
    const call = c.req.param('call');
    const separator = call.lastIndexOf(':');
    const model = separator > 0 ? call.slice(0, separator) : '';
    const method = separator > 0 ? call.slice(separator + 1) : '';
    if (
      !/^[A-Za-z0-9._-]{1,100}$/.test(model) ||
      (method !== 'generateContent' && method !== 'streamGenerateContent')
    ) {
      return errorResponse(
        new GatewayError('aperture_invalid_request', 'expected models/{model}:generateContent'),
        'gemini',
        'none',
      );
    }
    return governedRequest(
      deps,
      c.req.raw,
      `/google/v1beta/models/{model}:${method}`,
      'gemini',
      ({ body, cap }: { body: Json; cap: bigint | undefined }) =>
        geminiAdapter({ model, stream: method === 'streamGenerateContent', body, cap }),
    );
  });

  app.post('/hf/v1/chat/completions', (c) =>
    governedRequest(deps, c.req.raw, '/hf/v1/chat/completions', 'openai', ({ body, cap }) =>
      openAiAdapter({
        provider: 'huggingface',
        route: 'chat',
        body,
        cap,
        model: typeof body.model === 'string' ? body.model : '',
      }),
    ),
  );

  app.notFound(() =>
    errorResponse(new GatewayError('aperture_invalid_request', 'no such gateway route'), 'openai', 'none'),
  );
  return app;
}
