import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  SettingsUpdate,
  ConnTestRequest,
  SecretsStatus,
  Settings,
  type ConnTestResult,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { SettingsService } from './service.js';

/**
 * F1 — settings module. Transport only; the use cases are in SettingsService.
 *   GET  /settings                 → current non-secret prefs
 *   PUT  /settings                 → upsert prefs (key/value rows)
 *   GET  /settings/secrets-status  → which provider keys are configured
 *   POST /settings/test-connection → test a provider key; a key from the UI is
 *                                    saved only when the test passes
 *
 * Secrets are NOT stored in the DB — only non-secret prefs.
 */
export default async function settingsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new SettingsService({
    store: container.settingsRepo,
    secrets: container.secrets,
    checkCredentials: (provider, key) => container.checkCredentials(provider, key),
    invalidateSecretCaches: () => container.invalidateSecretCaches(),
  });

  app.get('/settings', { schema: { response: { 200: Settings } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.get(workspaceId);
  });

  // Which provider keys are configured (booleans only — the values are NEVER
  // returned). Drives the "Configured / Not set" badges in the API Keys panel.
  app.get('/settings/secrets-status', { schema: { response: { 200: SecretsStatus } } }, async (req) => {
    await getContext(container, req);
    return service.secretsStatus();
  });

  app.put('/settings', { schema: { body: SettingsUpdate } }, async (req) => {
    const { workspaceId, userId } = await getContext(container, req);
    return service.update(workspaceId, userId, req.body);
  });

  app.post(
    '/settings/test-connection',
    {
      schema: { body: ConnTestRequest },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    // Provider keys are global (not per workspace), so no request context is needed.
    async (req): Promise<ConnTestResult> => service.testConnection(req.body.provider, req.body.key),
  );
}
