# План: Intent Layer (L03) — намір PR → промпт рев'юера → відсів поза scope

**Status:** done — виконано 2026-10-09 (див. «Нотатка виконання» в кінці); не закомічено.
**Branch:** `module/L03` (головний checkout) · **Research:** [2026-10-09-intent-layer-research.md](2026-10-09-intent-layer-research.md)

## Context

Рев'юер бачить лише заголовок, опис (до 4000 символів) і diff. Він не знає, навіщо відкрито PR, тож коментує
й те, що лежить поза задачею. Intent Layer окремим дешевим викликом визначає намір PR:
`{ summary, in_scope[], out_of_scope[] }` + confidence + джерела + `missing_context`. Результат зберігається
для PR і показується карткою на Overview, щоб користувач перевірив, чи правильно система зрозуміла задачу.
Потім intent іде в промпт рев'юера, а детермінований код у reviewer-core відсіює знахідки поза scope. Від
серйозної проблеми лишається один сигнал.

Пре-стейдж уже є, але без викликачів: таблиця `pr_intent`, контракти `Intent`/`PrIntentRecord`, feature model
`review_intent` і `messages/en/brief.json`. README: `L03 | Intent layer · Smart Diff`. Smart Diff у цей план не
входить.

План склав `planner` (Opus, ~13 хв). Головна сесія звірила ключові посилання з кодом: `jobs.ts:42`,
`migrations-safety.test.ts:19`, `seed.ts:115`, `openrouter.ts`, `schema/reviews.ts:66-73`.

## Рішення

| # | Рішення | Хто / чому |
|---|---|---|
| U1 | Модель рев'юера лише **позначає** finding як out-of-scope, а відсіює код. WARNING/SUGGESTION поза scope йдуть у `dropped` з reason. З CRITICAL поза scope лишається **одна** знахідка (найвища confidence), решта теж у `dropped`; лишена рахується у verdict і gate. Якщо intent stale або має `low` confidence — tag-only: лише позначаємо, нічого не відсіюємо | користувач; `INJECTION_GUARD` (`reviewer-core/src/prompt.ts:18-30`) |
| U2 | Default `review_intent`: `openrouter` / `openai/gpt-5.4-nano` | користувач; research W1–W3 |
| U3 | Джерела: GitHub issue/PR через API; файли цього репо (head sha або diff самого PR); інші https `.md`/`.txt` через safe-fetch; Jira/Linear — `unavailable: no_integration`. Недоступне потрапляє в `missing_context` і знижує confidence | користувач |
| U4 | Картка Intent без Risk areas, Blast radius, PR Brief і Review focus (L04–L05) | користувач |
| M1 | Контракт `Intent.intent` → `summary`. Колонка `pr_intent.intent` лишається, але стає nullable (`DROP NOT NULL`) | текст задачі; `migrations-safety` |
| M2 | Confidence — enum `high/medium/low`. Cap рахує код, модель може тільки знизити. Точне правило — в Amendment A2 нижче | research W7–W11 |
| M3 | Тригери: кнопка «Derive intent» або ↻ (POST 202 + polling); pre-work рев'ю, якщо intent немає (не фатальний); stale intent → tag-only + банер; автоматичного re-derive немає | текст задачі |
| M4 | Бейдж «out of scope» на `FindingCard` | підтверджено разом із планом |
| M5 | Seed: рядок `pr_intent` для #482, ідемпотентно, поза `if (!pr)` | макет; e2e |
| D9 | Env `DEVDIGEST_INTENT_ON_REVIEW` (default on; у vitest off) | підтверджено разом із планом |
| A1 | `INTENT_MAX_TOKENS = 8000` (planner пропонував 4000): у picker можна обрати reasoning-модель | root INSIGHTS 2026-10-04 (deepseek reasoning) |

### Amendment A2 — опис без документації (уточнення користувача, 2026-10-09)

Відсутність документації — нормальний випадок, не помилка. Класифікатор **завжди** намагається зрозуміти намір із
наявних даних; посилання на ticket, план чи специфікацію лише підвищують якість і confidence.

| Що є в PR | Що робить класифікатор | Результат |
|---|---|---|
| Опис порожній, посилань немає | Виводить намір із заголовка, назви гілки, шляхів файлів, +a/−d і hunk headers (`@@ … @@ fn ctx`) | `status: done`; `summary` не порожній; `in_scope` з файлів і функцій у hunk headers; `out_of_scope` може бути `[]`; `confidence: low`; джерело `description` → `skipped` (reason `empty`); `missing_context: []` (брак опису видно з `low`, це не помилка) |
| Опис без посилань | Те саме + текст опису | `confidence: medium` |
| Посилання (в описі або заголовку), усе отримано | Матеріали — окремими блоками джерел; scope спирається передусім на них | `confidence: high` |
| Посилання, частину не отримано | Отримане використовується, недоступне ніколи не вигадується | `missing_context: ["#999: not_found"]`, `confidence: medium` |

Точне правило cap (`confidenceCap`, S5):
- `linked_used` — є джерело `issue|pull|repo_file|url` зі статусом `used|truncated`;
- `linked_missing` — є згадане посилання зі статусом `unavailable` або `skipped` (крім reason `empty`);
- `low`, якщо опис порожній і `linked_used` false;
- інакше `medium`, якщо `linked_missing` true або `linked_used` false;
- інакше `high`.

Підсумок — `min(cap, модель)`.

Ще три пункти:
- **Системний промпт класифікатора** (S6) каже прямо: «If the description is empty or has no linked documents, still
  infer the most likely intent from the title, branch name and the file/hunk outline; never answer "unknown"
  and never refuse; set confidence to low». «Не вигадуй» стосується лише змісту недоступних посилань.
- **Назва гілки** (`pull_requests.branch`) йде в блок `pr-meta` класифікатора поруч із заголовком.
- **Рев'ю з `low` intent:** intent іде в промпт, а модель бачить, що він виведений із непрямих даних. Відсіву
  немає (tag-only). Картка при `low` показує бейдж «Low confidence» і підказку «Derived from title and changed
  files — add a description or link a spec for a sharper intent». Стан `failed` — лише коли зламався виклик
  моделі, не через брак документації.

---

# Development Plan: Intent Layer (L03) — визначення наміру PR → промпт рев'юера → відсів поза scope

**Status:** READY
**Source:** цей файл (U1–U4, M1–M5, D9, A1, A2)    **Branch:** `module/L03` (головний checkout)    **Packages:** server, reviewer-core, client (e2e — лише побічний вплив)
**Goal:** Окремий дешевий виклик `review_intent` визначає `Intent {summary, in_scope[], out_of_scope[]}` разом із confidence, джерелами й `missing_context`. Результат зберігається для PR і показується карткою на Overview. Рев'юер отримує intent у промпті, а код у reviewer-core відсіює знахідки поза scope за правилом U1.
**Done when:**
- На PR без intent «Derive intent» повертає 202, а polling закінчується карткою `done` із джерелами й confidence.
- Повторне рев'ю показує в trace `## PR intent`.
- WARNING поза scope не потрапляє в рев'ю. Єдиний CRITICAL поза scope лишається з бейджем «out of scope» і впливає на verdict.
- Після зміни head sha з'являється банер, і рев'ю лише позначає знахідки (tag-only).
- PR без опису отримує intent із confidence `low`.
- `e2e:hermetic` зелений.

