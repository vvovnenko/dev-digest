/** Constants for the settings module. */
import type { ConnTestProvider, SecretKey } from '@devdigest/shared';

/** Maps a connection-test provider to the SecretsProvider key it persists to. */
export const SECRET_KEY_BY_PROVIDER: Record<ConnTestProvider, SecretKey> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  github: 'GITHUB_TOKEN',
};
