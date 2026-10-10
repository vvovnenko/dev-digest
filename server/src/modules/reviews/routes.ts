import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ReviewRecord, RunRequest, RunSummary, RunTrace } from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams, pageQuery } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';
import { REVIEWS_PAGE, RUNS_PAGE, SSE_DONE_EVENT, SSE_HEARTBEAT_MS } from './constants.js';

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   POST   /findings/:id/(accept|dismiss)              → finding actions
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService({
    store: container.reviewRepo,
    queue: container.reviewQueue,
    agents: container.agentsRepo,
    runs: container.runBus,
    diffs: container.prDiffs,
    repoContext: container.repoIntel,
    llm: (provider) => container.llm(provider),
    intent: container.intentService,
    intentOnReview: container.config.intentOnReview,
  });

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Both fields are optional in the schema; the service asks for one of them.
  app.post(
    '/pulls/:id/review',
    {
      schema: { params: IdParams, body: RunRequest.optional() },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = req.body ?? {};
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const runId = req.params.id;
      const { runBus } = container;

      // Only this workspace's runs. One this process doesn't know is either
      // about to start (its row is `running`) or already over — finished before
      // a restart, or evicted from memory. Then replay its persisted log and
      // end, instead of waiting for a `done` that will never come.
      const status = await service.runStatus(workspaceId, runId);
      if (!status) throw new NotFoundError('Run not found');
      if (!runBus.isKnown(runId)) {
        if (status !== 'running') {
          const log = (await service.getRunTrace(workspaceId, runId))?.log ?? [];
          reply.sse(
            (async function* () {
              let seq = 0;
              for (const line of log) {
                const event: RunEvent = { runId, seq: ++seq, kind: line.kind, msg: line.msg, t: line.t };
                yield { id: String(event.seq), event: event.kind, data: JSON.stringify(event) };
              }
              yield { event: SSE_DONE_EVENT, data: JSON.stringify({ runId }) };
            })(),
          );
          return;
        }
      }

      // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
      const queue: RunEvent[] = [];
      let wake: (() => void) | null = null;
      let done = false; // the run finished: drain the queue, then end
      let gone = false; // the client went away: stop now
      let heartbeatDue = false;
      const nudge = () => wake?.();

      const unsubscribe = runBus.subscribe(runId, (e) => {
        queue.push(e);
        nudge();
      });
      const offDone = runBus.onDone(runId, () => {
        done = true;
        nudge();
      });
      // Keep idle connections (and proxies) from timing out during a long LLM call.
      const heartbeat = setInterval(() => {
        heartbeatDue = true;
        nudge();
      }, SSE_HEARTBEAT_MS);
      const release = () => {
        clearInterval(heartbeat);
        unsubscribe();
        offDone();
        reply.raw.off('close', onClose);
      };
      // The SSE plugin pipes the generator into the response and simply stops
      // pulling when the client goes away, so the generator never reaches its
      // `finally`: release here.
      const onClose = () => {
        gone = true;
        release();
        nudge();
      };
      reply.raw.on('close', onClose);

      reply.sse(
        (async function* () {
          try {
            while (!gone) {
              if (queue.length > 0) {
                const e = queue.shift()!;
                yield { id: String(e.seq), event: e.kind, data: JSON.stringify(e) };
              } else if (done) {
                yield { event: SSE_DONE_EVENT, data: JSON.stringify({ runId }) };
                break;
              } else if (heartbeatDue) {
                heartbeatDue = false;
                yield { comment: 'keepalive' };
              } else {
                await new Promise<void>((r) => (wake = r));
                wake = null;
              }
            }
          } finally {
            release();
          }
        })(),
      );
    },
  );

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  // The UI polls this and the run history every 4 s while a run is live: exempt
  // from the global rate limit, like the SSE stream.
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams }, config: { rateLimit: false } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get(
    '/pulls/:id/runs',
    {
      schema: { params: IdParams, querystring: pageQuery(RUNS_PAGE), response: { 200: z.array(RunSummary) } },
      config: { rateLimit: false },
    },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id, req.query);
    },
  );

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    await service.cancelRun(workspaceId, req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams, response: { 200: RunTrace } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const trace = await service.getRunTrace(workspaceId, req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get(
    '/pulls/:id/reviews',
    { schema: { params: IdParams, querystring: pageQuery(REVIEWS_PAGE), response: { 200: z.array(ReviewRecord) } } },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id, req.query);
    },
  );

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }
}