## 1. Context read
- Rules:
  - `server/CLAUDE.md` Conventions — routes будують сервіс через getter-и й лише викликають його (ratchet); `workspaceId` береться з `getContext`; нова таблиця = `schema/*.ts` + `schema.ts` + `db:generate`; валідація → 422 і envelope помилки; тести з `pg` → `*.it.test.ts`.
  - `reviewer-core/CLAUDE.md` — чистота ядра; untrusted лише через `wrapUntrusted()`; `exactOptionalPropertyTypes` (`?: T | undefined`).
  - `client/CLAUDE.md` — мережа лише через `api.ts` і hooks; ключі з `keys.ts`; `style={s.x}`; з `@devdigest/shared` імпортуємо тільки типи (тому `feature-models.ts` синхронізується вручну); без `onError`-тостів.
  - root `CLAUDE.md` — спочатку `vendor/shared` сервера, далі ручна копія в client.
- INSIGHTS applied:
  - `server/INSIGHTS.md` · 2026-10-04 «A JobRunner handler that makes a paid call must not throw» → handler пише помилку в рядок `pr_intent`; кидає лише 422 на битий payload.
  - `server/INSIGHTS.md` · 2026-09-28 «A job attempt that times out is never retried» + nuance 2026-10-04 → загальний бюджет derive ≤ 95 s при 120 s JobRunner.
  - `server/INSIGHTS.md` · 2026-10-04 «A routes plugin that awaits database work at registration» → reaper `pr_intent` у try/catch + warn.
  - `server/INSIGHTS.md` · 2026-10-04 «A module that needs another module's function gets it through a container method» → seam: `container.featureModel(ws,'review_intent')`, `container.intentService`.
  - `server/INSIGHTS.md` · 2026-10-04 «A pre-staged column can't simply be dropped» → `intent` не перейменовуємо (M1), лише `DROP NOT NULL`.
  - `server/INSIGHTS.md` · 2026-10-04 «A route's config.rateLimit is inert in every test» → 429 у тестах не перевіряємо.
  - `server/INSIGHTS.md` · 2026-10-04 «`MockLLMProvider fixture failed schema`» → `structuredBySchema` за schemaName.
  - `server/INSIGHTS.md` · 2026-10-04 «Settings leak the same way» → it-тест повертає `feature_models.review_intent` до default.
  - `server/INSIGHTS.md` · 2026-10-03 «The fake LLM anchors its finding on the first `+++ b/`» → у секції `## PR intent` і seed-intent немає `+++ b/`.
  - `server/INSIGHTS.md` · 2026-10-04 «`jobs.attempts` can't tell a retried job» → «не повторено» доводимо кількістю викликів моделі.
  - `server/INSIGHTS.md` · 2026-10-04 «`SkillImportUrlRequest`'s url() accepts…» → безпеку URL перевіряють парсер і adapter, не zod `.url()`.
  - `reviewer-core/INSIGHTS.md` · 2026-09-28 «`wrapUntrusted` escapes only…» (fixed) → тест на `</UNTRUSTED>` у summary.
  - `reviewer-core/INSIGHTS.md` · Open question 2026-10-04 «deepseek … max_tokens» → `INTENT_MAX_TOKENS` із запасом під reasoning (A1).
  - `client/INSIGHTS.md` · 2026-10-05 «Adding a key to `messages/en/<ns>.json` shifts every later citation» → нові ключі тільки в кінець `brief.json` / `prReview.json`.
  - `client/INSIGHTS.md` · 2026-10-04 «A mutation's `setQueryData` is enough to start a function `refetchInterval`» → POST пише 202-state у кеш.
  - `client/INSIGHTS.md` · 2026-10-04 «The vendored `Card` sets the `border` shorthand» → акцент робимо inset `boxShadow`.
  - `client/INSIGHTS.md` · 2026-10-04 «`EmptyState` always puts a `Plus`» → для стану none власний `Button`.
  - `client/INSIGHTS.md` · 2026-10-05 «The vendored `Markdown` renders raw HTML as text» → summary як plain text, без Markdown.
  - `INSIGHTS.md` · 2026-10-04 «A citation that names only a basename is ambiguous» + «remap each doc once» → цитати ремапимо один раз, в останньому кроці.
  - `INSIGHTS.md` · 2026-10-08 «`server/CLAUDE.md` is now 99 lines» → правила кладемо в specs/docs, root і server `CLAUDE.md` не чіпаємо.
  - `e2e/INSIGHTS.md` · 2026-09-23 «The seed writes PR #482's review … only when it creates the PR» → seed-intent поза `if (!pr)`, з `onConflictDoNothing`.
  - `e2e/INSIGHTS.md` · 2026-09-28 «`wait --text` sees rendered text» → нових e2e-асертів на SectionLabel не додаємо.
- Specs / docs: `server/specs/04-conventions.md` (формат нових спек), `e2e/specs/flows.md:195-223`, `docs/agent-prompts/README.md:39-52`, `reviewer-core/specs/grounding-and-scoring.md:186-189`.
- Skills read:
  - `postgresql-table-design` → Constraints, Indexing, Data Types, Safe Schema Evolution;
  - `security` → A01, A05, A06, A09 (Never log), Agentic AI;
  - `next-best-practices` не потрібен: нового сегмента немає, межа Server/Client не зсувається.

## 2. Decisions

**Архітектура**
- **D1 Новий модуль `server/src/modules/intent/`.** `IntentService` будується в `platform/container.ts` (getter `intentService`) з явних портів. Його отримують і `intent/routes.ts`, і `reviews/routes.ts` (`intent: container.intentService`): один екземпляр, одна реєстрація job-handler. Причина: reviews потрібна use-case «derive if missing», а `onion-no-cross-module` забороняє імпорт. Відхилено: окремий екземпляр у кожному routes, бо це вимагало б cross-module import.
- **D2 Класифікатор живе в сервері** (`intent/prompt.ts`, `intent/domain.ts`), як conventions. В engine лише рендер секції й відсів. Причина: `fixtureLlm` і `reviewPullRequest` знають одну схему, а CI-runner intent не потребує.
- **D3 JobRunner + власний статус у рядку `pr_intent`** (як conventions scan).
  - Payload `{ workspaceId, prId }` без ключа `repoId`. Тоді `repoOf` не зливає jobs різних PR і не серіалізує їх по репо (`server/src/platform/jobs.ts:42-45,98-112`).
  - JobRunner дає graceful shutdown, рядок `jobs` і спільну concurrency.
  - Від подвійного запуску захищає умовний upsert рядка.
  - Pre-work у `executeRuns` викликає той самий `derive` inline, без job: він уже стоїть у слоті review queue.
  - Відхилено: fire-and-forget без jobs (немає shutdown-обліку).
