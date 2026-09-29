import type { Provider } from "@devdigest/shared";

/** Constants shared by the agents routes (list + editor). */

/** LLM providers an agent can use, in picker order. */
export const PROVIDER_OPTIONS: readonly Provider[] = ["openai", "anthropic", "openrouter"];
