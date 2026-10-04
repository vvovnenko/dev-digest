import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  ChatMessage,
  LLMUsage,
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import { toJsonSchema, parseWithRepair } from '../../platform/structured.js';
import { estimateCost, type CostEstimator } from './pricing.js';
import { ExternalServiceError } from '../../platform/errors.js';

const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_MAX_TOKENS = 4096;

/** Anthropic has no embeddings API; embeddings come from the OpenAI Embedder. */
function splitSystem(messages: ChatMessage[]): {
  system: string;
  rest: Anthropic.MessageParam[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  return { system, rest };
}

/**
 * Request features the newest models (Opus 5.5, Sonnet 5.5, Fable 5.1, …) reject
 * with a 400, one per response — so the provider drops them per model:
 * - a forced tool: `tool_choice: type "tool" and "any" are not supported for this
 *   model.` (only `auto` / `none` pass);
 * - `temperature`: `` `temperature` is deprecated for this model.``
 */
type DroppableFeature = 'forced_tool' | 'temperature';

/** The feature a 400 says the model rejects, when it is one we can drop; else null. */
function rejectedFeature(err: unknown): DroppableFeature | null {
  if (!(err instanceof Anthropic.APIError) || err.status !== 400) return null;
  if (/tool_choice.*not supported/i.test(err.message)) return 'forced_tool';
  if (/temperature.*(deprecated|not supported)/i.test(err.message)) return 'temperature';
  return null;
}

/** The tool_use block a reply answered with, or its text when it didn't call the tool. */
function rawAnswer(content: Anthropic.ContentBlock[]): { raw: string; toolUse?: Anthropic.ToolUseBlock } {
  const toolUse = content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (toolUse) return { raw: JSON.stringify(toolUse.input), toolUse };
  const text = content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { raw: text };
}

export interface AnthropicProviderOptions {
  /** Injected fetch (tests); the SDK's default otherwise. */
  fetch?: ClientOptions['fetch'];
  /** Prices a call's tokens (the server injects the PriceBook); the static table otherwise. */
  estimateCost?: CostEstimator;
}

/**
 * Anthropic LLMProvider.
 * - listModels: dynamic via GET /models.
 * - completeStructured: one tool whose input_schema is our JSON schema. Forced
 *   (`tool_choice: tool`) where the model allows it; a model that rejects forced
 *   tool use is remembered and asked with `tool_choice: auto` plus an instruction
 *   to call the tool, its tool input or text JSON parsed either way. Zod
 *   validates; a failed parse is reprompted (as a `tool_result` after a tool call).
 * - Both completions send `temperature` unless the model rejected it (see
 *   DroppableFeature); a rejected request is not billed.
 * - Cost: the Messages API returns tokens, never USD, so `costUsd` is the summed
 *   tokens priced by the injected `estimateCost` (null for an unknown model).
 * - embed: NOT supported (throws) — use the OpenAI Embedder for vectors.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const;
  private client: Anthropic;
  /** Per model, the features it answered with a 400 — left out from then on. */
  private dropped = new Map<string, Set<DroppableFeature>>();
  private estimateCost: CostEstimator;

  constructor(apiKey: string, opts: AnthropicProviderOptions = {}) {
    this.client = new Anthropic({ apiKey, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    this.estimateCost = opts.estimateCost ?? estimateCost;
  }

  async listModels(): Promise<ModelInfo[]> {
    return withRetry(async () => {
      // SDK 0.33 exposes models.list()
      const res = await this.client.models.list();
      return res.data.map((m) => ({
        id: m.id,
        provider: 'anthropic' as const,
        label: m.display_name,
      }));
    });
  }

  /**
   * `messages.create` for `model`, built from the features it still accepts. A 400
   * naming a droppable feature records it for the model and repeats the request
   * without it; a feature already dropped (or any other error) is rethrown, so
   * there are at most two extra round-trips per model per process.
   */
  private async createAdaptive(
    model: string,
    build: (dropped: ReadonlySet<DroppableFeature>) => Anthropic.MessageCreateParamsNonStreaming,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Anthropic.Message> {
    let dropped = this.dropped.get(model);
    if (!dropped) this.dropped.set(model, (dropped = new Set()));
    for (;;) {
      const params = build(dropped);
      try {
        return await withRetry(() =>
          withTimeout(this.client.messages.create(params, signal ? { signal } : undefined), timeoutMs),
        );
      } catch (err) {
        const feature = rejectedFeature(err);
        if (!feature || dropped.has(feature)) throw err;
        dropped.add(feature);
      }
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const { system, rest } = splitSystem(req.messages);
    const res = await this.createAdaptive(
      req.model,
      (dropped) => ({
        model: req.model,
        ...(system ? { system } : {}),
        messages: rest,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(dropped.has('temperature') ? {} : { temperature: req.temperature ?? 0.2 }),
      }),
      req.timeoutMs ?? DEFAULT_TIMEOUT,
    );
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const tokensIn = res.usage.input_tokens;
    const tokensOut = res.usage.output_tokens;
    return {
      text,
      model: req.model,
      tokensIn,
      tokensOut,
      costUsd: this.estimateCost(req.model, tokensIn, tokensOut),
    };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const jsonSchema = toJsonSchema(req.schema, req.schemaName);
    const toolName = req.schemaName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const maxRetries = req.maxRetries ?? 2;
    const { system, rest } = splitSystem(req.messages);
    const messages: Anthropic.MessageParam[] = [...rest];
    const tool: Anthropic.Tool = {
      name: toolName,
      description: `Return the result as ${req.schemaName}.`,
      input_schema: jsonSchema.schema as Anthropic.Tool.InputSchema,
    };
    // Without forcing, the instruction is what makes the model call the tool.
    const autoSystem = [system, `Respond only by calling the \`${toolName}\` tool once, with the complete result.`]
      .filter(Boolean)
      .join('\n\n');
    let tokensIn = 0;
    let tokensOut = 0;
    let lastRaw = '';

    // Forced tool use guarantees a tool call, so it stays the default; a model
    // that rejects it is asked with `auto` (and the instruction) instead.
    const ask = () =>
      this.createAdaptive(
        req.model,
        (dropped) => {
          const forced = !dropped.has('forced_tool');
          const sys = forced ? system : autoSystem;
          return {
            model: req.model,
            ...(sys ? { system: sys } : {}),
            messages,
            max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(dropped.has('temperature') ? {} : { temperature: req.temperature ?? 0 }),
            tools: [tool],
            tool_choice: forced ? { type: 'tool', name: toolName } : { type: 'auto' },
          };
        },
        req.timeoutMs ?? DEFAULT_TIMEOUT,
        req.signal,
      );

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const res = await ask();
      tokensIn += res.usage.input_tokens;
      tokensOut += res.usage.output_tokens;

      const { raw, toolUse } = rawAnswer(res.content);
      lastRaw = raw;

      const parsed = parseWithRepair(req.schema, lastRaw);
      if (parsed.ok) {
        return {
          data: parsed.data,
          model: req.model,
          tokensIn,
          tokensOut,
          costUsd: this.estimateCost(req.model, tokensIn, tokensOut),
          raw: lastRaw,
          attempts: attempt,
        };
      }
      messages.push({ role: 'assistant', content: res.content });
      // A tool_use turn must be answered with its tool_result, or the API rejects
      // the next request; a text-only turn gets the reprompt as plain text.
      messages.push({
        role: 'user',
        content: toolUse
          ? [{ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: parsed.repromptMessage }]
          : `${parsed.repromptMessage}\n\nAnswer by calling the \`${toolName}\` tool.`,
      });
    }

    // Carry what the attempts cost, so a failed run still records it (read via `usage`).
    throw Object.assign(
      new ExternalServiceError('Anthropic structured output failed schema validation', { raw: lastRaw }),
      { usage: { tokensIn, tokensOut, costUsd: this.estimateCost(req.model, tokensIn, tokensOut) } satisfies LLMUsage },
    );
  }

  async embed(): Promise<number[][]> {
    throw new ExternalServiceError(
      'Anthropic does not provide embeddings; use the OpenAI Embedder.',
    );
  }
}