- **D4 Один рядок на PR.** Поля результату (`intent`, scopes, confidence, sources, missing_context, `head_sha`, `input_hash`, `derived_at`) — від останнього **успішного** визначення. `status`, `error`, `job_id`, `provider`, `model`, tokens, cost, `requested_at`, `finished_at` — від останньої **спроби**. Збій повторного визначення не стирає попередній intent.
- **D5 Staleness.**
  - `stale_reason = head_changed`, якщо `head_sha ≠ pull.head_sha`.
  - `stale_reason = description_changed`, якщо `input_hash ≠ sha256(normalize(title, body))`.
  - `input_hash = NULL` → не порівнюємо (seed не може імпортувати модуль через `onion-db-no-upward`).
  - Hash рахує service через `node:crypto`: domain не може імпортувати `node:*`, а цього модуля немає в `NODE_IO`. Нормалізацію робить domain.
- **D6 Відсів у reviewer-core (`src/scope.ts`)** між grounding і verdict/score.
  - Режим `tag-only`, якщо `stale || confidence==='low'`, інакше `filter`.
  - Без intent `out_of_scope` примусово стає `false`, бо модель могла вигадати поле.
  - Тай-брейк CRITICAL-сигналу: найвища confidence, далі перший за порядком.
- **D7 Позначка — поле `Finding.out_of_scope: boolean | null | undefined`** (nullish, як `suggestion`/`kind`, сумісне зі strict json_schema) і колонка `findings.out_of_scope boolean not null default false`. Відхилено: окремий список у Review, бо він не доходить до `FindingRecord`/UI. Модель **лише позначає**. Трастова інструкція повторює `INJECTION_GUARD` (`reviewer-core/src/prompt.ts:18-30` уже згадує «derived intent/scope»).
- **D8 Порядок секцій:** `## PR intent` одразу після `## PR description`, перед `## Skills / rules`, бо intent описує PR, а skills — це правила. Трастові рядки (інструкція, confidence, «may be outdated», «derived from indirect data» для `low`) — **поза** обгорткою. `summary`/`in_scope`/`out_of_scope` — у `wrapUntrusted('pr-intent', …)`.
- **D9 Pre-work вмикає config-прапорець `intentOnReview`** (env `DEVDIGEST_INTENT_ON_REVIEW`, default `true`). `server/vitest.config.ts` ставить `'false'`, бо `run-lifecycle.it.test.ts`/`reviews.it.test.ts` чекають, що перший openrouter-виклик — рев'ю (gated LLM, лічильники cost). Нові тести вмикають прапорець явно.
- **D10 Оновлення `body`.**
  - IntentService робить best-effort detail refresh сам: `github().getPullRequest` + `pulls.replaceDetail`. Порт структурно задовольняє `container.pullsRepo`, cross-module import не потрібен.
  - Ручний тригер оновлює завжди, pre-work — лише коли `body == null`.
  - Pre-work повертає оновлений `body`, і executor бере саме його як `prDescription`.

**Джерела даних і парсер посилань (domain `extractReferences`)**

Завжди:
- `title` (БД, ≤256) + `branch` (у тому ж блоці `pr-meta`, A2);
- `description` (БД після refresh, ≤4000; порожній → `skipped: empty`);
- `files` — outline з `UnifiedDiff.raw` через `DiffSource` (`container.prDiffs`, git або `pr_files.patch`): шлях +a/−d і рядки `@@ … @@ ctx` без тіл; ≤200 файлів, ≤20 hunk на файл, ≤8 000 символів.

Знайдені посилання (у title, body; Jira-ключі також у branch):

| Шаблон | kind | Звідки | Статус, якщо не вдалося |
|---|---|---|---|
| `#N`, `owner/repo#N`, `https://github.com/o/r/(issues\|pull)/N` | `issue` / `pull` | `GitHubClient.getIssue` (issues API повертає і PR) | `unavailable` (`not_found`/`forbidden`/`timeout`/`error`) |
| blob-URL **цього** repo або шлях `*.md\|mdx\|txt\|rst\|adoc` | `repo_file` | diff цього PR, якщо файл доданий повністю (hunk `@@ -0,0`) → беремо `+`-рядки; інакше `GitHubClient.getFileText(repo, path, head_sha)` | `unavailable` (`not_found`…) |
| blob-URL іншого repo | `repo_file` | — | `skipped` (`other_repo`) |
| `https://…` зі шляхом `.md/.markdown/.txt` | `url` | `UrlFetcher` (safe-fetch, ≤256 KB, HTML відхиляється) | `unavailable` (`blocked`/`too_large`/`unsupported_type`/…) |
| інші https-URL; `http://` | `url` | — | `skipped` (`unsupported_type` / `insecure`) |
| `[A-Z][A-Z0-9]{1,9}-\d+`, крім denylist (`SHA, UTF, ISO, RFC, CVE, HTTP, TLS, AES, UTC`); хости `*.atlassian.net`, `linear.app` | `ticket` | — (інтеграції немає, запит не робимо) | `unavailable` (`no_integration`) |

- **Ліміти:** fetch щонайбільше для 5 посилань (дублікати згортаються, решта `skipped`, `limit`); ≤6 000 символів на джерело (понад — `truncated`); усі зв'язані джерела разом ≤24 000 символів.
- **Статуси:** `used | unavailable | truncated | skipped`. `reason` — лише код зі списку, без тексту помилки.
- **`ref` санітизуємо:** `#12`, `acme/api#9`, `docs/plan.md`, `example.com/spec.md` (лише host+path, без query/fragment/userinfo), `PAY-12`.
- **Cap confidence** — правило A2. Кожне `unavailable` додається в `missing_context` як `"<ref>: <reason>"`.

**Послідовність викликів**
1. **Кнопка / ↻.**
   - `POST /pulls/:id/intent` → перевірка PR (404) → `model(ws)` → `store.claim`: один SQL-upsert за `pr_id`, умова — status ∉ queued/running. Якщо спроба вже активна, повертаємо стан як є.
   - `jobs.enqueue('pr-intent', {workspaceId, prId})`. Якщо enqueue кидає (503) → `store.fail` і rethrow.
   - `setJobId` → 202 зі state. Client пише state у кеш і опитує кожні 2 s.
2. **Job.**
   - `markRunning`; якщо рядка немає — no-op.
   - `derive`: refresh ≤15 s (`withTimeout`) → перечитати pull → diff → `extractReferences` → паралельний resolve (≤15 s на джерело) → `fileOutline`, `confidenceCap` → prompt → `completeStructured` (`AbortSignal.timeout(60 s)`, maxRetries 1, `maxTokens: INTENT_MAX_TOKENS`) → `finalizeIntent` → `store.complete` (за умови `status='running'`). Разом ≤95 s.
   - Будь-яка помилка → `store.fail` з usage; handler не кидає. Зовнішній I/O завжди поза транзакціями, кожен запис — один короткий statement.
3. **Pre-work у `executeRuns`** (після `Loading PR diff`, якщо `config.intentOnReview`): `runLog.step('Preparing PR intent', () => intent.forReview(ws, pull, { diff, log }))`.
   - є результат → повертаємо його з `stale`;
   - немає результату й немає активної спроби → claim + `derive` inline;
   - активна спроба без результату → `null`;
   - будь-яка помилка → `null` + log; рев'ю продовжується.
4. **Stale.** Збережений результат іде в рев'ю з `stale: true`, engine вмикає `tag-only`. Автоматичного re-derive немає.
5. **Boot.** Intent routes викликає `reapInterrupted()` (queued/running → failed `The API restarted…`) у try/catch.

## 3. Contracts & data

API (у `server/src/vendor/shared`, потім побайтна копія в `client/src/vendor/shared`):

| Method · path | Request | Response | Statuses · error codes |
|---|---|---|---|
| `GET /pulls/:id/intent` (`rateLimit: false`, бо його опитують) | — | `PrIntentState` | 200 · 404 `not_found` · 422 (params) |
| `POST /pulls/:id/intent` (`{max: 5, timeWindow: '1 minute'}`) | без body | `PrIntentState` (queued / running / активна спроба) | 202 · 404 `not_found` · 422 · 429 · 503 `shutting_down` |

Workspace-скоупінг: `getContext` → `pulls.pullInWorkspace(ws, prId)`. Кожен метод `IntentStore` фільтрує за `workspace_id`, тож PR чужого workspace дає 404.

Форми типів (snake_case):
- `Intent` (M1) — `{ summary: string; in_scope: string[]; out_of_scope: string[] }` (`contracts/brief.ts`; `PrBrief` отримує нову форму автоматично).
- `IntentConfidence = 'high'|'medium'|'low'`.
- `IntentSourceKind = 'title'|'description'|'files'|'issue'|'pull'|'repo_file'|'url'|'ticket'`.
- `IntentSourceStatus = 'used'|'unavailable'|'truncated'|'skipped'`.
- `IntentSource = { kind; ref: string; status; reason: string | null; chars: int }`.
- `ReviewIntentContext = Intent & { confidence: IntentConfidence; stale: boolean }` — вхід engine (`brief.ts`).
- `PrIntentRecord = Intent & { pr_id; confidence; sources: IntentSource[]; missing_context: string[]; head_sha: string|null; derived_at: string }` (`review-api.ts`, розширення наявного).
- `PrIntentStatus = 'none'|'queued'|'running'|'done'|'failed'`.
- `PrIntentState = { pr_id; status; error: string|null; stale: boolean; stale_reason: 'head_changed'|'description_changed'|null; intent: PrIntentRecord|null; provider|model: string|null; tokens_in|tokens_out: int|null; cost_usd: number|null; requested_at|finished_at: string|null }`.
- `PromptAssembly.intent: string|nullish` — уся відрендерена секція.
- `Finding.out_of_scope: boolean.nullish()` з `.describe(...)`; `FindingRecord` наслідує.
- `FEATURE_MODELS.review_intent` → `openrouter` / `openai/gpt-5.4-nano` (U2); `description` — підказка «дешева швидка модель, окремо від моделі рев'ю». Те саме в `client/src/lib/feature-models.ts`.
- `GitHubClient.getFileText(repo: RepoRef, path: string, ref: string): Promise<string | null>` (`adapters.ts`; null на 404/dir/binary).

Data model (`server/src/db/schema/reviews.ts`):

| Table | Column | Type | Null / default | Constraint | Index → query |
|---|---|---|---|---|---|
| `pr_intent` | `pr_id` | uuid | not null | PK, FK `pull_requests` ON DELETE CASCADE (є) | PK → кожне читання/upsert за PR |
| | `workspace_id` | uuid | not null | FK `workspaces` ON DELETE CASCADE | — (рядок на PR, читання завжди за PK + ws) |
| | `intent` (= summary, M1) | text | **null** (було not null) | — | — |
| | `in_scope`, `out_of_scope` | jsonb string[] | not null, `'[]'` (є) | — | — |
| | `status` | text | not null, `'done'` | CHECK in (queued,running,done,failed) | — (reaper на boot = seq scan) |
| | `error` | text | null | — | — |
| | `job_id` | uuid | null | без FK (як `convention_scans`) | — |
| | `confidence` | text | null | CHECK in (high,medium,low) | — |
| | `sources` | jsonb `IntentSource[]` | not null, `'[]'` | — | — |
| | `missing_context` | jsonb string[] | not null, `'[]'` | — | — |
| | `head_sha`, `input_hash` | text | null | — | — |
| | `provider`, `model` | text | null | — | — |
| | `tokens_in`, `tokens_out` | integer | null | — | — |
| | `cost_usd` | numeric (`mode: 'number'`) | null | — | — |
| | `requested_at` | timestamptz | not null, `now()` | — | — |
| | `finished_at`, `derived_at` | timestamptz | null | — | — |
| `findings` | `out_of_scope` | boolean | not null, `false` | — | — |

- «Результат є» ⇔ `intent IS NOT NULL`.
- **Migration: additive.** `ADD COLUMN`, `ALTER COLUMN intent DROP NOT NULL` (не `DROP COLUMN`), `ADD CONSTRAINT`. `pr_intent` порожня в кожній БД (writer-а і seed не було), тож `workspace_id NOT NULL` безпечний. Наявні `findings` отримують `false`. Генерує `pnpm db:generate`, DROP немає (`server/test/migrations-safety.test.ts`).
- Вартість intent — лише в `pr_intent.cost_usd`, ніколи в `agent_runs.cost_usd` (сума cost у PR list не змінюється).

Onion check — Intent Layer
```
  domain:  IntentClassification (LLM-схема), extractReferences, fileOutline, confidenceCap, finalizeIntent,
           normalizeIntentInput, intentFreshness (pure, без clock/node:*)
  ports:   IntentStore, IntentPullSource{pullInWorkspace, replaceDetail}, DiffSource, UrlFetcher-подібний
           IntentFetcher, JobQueue; reuse GitHubClient, LLMProvider, FeatureModelChoice
  service: state · requestDerive · runJob · forReview · reapInterrupted; load → decide → I/O → persist
  edges:   repository.ts (SQL, ws-scope), routes.ts (2 маршрути), octokit getFileText, safe-fetch userAgent
  wiring:  container getters intentRepo / intentUrlFetcher / intentService; modules/index.ts; reviews routes
  arch:    `pnpm arch` зелений, baseline не росте; ratchet без нових `container.x.y(`
```

## 4. Steps

### S1 — Контракти (обидві копії) і реєстр моделей · `server`, `client` · depends on: —
- Files:
  - modify `server/src/vendor/shared/contracts/{brief,review-api,findings,trace,platform}.ts`, потім ті самі файли в `client/src/vendor/shared/`;
  - modify `client/src/lib/feature-models.ts`;
  - modify `server/src/modules/reviews/repository/pull.repo.ts` і `server/src/modules/reviews/repository.ts` — видалити pre-staged `upsertIntent`/`getIntent`: викликачів у них немає, власником `pr_intent` стає intent-модуль;
  - modify `server/test/contracts.test.ts:78` (`summary`).
- Change: форми з §3, крім `getFileText` (він у S4).
- Skills: `zod` (implementer), `onion-architecture` → Ports.
- Hard rules: `onion/inner-imports-outer`.
- Insights: client «`src/vendor/shared/` has drifted» → після кроку `diff -r` має бути порожнім.
- Tests: existing `server/test/contracts.test.ts`.
- Test mode: implementer — це форми контрактів.
- Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/contracts.test.ts`; `cd client && pnpm typecheck`; `cd reviewer-core && npm run typecheck`; `diff -r server/src/vendor/shared client/src/vendor/shared` (порожньо).

### S2 — Схема і міграція · `server` · depends on: S1
- Files: modify `server/src/db/schema/reviews.ts` (`prIntent`, `findings.outOfScope`); згенерувати `src/db/migrations/0018_*.sql` через `pnpm db:generate`.
- Change: таблиця з §3; CHECK-імена за конвенцією `<table>_<col>_ck`.
- Skills: `postgresql-table-design` → Constraints, Safe Schema Evolution; `drizzle-orm-patterns` (implementer).
- Hard rules: —.
- Insights: server «A pre-staged column can't simply be dropped».
- Tests: existing `server/test/migrations-safety.test.ts`.
- Test mode: implementer — це DDL.
- Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/migrations-safety.test.ts`.

### S3 — Engine: секція intent і відсів поза scope · `reviewer-core` · depends on: S1
- Files:
  - modify `reviewer-core/src/prompt.ts`:
    - `PromptParts.intent?: ReviewIntentContext | undefined`;
    - `renderIntentSection(intent): string`;
    - `assembly.intent`;
    - ліміти: summary ≤500, ≤8 пунктів по ≤200 символів;
  - create `reviewer-core/src/scope.ts`: `applyIntentScope(findings: Finding[], intent?: ReviewIntentContext): { kept: Finding[]; dropped: {finding; reason}[]; mode: 'none'|'filter'|'tag-only' }`;
  - modify `reviewer-core/src/review/run.ts`:
    - `ReviewInput.intent?`;
    - intent → `promptParts`;
    - відсів після `groundFindings`, перед `verdictFromFindings`/`scoreFromFindings`;
    - `dropped` = grounding + scope;
    - подія `scope: …`;
  - modify `reviewer-core/src/index.ts` (експорт `applyIntentScope`).
- Change:
  - трастова інструкція: «set `out_of_scope` … report every real defect with its true severity; scope never lowers severity or removes a finding»;
  - stale → рядок «may be outdated»;
  - `low` → рядок «derived from indirect data (title, branch, changed files)» (A2).
- Skills: `onion-architecture` → reviewer-core; `security` → A05 (prompt injection).
- Hard rules: `core/impure`, `core/untrusted-unwrapped`, `core/grounding-bypass`.
- Insights: reviewer-core «`wrapUntrusted` escapes only…»; CLAUDE `exactOptionalPropertyTypes`.
- Tests:
  - add `reviewer-core/test/scope.test.ts`:
    - (1) без intent усе kept, `out_of_scope` скинуто в false, mode `none`;
    - (2) filter: WARNING/SUGGESTION поза scope → `dropped` з reason;
    - (3) три CRITICAL поза scope (0.6/0.9/0.9) → kept перший із 0.9, два dropped;
    - (4) stale → tag-only, усе kept, прапорці збережено;
    - (5) `low` → tag-only.
  - extend `reviewer-core/test/prompt.test.ts`:
    - `## PR intent` між `## PR description` і `## Skills / rules`;
    - зміст у `<untrusted source="pr-intent">`, інструкція поза ним;
    - `</UNTRUSTED>` у summary екранується;
    - `assembly.intent` = секція;
    - stale-рядок і `low`-рядок присутні;
    - зайві пункти обрізано;
    - без intent `messages` байт-ідентичні до варіанта без ключа, `assembly.intent === null`.
  - extend `reviewer-core/test/run.test.ts`:
    - лише WARNING поза scope → `approve`, score 100, `dropped` його містить;
    - CRITICAL-сигнал → `request_changes`;
    - без intent — як раніше.
  - **без змін і зелені:** `prompt.test.ts:25-38,99-101,141-150,167-173`, `run.test.ts:140-165`, `server/test/prompt-callers.test.ts`.
- Test mode: test-first (test-writer-backend) — правило U1 і рендер задаються як вхід → вихід.
- Verify: `cd reviewer-core && npm run typecheck && npx vitest run test/scope.test.ts test/prompt.test.ts test/run.test.ts`; `cd server && pnpm typecheck && pnpm exec vitest run test/prompt-callers.test.ts`.

### S4 — Адаптери: файл на ref і User-Agent · `server` · depends on: S1
- Files:
  - modify `server/src/vendor/shared/adapters.ts` + client-копія (`getFileText`);
  - `server/src/adapters/github/octokit.ts` (`repos.getContent` raw, 404 → null, `withRetry`/`withTimeout` як у `getIssue`);
  - `server/src/adapters/mocks.ts` (`MockGitHubClient.getFileText`, опції `files`, `issueErrors`);
  - `server/src/adapters/http/safe-fetch.ts` (`SafeFetchOptions.userAgent?`, default не змінюється).
- Skills: `onion-architecture` → Adapters; `security` → A05/SSRF.
- Hard rules: `onion/adapter-imports-core`.
- Tests: extend наявний octokit-тест (або подібний) для `getFileText` (404 → null); existing safe-fetch tests.
- Test mode: implementer — це обгортка SDK.
- Verify: `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`; `diff -r` порожній.

### S5 — Intent domain (pure) · `server` · depends on: S1
- Files:
  - create `server/src/modules/intent/domain.ts`: `IntentClassification` (zod: summary, in_scope, out_of_scope, confidence, missing_context) і функції з Onion check;
  - create `server/src/modules/intent/constants.ts`: ліміти, таймаути, `INTENT_SCHEMA_NAME`, `INTENT_JOB_KIND='pr-intent'`, **`INTENT_MAX_TOKENS=8000` (A1)**, rate limit; denylist ключів і tracker-хости живуть у `domain.ts`, бо вони потрібні правилам.
- Skills: `onion-architecture` → Domain; `security` → A05.
- Hard rules: `onion/inner-imports-outer`.
- Insights: server «`onion-domain-pure` lets domain import only…» → константи для правил лежать у `domain.ts`.
- Tests: add `server/test/intent-domain.test.ts` — кожен рядок таблиці джерел із §2:
  - шаблон → kind/status/reason;
  - query і userinfo вирізано з `ref`;
  - `SHA-256`, `UTF-8`, `CVE-2024-1` — не ключі;
  - ключ береться з branch;
  - дублікати згортаються;
  - 6-те посилання → `skipped limit`;
  - `src/x.ts` — не посилання.
  - `confidenceCap` — правило A2:
    - порожній опис без посилань → `low`;
    - порожній опис + отриманий issue → `high`;
    - опис без посилань → `medium`;
    - опис + unavailable → `medium`;
    - опис + усе отримано → `high`;
    - джерело `description` при порожньому описі → `skipped/empty`, `missing_context: []`.
  - `finalizeIntent`:
    - модель `high` при cap `medium` → `medium`;
    - модель `low` при cap `high` → `low`;
    - обрізання списків;
    - `missing_context` містить unavailable.
  - `fileOutline` — тільки шляхи й `@@`-рядки, ніколи `+`/`-` тіла; ліміти; truncated.
  - `intentFreshness` — head змінився / опис змінився / `input_hash` null / нема результату.
- Test mode: test-first (test-writer-backend) — чисті функції.
- Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/intent-domain.test.ts`.

### S6 — Intent service, ports, prompt · `server` · depends on: S4, S5
- Files: create `server/src/modules/intent/{ports,service,prompt,helpers}.ts`.
- Change:
  - `prompt.ts`:
    - трастовий system: роль; правило A2 «never answer unknown, never refuse; empty description → infer from title, branch, file/hunk outline, confidence low»; «не вигадуй змісту недоступних посилань → `missing_context`»; confidence enum; схема;
    - `pr-meta` — title + branch;
    - кожне джерело — окремий `wrapUntrusted('intent-<kind>-<i>', …)`;
    - повертає `{ messages, parts: {name, tokens}[] }` (`estimateTokens`).
  - `helpers.ts`: рядок → `PrIntentState`.
  - Сервіс — за §2 «Послідовність викликів».
  - Рівно один pino-рядок на класифікацію: `log.info({ prId, trigger, provider, model, prompt_parts, tokens_est, sources:[{kind, ref, status, reason, chars}], files, hunks, tokens_in, tokens_out, cost_usd, duration_ms, confidence, capped, outcome }, 'intent: classified')`.
  - Ніколи не логуємо: опис, вміст джерел, тексти hunk/diff, сирий вивід моделі, query URL, текст помилок fetch/octokit (лише reason-коди), ключі й токени.
- Skills: `onion-architecture` → Services, Ports; `security` → A05, A09, Agentic AI.
- Hard rules: `onion/service-takes-container`, `onion/inner-imports-outer`, `onion/io-in-transaction`, `core/untrusted-unwrapped`.
- Insights: server «A JobRunner handler that makes a paid call must not throw»; «So a handler's own abort must stay under… 120 s».
- Tests: add `server/test/intent-service.test.ts` (in-memory фейки портів + `MockLLMProvider structuredBySchema`):
  - ручний derive → done із sources і capped confidence;
  - **PR без опису й посилань → `done`, summary не порожній, `low`; промпт класифікатора містить title, branch і outline файлів, але не містить жодного `+`/`-` рядка diff (A2)**;
  - unavailable issue → `missing_context`, confidence ≤ medium;
  - помилка LLM → `failed`, попередній intent збережено, `runJob` не кидає (1 виклик моделі);
  - битий payload → 422;
  - `forReview`: fresh / stale / нема (inline derive) / помилка → null;
  - pino-рядок не містить тексту опису, тіла джерела, `+`-рядка diff і `?token=`.
- Test mode: test-first (test-writer-backend) — правила use-case формулюються на портах до коду.
- Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/intent-service.test.ts`.

### S7 — Repository, routes, wiring · `server` · depends on: S2, S6
- Files:
  - create `server/src/modules/intent/{repository,routes}.ts`;
  - modify `server/src/modules/index.ts` (`intent`);
  - modify `server/src/platform/container.ts`: `intentRepo`; `intentUrlFetcher` = override `urlFetcher` ?? `SafeHttpsFetcher({ userAgent: 'DevDigest-Intent/1.0' })`; `intentService`.
- Change:
  - repository: `claim` (upsert ON CONFLICT pr_id … WHERE status ∉ active, returning), `markRunning`, `complete`, `fail`, `reapActive`, `get` — усі з `workspace_id`, крім reaper;
  - routes: схеми з §3, 202, `registerJobHandler(app.log)` + reaper у try/catch.
- Skills: `onion-architecture` → Routes, Persistence; `fastify-best-practices`, `drizzle-orm-patterns` (implementer); `security` → A01, A06.
- Hard rules: `onion/route-no-sql`, `server/missing-workspace-scope`, `server/hand-parsed-body`, `onion/multi-write-not-atomic`, `server/pg-test-not-it`.
- Insights: server «registration-time DB work»; «rateLimit is inert in every test».
- Tests: add `server/test/intent.it.test.ts`:
  - GET невідомого або чужого PR → 404 `not_found`;
  - GET без рядка → 200 `status:'none'`;
  - POST → 202, після `jobs.onIdle()` → `done` + record + cost у рядку;
  - повторний POST під час активної спроби → 202 той самий стан, 1 виклик моделі;
  - два PR одного repo → обидва `done`;
  - без ключа → `failed`, 0 повторів;
  - `body=null` → `MockGitHub.getPullRequest` оновив опис;
  - `feature_models` відновлюється наприкінці;
  - existing `test/routes-container-ratchet.test.ts`.
- Test mode: test-first (test-writer-backend) — статуси й коди API відомі заздалегідь.
- Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/routes-container-ratchet.test.ts && pnpm test:it` (Docker).

### S8 — Інтеграція в рев'ю · `server` · depends on: S3, S7
- Files:
  - modify `server/src/modules/reviews/{ports,domain,run-executor,routes,helpers}.ts` — порт `IntentProvider.forReview`, pre-work крок, `intent` → `reviewPullRequest`, `prDescription = body` з pre-work, `findingRowToDto.out_of_scope`;
  - `reviews/repository/review.repo.ts` (`insertFindings` пише `outOfScope`);
  - `server/src/platform/config.ts` (`intentOnReview`);
  - `server/vitest.config.ts` (`DEVDIGEST_INTENT_ON_REVIEW: 'false'`).
- Change: RunLogger пише `intent: <mode> (confidence=…, stale=…, sources used/unavailable)` без тексту intent; `trace.prompt_assembly.intent` приходить з engine.
- Skills: `onion-architecture` → Services; `security` → A09.
- Hard rules: `server/cross-module-repository`, `onion/inner-imports-outer`, `onion/route-no-sql`.
- Tests: add `server/test/intent-review.it.test.ts` (прапорець увімкнено):
  - PR без intent → intent визначено до агентів; user-prompt містить `## PR intent`; `agent_runs.cost_usd` — лише рев'ю;
  - stale intent → без derive; WARNING поза scope лишається з `out_of_scope: true` у `GET /pulls/:id/reviews`;
  - fresh `medium` → WARNING поза scope відсіяно;
  - збій intent → рев'ю `done`;
  - existing `test/reviews.it.test.ts`, `test/run-lifecycle.it.test.ts` — без змін.
- Test mode: implementer — це wiring, поведінку видно лише разом.
- Verify: `cd server && pnpm typecheck && pnpm test:it`.

### S9 — Seed #482, fake LLM, contract-тест · `server` · depends on: S7
- Files:
  - modify `server/src/db/seed.ts` — `seedDemoIntent` одним рядком перед `return` у `seed()`, сама функція після останнього масиву patch; idempotent `onConflictDoNothing`:
    - зміст із макета: summary про rate limiting `/api/public/*` і 429 + Retry-After; out_of_scope — auth, нові endpoints, логування;
    - `confidence 'medium'`; sources title/description/files `used`;
    - `head_sha 'a1b2c3d4e5f6'`, `input_hash NULL`;
    - без `+++ b/`;
  - modify `server/src/adapters/llm/fake.ts` — віддати першу з фікстур (review, детермінований intent), яку приймає `req.schema`, без імпорту з модулів;
  - modify `server/test/fake-llm.test.ts`, `server/test/api-contracts.it.test.ts` (`PrIntentState` для #482).
- Skills: `onion-architecture` → Adapters; `drizzle-orm-patterns`.
- Hard rules: `onion/adapter-imports-core`.
- Insights: e2e «The seed writes PR #482's review … only when it creates the PR»; server «The fake LLM anchors…».
- Tests: як у Files.
- Test mode: implementer — це дані й fixture.
- Verify: `cd server && pnpm typecheck && pnpm exec vitest run test/fake-llm.test.ts && pnpm test:it`. Dev DB `pnpm db:migrate && pnpm db:seed` виконує головна сесія, нічого не стираючи.

### S10 — Client data layer · `client` · depends on: S1
- Files:
  - modify `client/src/lib/hooks/keys.ts` (`prKeys.intent(prId) = ["pr", prId, "intent"]`);
  - create `client/src/lib/intent.ts` (`isIntentActive(status)`);
  - create `client/src/lib/hooks/intent.ts`:
    - `usePrIntent(prId)` — GET, `refetchInterval` 2000, поки статус активний;
    - `useDeriveIntent()` — POST → `setQueryData(prKeys.intent(prId), data)`;
  - modify `client/src/lib/hooks/index.ts` (+1 рядок у barrel, якщо barrel є).
- Change: `api.ts` без змін; інвалідація `prKeys.all` після run (`reviews.ts:54,67`) уже оновлює intent.
- Skills: `frontend-ui-architecture` → Data layer; `react-best-practices`.
- Hard rules: `ui/component-fetch`, `ui/server-data-in-state`.
- Insights: client «setQueryData is enough to start a function refetchInterval»; «fake timers lag».
- Tests: add `client/src/lib/hooks/intent.test.tsx` (mock `api.ts`, справжній `QueryClient`) — polling у queued/running, зупинка на done; POST пише кеш.
- Test mode: implementer — шаблон conventions-хуків.
- Verify: `cd client && pnpm typecheck && pnpm exec vitest run intent.test`.

### S11 — IntentCard, Overview, бейдж на FindingCard · `client` · depends on: S10
- Files:
  - create `…/pulls/[number]/_components/IntentCard/{IntentCard.tsx,index.ts,styles.ts,helpers.ts,constants.ts,IntentCard.test.tsx}`;
  - modify `_components/OverviewTab/OverviewTab.tsx` — `prId` prop, викликає hooks, рендерить `IntentCard` над Description;
  - modify `_components/PrDetailView/PrDetailView.tsx:92` — передає `prId`;
  - modify `_components/FindingCard/{FindingCard.tsx,styles.ts}` — бейдж, якщо `f.out_of_scope`;
  - modify `client/messages/en/brief.json` (новий `intent.*` у кінці) і `client/messages/en/prReview.json` (новий `scope.outOfScope` у кінці).
- Change: IntentCard презентаційна, пропси `{ state, loading, onDerive, deriving }`. Стани:
  - **none** — власний `Button` «Derive intent»;
  - **queued/running** — `Skeleton` і «Deriving…», попередній intent лишається видимим;
  - **done** — summary-цитата plain text; колонки IN SCOPE / OUT OF SCOPE; бейдж confidence. При `low` — підказка A2. Рядок джерел: unavailable позначено `XCircle`/muted, `missing_context` у тому ж рядку. ↻ — `IconBtn` `RefreshCw`, label «Re-derive intent»;
  - **failed** — помилка і ↻;
  - **stale** — банер `AlertTriangle` і ↻.

  Заголовок — `SectionLabel icon="Target"` з `brief.block.intent`. Іконки лише з наявного реєстру.
- Skills: `frontend-ui-architecture` → Components, Placement; `react-best-practices`; `next-best-practices` (`"use client"`); `react-testing-library` (suppress: mock `fetch`).
- Hard rules: `ui/sibling-import`, `ui/component-inside-component`, `ui/component-fetch`.
- Insights: client — Card border, EmptyState Plus, Markdown raw HTML, ключі в кінець.
- Tests:
  - `IntentCard.test.tsx` — кожен стан; unavailable позначено; ↻ і Derive викликають `onDerive`; банер stale; бейдж confidence і підказка `low`;
  - extend `FindingCard.test.tsx` — бейдж лише при `out_of_scope`.
- Test mode: implementer — це UI-композиція.
- Verify: `cd client && pnpm typecheck && pnpm exec vitest run IntentCard.test FindingCard.test`.

### S12 — Документи · docs (doc-writer) · depends on: S1–S11
- Files:
  - create `server/specs/06-intent-layer.md` і `client/specs/06-intent-layer.md` (формат `04-conventions.md`, з **Unchanged** повними шляхами);
  - modify:
    - `reviewer-core/specs/grounding-and-scoring.md` — відсів до score/verdict;
    - `docs/agent-prompts/README.md:39-52` — +`## PR intent`, «How the engine uses the output»;
    - `docs/agent-prompts/choosing-a-model.md` — `review_intent`;
    - `server/README.md` — API map і env `DEVDIGEST_INTENT_ON_REVIEW`;
    - `server/specs/review-flow.md` — pre-work;
    - `server/docs/architecture.md` — getters;
    - `client/specs/pages.md:90` — Overview;
    - `client/docs/ui-architecture.md` — таблиця hooks;
    - `e2e/specs/flows.md` — ремап цитат `seed.ts` і `prReview.json`;
  - запропонувати рядок у Gotchas `reviewer-core/CLAUDE.md` (лише додати; `grounding-and-scoring.md:186-189`).
- Test mode: — — це документи.
- Verify: кожна змінена цитата `file:line` вказує на правильний рядок; root і `server/CLAUDE.md` не змінені.

## 5. Skill map
| Path in this plan | Skills (routing.json) | Precedence / suppress |
|---|---|---|
| `server/src/vendor/shared/**` | zod | contract change; client-копія не маршрутизується |
| `server/src/db/schema/reviews.ts` | onion, drizzle, postgresql-table-design, security | `server/CLAUDE.md` > onion |
| `server/src/modules/intent/{domain,ports,service,prompt,helpers,constants}.ts` | onion, security, zod (trigger) | onion > fastify (suppress DI через декоратори) |
| `server/src/modules/intent/repository.ts`, `reviews/repository/*.repo.ts` | onion, drizzle, security | — |
| `server/src/modules/{intent,reviews}/routes.ts`, `platform/{container,config}.ts` | onion, fastify, security | suppress: no-auth loopback |
| `server/src/adapters/**` | onion, security | suppress: fake keys у mocks |
| `reviewer-core/src/**` | onion, security, zod (trigger) | `reviewer-core/CLAUDE.md` перший |
| `server/test/**`, `reviewer-core/test/**` | onion | — |
| `client/src/lib/{intent.ts,hooks/*.ts}` | frontend-ui-architecture, react-best-practices, security | suppress: Axios/useApiQuery |
| `client/src/app/**/IntentCard/*.tsx`, `OverviewTab`, `FindingCard`, `PrDetailView` | frontend-ui-architecture, react-best-practices, next-best-practices, security | suppress: Tailwind |
| `client/**/*.test.tsx` | react-testing-library | suppress: mocking `fetch` |

## 6. Final verification
- implementer:
  - `cd reviewer-core && npm test && npm run typecheck`;
  - `cd server && pnpm typecheck && pnpm test` (Docker);
  - `cd client && pnpm typecheck && pnpm test`;
  - `diff -r server/src/vendor/shared client/src/vendor/shared`.
- caller / reviewers:
  - `cd server && pnpm arch && pnpm arch:stale`;
  - `node .claude/skills/onion-architecture/scripts/baseline-diff.mjs $(git merge-base origin/main HEAD)` → added 0;
  - `pnpm lint` (server, client);
  - `cd e2e && npm run e2e:hermetic` — flows 02/04/05/09, копія з `e2e/specs/flows.md:195-223` не змінюється;
  - live на dev API: 429 на POST і справжній виклик `openai/gpt-5.4-nano`.

## 7. Out of scope / Unchanged
- `client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx` — слот `intent` у drawer не рендеримо (UI = макет; повний user-prompt і так видно).
- Risk areas, Blast radius, PR Brief verdict card, Review focus, Smart Diff (U4, L04–L05).
- `server/src/adapters/git/diff-parser.ts` — outline будується з `diff.raw`, парсер не змінюється.
- `server/src/adapters/github/octokit.ts` `resolveLinkedIssue` — поведінка без змін.
- `reviewer-core/src/llm/openrouter.ts` — без `provider.require_parameters` і без `reasoning` (Q1).
- `CLAUDE.md`, `server/CLAUDE.md`, `client/src/vendor/ui/**`, lockfiles, ручні правки `server/src/db/migrations/**`, `server/src/modules/repo-intel/**`.
- `e2e/specs/*.flow.json` — flows не змінюємо.

## 8. Open questions · Research needed
- **Q1** (не блокує) `reviewer-core/src/llm/openrouter.ts:89-104` не надсилає `provider.require_parameters`. Додавати його для всіх structured-викликів (зачепить і рев'ю, і conventions) — окремою задачею; у цьому плані — ні.
- **R2** (не блокує) octokit 4: `rest.repos.getContent({ mediaType: { format: 'raw' } })` — implementer звіряє з типами в `node_modules` і поведінкою на каталозі чи submodule (null).
- Уточнення planner: golden-тести `prompt.test.ts:25-38…`, `run.test.ts:158,160`, `prompt-callers.test.ts:33-39` **не** зламаються, бо наявні секції не змінюються, а без intent промпт байт-ідентичний.

## 9. Review hand-off
- **Architecture:**
  - новий модуль `intent` (domain/ports/service/prompt/repository/routes);
  - container будує `IntentService` з портів (D1) — для репо це нове, звірити з onion → Wiring;
  - reviews отримує intent через порт `IntentProvider` (`container.intentService`);
  - кожен запис — один statement;
  - зовнішній I/O (GitHub, safe-fetch, LLM) завжди поза записами в БД;
  - job-payload без `repoId`.
- **Security:**
  - untrusted опис/тікети/файли/URL → окремі `wrapUntrusted`-блоки; intent у промпті рев'юера теж обгорнутий;
  - injection-«descope» обмежує U1: модель лише позначає, CRITICAL лишає сигнал, stale/low → tag-only;
  - SSRF і трекінг: лише https і лише `.md/.txt`, ≤5 посилань, safe-fetch (приватні адреси блоковані, кожен redirect перевіряється), tracker-хости без запиту, UA `DevDigest-Intent/1.0`;
  - у логах лише санітизований `ref` і reason-коди;
  - нові endpoints скоуплені за workspace, POST обмежений 5/хв;
  - вартість: `max_tokens` 8000, таймаути, cost у `pr_intent`;
  - дрейф копій `vendor/shared` — `diff -r`.
- **Test-first:**
  - S3 (test-writer-backend): `reviewer-core/test/scope.test.ts`, `prompt.test.ts`, `run.test.ts`;
  - S5: `server/test/intent-domain.test.ts`;
  - S6: `server/test/intent-service.test.ts`;
  - S7: `server/test/intent.it.test.ts`.
- **Docs:** весь S12 (doc-writer) + пропозиція рядка в `reviewer-core/CLAUDE.md` Gotchas.

## Хід виконання

0. ✓ План і research збережено в `docs/plans/` (2026-10-09).
1. test-writer-backend (`test-first`) пише тести для S3, S5, S6, S7.
2. implementer — S1–S11.
3. plan-verifier ∥ architecture-reviewer, потім цикл виправлень.
4. doc-writer — S12.
5. Dev DB: `pnpm db:migrate && pnpm db:seed`.
6. Перевірки: arch, lint, e2e hermetic, live-виклик.
7. INSIGHTS.
8. Звіт; без коміту.

## Нотатка виконання (2026-10-09)

- **Test-first** (test-writer-backend ×2, Sonnet): S3 — 10 тестів червоні до коду; S5–S7 — три файли червоні, бо модуля ще не було.
- **implementer** (Sonnet): S1–S9, потім окремим прогоном S10–S11. Відхилення:
  - `MockGitHubClient.getIssue` за замовчуванням повертає 404, а потрібні issue задаються опцією `issues`, а не `issueErrors`;
  - загальна межа — 20 унікальних посилань;
  - тип `log` у Container отримав необов'язковий `info`.
- **Головна сесія:**
  - тип хелпера в `server/test/intent-domain.test.ts` (`ref: string`) — правка лише типу, assertions не змінено;
  - формат рядка RunLogger у pre-work (`intent: <mode> (confidence=…, stale=…, sources N used / M unavailable; …)`), бо plan-verifier позначив S8 як partial;
  - доведення `IntentCard` до макета за скриншотом: ✓/✕ у заголовках колонок, маркери пунктів, курсивна цитата;
  - `docs/agent-prompts/README.md` і `choosing-a-model.md`, бо doc-writer не має права писати `docs/agent-prompts/**`;
  - рядок у Gotchas `reviewer-core/CLAUDE.md` (лише вставка);
  - коментар у `server/src/modules/index.ts`.
- **plan-verifier:** GAPS — 38 met, лише S8 partial (виправлено). **architecture-reviewer** (Opus): APPROVE, знахідок немає. Відкрите питання від нього: `owner/repo#N` читає issue з будь-якого репо, яке бачить токен. Записано в server INSIGHTS → Open questions.
- **doc-writer:**
  - створено `server/specs/06-intent-layer.md` і `client/specs/06-intent-layer.md`;
  - оновлено `grounding-and-scoring.md` (X1–X3), `review-flow.md` (R7a), `server/README.md`, `server/docs/architecture.md`, `client/specs/pages.md`, `client/docs/ui-architecture.md`;
  - виправлено цитати в `e2e/specs/flows.md`.
- **Dev DB:** `0018` застосовано, seed додав intent для #482.
- **Живий виклик** на #483: `done` за ~3 s, 714 → 112 токенів, $0.00028.
- **Перевірки:**
  - reviewer-core 78, server 651, client 336 тестів;
  - typecheck у всіх трьох пакетах;
  - `pnpm arch` 0, baseline added 0, lint 1 warning;
  - `e2e:hermetic` 9/9;
  - `diff -r` копій vendor/shared порожній.
