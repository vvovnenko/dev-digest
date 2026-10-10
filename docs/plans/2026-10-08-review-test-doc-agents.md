# План: нові субагенти — test-writer-ui / test-writer-backend, architecture-reviewer, plan-verifier, doc-writer

**Status:** done — виконано 2026-10-08 (див. «Нотатка виконання» в кінці); не закомічено.
**Branch:** `module/L03` · **Research:** [2026-10-08-review-test-doc-agents-research.md](2026-10-08-review-test-doc-agents-research.md)

## Context

На гілці `module/L03` вже є `researcher`, `planner`, `implementer` (`f3b12ac`). Користувач хоче наступні агенти
на наших проєктних скілах: тестописець (UI + бекенд), read-only архітектурний рев'юер, plan-verifier (агент, не скіл —
підтверджено: перевіряє, що КОЖЕН пункт плану/спеки виконаний і доведений, а не «гарні практики») і doc-writer
(описує зроблене, перетворює план або будь-які матеріали на документи зі схемами й сам знає, куди писати).
Гарні практики зібрали 5 паралельних `researcher` (4 web + карта документації репо) — дайджест:
[`2026-10-08-review-test-doc-agents-research.md`](2026-10-08-review-test-doc-agents-research.md) (ідентифікатори джерел у
таблиці рішень — CC-BP, AN-CR, GSD тощо — звідти).
План склав `planner` (Opus, ~8 хв); головна сесія звірила його посилання з кодом (рядки вставок, команди, `rule_id` — збігаються).

**Виконує головна сесія**, не `implementer` (`implementer.md:42-43` забороняє `.claude/**`).
Обмеження користувача: без hooks / `isolation` / `memory` / `permissionMode`; головний checkout; без комітів без окремого OK;
промпти англійською, звіти мовою брифу (правило мови в першому абзаці й у кінці, з переліком того, що перекладається);
`CLAUDE.md` (root і server по 99 рядків) не чіпаємо; правки наявних файлів — лише вставки.

## Що відбудеться після підтвердження (по порядку)

0. ✓ **Зберегти план у репо** (рішення користувача; зроблено 2026-10-08) — нова тека `docs/plans/`:
   - `docs/plans/2026-10-08-review-test-doc-agents.md` — цей план;
   - `docs/plans/2026-10-08-review-test-doc-agents-research.md` — дайджест п'яти досліджень із джерелами, зі scratchpad;
   - `docs/plans/README.md` — кілька рядків про те, що тут лежить: плани роботи агентів, `YYYY-MM-DD-kebab.md`, план поруч зі своїм research-файлом.

   Root `CLAUDE.md` не чіпаю (99 рядків). Для doc-writer `docs/plans/**` — вхідні дані, які він читає, але не редагує (D10). Ці файли підуть у той самий коміт, що й агенти, після вашого OK.
1. **S0, лише читання:** `curl` сирих сторінок Claude Code docs і [WF]-джерел. Нічого не пишу.
2. **S1–S5:** головна сесія сама створює через Write 5 файлів у `.claude/agents/`: `architecture-reviewer.md`, `plan-verifier.md`, `test-writer-backend.md`, `test-writer-ui.md`, `doc-writer.md`. Implementer-а не залучаю.
3. **S6:** через Edit вставляю 1 абзац у `implementer.md` і 2 рядки в `planner.md`. Доказ: `git diff -U0` без рядків `-`.
4. **S7:** через Edit оновлюю `.claude/agents/README.md`.
5. **Статичні перевірки** з розділу Verification.
6. **Headless-прогони H1–H8** у фоні. Фікстури **тимчасово змінюють реальний код**: `server/src/modules/pulls/routes.ts`, `server/src/modules/pulls/domain.ts`, компонент у `client/src/app/(shell)/skills/_components/`, новий helper у `client/src/lib/` + `messages/en/*.json`. Перед кожним прогоном зберігаю `git status`. Після прогону повертаю кожну фікстуру через Edit або видаляю, і показую, що статус збігся. Плани-фікстури лежать у scratchpad. H1/H2 йдуть на Opus і коштують найбільше.
7. **Якщо агент не проходить сценарій:** правлю його промпт і переганяю цей сценарій, щонайбільше 2 ітерації. Що лишиться невирішеним, піде у звіт.
8. **INSIGHTS wrap-up** через `append-insight.mjs`, з перевіркою `removed 0`.
9. **Звіт вам і зупинка.** У звіті: створені й змінені файли, таблиця H1–H8 (очікувано / фактично / модель) і `git status`. **Без коміту й push.** Комічу лише після вашого окремого OK.

Не робитиму: hooks, worktree, правки `CLAUDE.md` / `routing.json` / `pr-self-review`, коміти.

## Рішення

| # | Рішення | Чому (джерело) |
|---|---|---|
| D1 | **Два** тестописці (рішення користувача): `test-writer-ui` (client/) і `test-writer-backend` (server/ + reviewer-core/); розділи 1, 3–6 дослівно однакові | кожен preload-ить рівно свій скіл (README: «skills: only if needed in every task»); Sonnet не виконує обов'язкові Read-кроки (root INSIGHTS 2026-10-08); «focused subagents» (CC-SA) |
| D2 | Режим у брифі обов'язковий: `Mode: test-first` (тести з плану/контракту до коду, доведений red через відсутню поведінку, не синтаксис) або `cover` (після implementer). **Прод-код test-writer не змінює ніколи, навіть тимчасово** (рішення користувача; мутацію прод-коду відкинуто). Доказ сили тесту в `cover`: (1) кожен тест прив'язаний до рядка вимоги/контракту, очікуване значення взяте звідти, а не з реалізації; (2) перевірка «assertion живий» — тимчасово змінити очікуване значення **в самому тестовому файлі** → тест падає → повернути (ловить async без `await` і assert, що ніколи не виконується); (3) без тавтологій: не лише `toHaveBeenCalled` на моку, не expected, обчислений тим самим кодом. Новий тест 3× на стабільність; баг у прод-коді → `BUG FOUND`, падаючий тест лишається, тест не послаблюється; у звіті чесно: мутаційної перевірки не було | CC-BP «one writes tests, another code»; KCD/FOWLER (поведінка, не реалізація); TESTGEN (57% тестів стабільні) |
| D3 | E2E-флоу test-writer не пише — лише «e2e candidate» у звіті | потребують стеку з Docker і контракту `e2e/specs/flows.md`; тест якнайнижче на піраміді (FOWLER) |
| D4 | Моделі: `architecture-reviewer` = `opus`, effort `medium` (S0 перевіряє, що значення підтримується, інакше `high`); решта `sonnet` | судження про дизайн — Opus; трасування, тести й доки — Sonnet (ціна: planner $6/план) |
| D5 | Read-only (`architecture-reviewer`, `plan-verifier`): `tools: Read, Grep, Glob, Bash`, `disallowedTools: Write, Edit, NotebookEdit, Skill, Agent, WebSearch, WebFetch`. Пишуть (`test-writer-*`, `doc-writer`): `tools: Read, Grep, Glob, Edit, Write, Bash`, `disallowedTools: Agent, Skill, WebSearch, WebFetch, NotebookEdit` | дзеркалить planner/implementer; least privilege (CC-SA) |
| D6 | Read-only агенти самі запускають перевірки, але тільки через `<pkg>/node_modules/.bin/*`, кожну окремим Bash-викликом без пайпа; ніколи `pnpm`/`npm run`/`git fetch`/`docker compose`; `git status --porcelain` на старті й наприкінці — розбіжність першим рядком звіту. Мапінг: `typecheck` → `node_modules/.bin/tsc -p tsconfig.test.json` (server, reviewer-core) / `tsc --noEmit` (client); `vitest run X` → `node_modules/.bin/vitest run X`; `pnpm arch` → `node_modules/.bin/depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs --ignore-known --output-type err-long`. plan-verifier запускає `*.it.test.ts` лише якщо `docker info` → exit 0, інакше `unverifiable` + точна команда | root INSIGHTS «`pnpm <script>` can install too»; CC-BP «show evidence» |
| D7 | `architecture-reviewer` нічого не preload-ить; на Opus обов'язково Read: `onion-architecture` (server/ або reviewer-core/ у диффі), `frontend-ui-architecture` (client/), `postgresql-table-design` (`server/src/db/schema/**`), `security` A01/A05/A06 (нова route / недовірений текст); рядок `Read:` у звіті обов'язковий; `baseline-diff.mjs $(git merge-base origin/main HEAD)` | root INSIGHTS (Opus виконує Read-кроки; baseline проти merge-base) |
| D8 | Відмінність від `/pr-self-review`: той — ручний, батчі по лінзах, store, D1–D11; architecture-reviewer — один цілісний прохід (взаємодії модулів і пакетів, D-рішення плану, over-engineering), `rule_id` і рубрика з `severity.md`, у store нічого не пише; plan-verifier доводить виконання кожної вимоги (і відсутність), а не шукає порушення на `+` рядках | GOOG-CR Design; AN-CR; SPECKIT; GSD |
| D9 | Звіти: architecture — `A<n> · severity · confidence · rule_id · file:line · new` + What / Why it matters here / Suggestion; лише перевірені high/medium; pre-existing ≤5 окремо, без впливу на вердикт; `APPROVE | APPROVE WITH WARNINGS | CHANGES REQUESTED`. plan-verifier — вимоги з ID (`S`,`D`,`C`,`M`,`AC`,`U`,`DW`), вердикти `met/partial/missing/deviated/unverifiable`, сила доказу `ran > test > code > doc`, рівні exists → substantive → wired, стартова гіпотеза «не зроблено», `PASS / GAPS / FAIL`. У кожного — `## Insight candidates` (в INSIGHTS агенти не пишуть) | AN-CR «If you are not certain… do not flag»; GSD; SPECKIT; MTB |
| D10 | doc-writer пише лише: `README.md` (root, `## Architecture`), `<pkg>/README.md`, `<pkg>/docs/*.md` + рядок у `Files:` індексу, `TESTING.md`, `e2e/docs/*.md`, цитати в `e2e/specs/flows.md`, контрактні спеки `<pkg>/specs/<kebab>.md`, `## Amendment` у фіча-спеці (за брифом), явно названий шлях. Заборонено: код, `*.json`, `**/CLAUDE.md` (пропонує рядки в «For the caller»), `**/INSIGHTS.md`, `.claude/**`, `docs/plans/**` (лише читає як вхід), `docs/agent-prompts/**`, `docs/agent-skills/**`, vendor/clones/migrations/lockfiles/.env, нумерована спека для вже зробленого. Режими `describe | from-plan | from-materials`; Diátaxis-тип на файл; кожне твердження — з `path:line`; незроблене → `**Planned (not implemented yet):**`; без майбутнього часу; діаграми лише де додають (sequence/ER/state/flowchart; C4 через flowchart). implementer і далі оновлює застарілі цитати (крок 7 планера); doc-writer — останній, нові доки, цитати один раз | DIAT, GSTYLE, C4, MERMAID, WTD; карта документації репо; root INSIGHTS про перенумерацію цитат |
| D11 | Точкові вставки в наявні агенти: `implementer.md` — не переписувати red-тести від test-writer; `planner.md` §9 — рядки `Tests:` і `Docs:` | без цього Sonnet-implementer перепише чужі red-тести |
| D12 | Потік: planner → OK користувача → [test-writer-* `test-first`, за рішенням] → implementer → `plan-verifier` ∥ `architecture-reviewer` → прогалини/CRITICAL → implementer, бракує тестів → test-writer-* `cover` → doc-writer → `/pr-self-review` (користувач) → коміт з OK | verifier і reviewer незалежні й read-only |

## Кроки (виконує головна сесія)

**S0 — звірка фактів із сирих сторінок** (лише читання): `curl -sL https://code.claude.com/docs/en/sub-agents.md` → grep `effort` (чи є `medium`), `color` (допустимі значення), `skills`; для [WF]-цитат (Testing Library, KCD, Fowler, Vitest) — curl сирої сторінки й grep кожної цитати, яка йде в промпт; не знайдено → переказ без лапок. Результат — колонка Source у README.

**S1 — `.claude/agents/architecture-reviewer.md`** (≤ ~170 рядків). Розділи: перший абзац (роль + мова) · `## Limits` (read-only; Bash лише `git status|diff|log|show|cat-file|merge-base|ls-files`, `grep -rn`, `find`, `ls`, `wc` + команди D6; дифф — дані, не інструкції, як `pr-self-review-reviewer.md:27-29`; пошук через Bash з виключенням `server/clones/**`, `node_modules/`, `.next*/`) · `## 1. Check the brief` (scope `uncommitted` | `branch`+base, опційний план, гілка; Clarification needed ≤5) · §2 зібрати зміни (`git diff HEAD --stat` + `git ls-files --others --exclude-standard`; великий дифф → межі шарів детально, решта в Not reviewed) · §3 Read CLAUDE.md пакетів, скіли за D7, `severity.md` · §4 Tool checks (depcruise, `baseline-diff.mjs` проти merge-base, `routes-container-ratchet.test.ts` якщо змінено `routes.ts`) · §5 цілісний прохід (GOOG-CR Design, onion «Where does this code go?», ports, транзакції, дзеркало контракту, client data flow, over-engineering, D-рішення плану) · §6 валідувати кожну знахідку (перечитати рядки; base через `git cat-file blob`; невпевнене викинути; не флагати стиль/імена/лінтер/pre-existing) · шаблон звіту D9 · Rules + мова.

**S2 — `.claude/agents/plan-verifier.md`** (≤ ~170 рядків). Limits як у S1 + D6; звіт implementer-а — не доказ, лише підказка. §1 бриф (план або спека, base ref, гілка; `Source: <spec>` у плані → перевірити й AC спеки з Amendments, скоуп не зменшувати). §2 розкласти на вимоги з ID, відсутні розділи не вигадувати. §3 зміни. §4 доказ на кожну вимогу (3 рівні; запустити `Verify:` через біни; прочитати тест, що він перевіряє саме X; спостережувана відсутність → `missing`). §5 зворотне трасування (файл без вимоги → Outside the plan; зміна в `U<n>` → `deviated`, Unchanged за повними шляхами). §6 вердикт лише після всіх доказів. Шаблон: Verdict + лічильники · Requirements | ID | Requirement | Verdict | Evidence (level · strength) | Gap | · Checks I ran · Outside the plan · For the human · Insight candidates.

**S3 — `.claude/agents/test-writer-backend.md`** (preload `onion-architecture`). Limits: без git history (перелік з `implementer.md`), писати лише `server/test/**`, `reviewer-core/test/**`; helpers/setup/`mocks.ts`/`vitest.config.ts` не змінювати (потреба → звіт); прод-код не змінювати ніколи, навіть тимчасово (`shasum` прод-файлів, яких торкаються тести, на старті й наприкінці однаковий); запис тільки Write/Edit (поіменна заборона `cat >`, heredoc, `sed -i`, `cp`, `mv`, `>`); без нових залежностей, snapshot, `.only/.skip/.todo/it.fails`, послаблення assertions, мережі й ключів; INSIGHTS лише читати. §1 бриф (`Mode:`, джерело вимог, гілка; перевірка worktree/гілки й стартовий `git status --short` як `implementer.md:67-73`). §2 Package rules (always Read package `CLAUDE.md`, package `INSIGHTS.md`, `TESTING.md`, `.claude/skills/onion-architecture/references/testing.md`; правила кілець з `onion-architecture/SKILL.md` → Testing by ring: домен на чистих входах, сервіс на fakes портів зі state-перевірками, без `as unknown as Container`, route через `buildApp({ overrides })` + `inject`, `pg.ts` → `*.it.test.ts`, `running`-рядки після `buildApp`). §3 кроки за режимом (D2). §4 Verify: нові тести 3× → `pnpm test:unit` (+ `test:it`) → `pnpm typecheck`, окремими викликами, без пайпів, ніколи `pnpm -s`. §5 Stop: BUG FOUND; той самий тест падає після двох виправлень → PARTIAL. Шаблон: Status (RED | DONE | BUG FOUND | PARTIAL | BLOCKED) · Tests | File · test | Requirement (source line) | Red (why) | Green ×3 | Assertion live (flipped expected → failed?) | · Verification · Production bugs · Not covered (e2e candidate / Docker / helper change) · Insight candidates.

**S4 — `.claude/agents/test-writer-ui.md`** (preload `react-testing-library`): розділи 1, 3–6 дослівно з S3; свій §2: компоненти над `vi.mock` модуля хуків + `NextIntlClientProvider`; data-layer над моком `src/lib/api.ts` з реальним `QueryClient`; `fetch` не мокати (suppress у `routing.json`); getByRole → … → getByTestId (`data-testid` у репо немає); запуск vitest за підрядком імені файлу (client INSIGHTS про `[segment]`); моки скидати; пише лише `client/src/**/*.test.{ts,tsx}`.

**S5 — `.claude/agents/doc-writer.md`** (preload `mermaid-diagram`): Limits за D10; §1 бриф (`Mode:`, тема/шлях, аудиторія, ціль, список доків, де implementer уже переніс цитати); §2 Diátaxis-компас, один файл — один тип, рішення як блок Context/Decision/Status/Consequences у explanation-доці; §3 карта місць (стисла таблиця з дайджесту); §4 твердження ↔ код, `from-plan` звіряє кожен пункт (є → теперішній час, немає → Planned); §5 діаграми; §6 індекс `docs/README.md`; §7 цитати (перевірка `sed -n '<N>p'`, перенос через `git diff -U0`, голі `:N` вручну); §8 самоперевірка `git diff -U0 -- <doc>` — кожен `-` пояснений. У промпті жодного рядка, що починається з mermaid-огорожі (тригер `routing.json:184`). Шаблон: Files (Diátaxis type) · Diagrams · Planned (not built) · Changed existing lines · Open questions · For the caller · Insight candidates.

**S6 — вставки в наявні агенти** (лише додавання рядків):
- `.claude/agents/implementer.md` після рядка 119 (кінець п. 5 «Write the tests»): «If the brief says `test-writer-*` already wrote a step's tests (test-first, red), don't write them again and don't change their assertions — make them pass; a test you believe is wrong goes under **Deviations** and stays as written.»
- `.claude/agents/planner.md` після рядка 240 (`- Security:` у шаблоні §9): `- Tests: <test-first candidates for test-writer-ui / -backend, or none>` і `- Docs: <docs worth writing for doc-writer beyond step-7 stale fixes, or none>`.

**S7 — `.claude/agents/README.md`**: 5 рядків у At a glance; нова ASCII-схема потоку (D12, без mermaid-огорожі) + таблиця «Orchestrator passes» (до plan-verifier звіт implementer-а не передається); секції `## test-writer-ui · test-writer-backend`, `## plan-verifier`, `## architecture-reviewer` (з «vs /pr-self-review»), `## doc-writer` за зразком `## implementer`; у `## implementer` Input — «+ red tests from test-writer when the brief says so»; `## Sources behind the review, test and doc agents` (S5–S24 з дайджесту + таблиця Rule | Where | Source); у Working on this folder — «test-writer-ui and -backend share sections 1, 3–6 verbatim — change both» і «read-only agents run package scripts through `node_modules/.bin`, never `pnpm`/`npm run`».

**Поза скоупом**: `CLAUDE.md`, `server/CLAUDE.md`; `researcher.md` (застаріле «Locate with Grep and Glob» — окрема задача); `pr-self-review-*` агенти й `.claude/skills/pr-self-review/**` (правка = SELF-MODIFIED і бамп версії); `routing.json` (нових скілів немає); `.claude/settings.json`. Відкрите (не блокує): чи заводити `docs/adr/` — поки рішення йдуть в explanation-доки.

## Verification

Статичні перевірки після кроків:
- frontmatter кожного нового файлу — валідний YAML з `name` + `description` (`head -12`);
- `diff` розділів `## 1.` та `## 3.`…кінець між `test-writer-ui.md` і `test-writer-backend.md` — порожній;
- `grep -n '^\s*```mermaid' .claude/agents/doc-writer.md .claude/agents/README.md` — порожньо;
- `git diff -U0 -- .claude/agents/implementer.md .claude/agents/planner.md` — жодного `-` рядка; `wc -l` зростає рівно на кількість вставлених рядків (implementer: 218 → 218+N, planner: 259 → 261);
- README: кожен `.claude/agents/*.md` з `name:` має рядок в At a glance; `git diff -U0` показує `-` лише в блоці схеми й рядку Input implementer.

Headless-прогони (свіжа сесія з кореня, у фоні): `claude -p "Delegate … to the <name> subagent" --permission-mode auto --output-format stream-json --verbose`; модель — з `output_file` події `task_notification` (grep `"model"`: `claude-opus-5-5` для H1/H2, `claude-sonnet-5-5` для решти). Перед кожним — зберегти `git status --short`; фікстурні правки повертати через Edit і показати, що статус збігся; фікстурні плани — у scratchpad. Брифи українською → статус і клітинки таблиць українською.

| # | Агент | Фікстура | Очікувано |
|---|---|---|---|
| H1 | architecture-reviewer | handler у `server/src/modules/pulls/routes.ts` робить `new PullsRepository(container.db)` | depcruise і ratchet падають; знахідка `onion/route-no-sql` або `onion/service-takes-container`, CRITICAL, `new`, `file:line`; `git status` до/після однаковий; жодного Write/Edit |
| H2 | architecture-reviewer | компонент у `client/src/app/(shell)/skills/_components/**` викликає `fetch` | `ui/component-fetch` CRITICAL; `Read:` містить `frontend-ui-architecture` |
| H3 | plan-verifier | план: S1 helper у `client/src/lib/<x>.ts` + тест, S2 рядок у `messages/en/<ns>.json`, U1 = `client/src/lib/api.ts`; зроблено лише S1 без тесту + зайва правка в `api.ts` | S1 `partial`, S2 `missing`, U1 `deviated`, `api.ts` в Outside the plan, `FAIL`; перевірки через `node_modules/.bin` |
| H4 | plan-verifier | той самий план повністю | `PASS`, усі `met` з доказом `ran`/`test` |
| H5 | test-writer-backend | `Mode: cover` на чистій функції домену (напр. `server/src/modules/pulls/domain.ts`) із засіяним багом; окремо — без бага | з багом: `BUG FOUND`, `shasum` прод-файлу той самий, падаючий тест лишився; без бага: `DONE`, жодного Edit прод-файлу, assertion-liveness зафіксовано (flip → падіння → повернення в тестовому файлі), 3 прогони |
| H6 | test-writer-ui | `Mode: test-first` за контрактом helper-а, якого ще немає | `RED` через відсутній експорт/assertion, не синтаксис; прод-файлів не створено |
| H7 | doc-writer | `Mode: from-plan` з планом H3 при реалізованому S1 | S1 у теперішньому часі з `path:line`, S2 у Planned; файл у дозволеному місці або в scratchpad за брифом |
| H8 | doc-writer | бриф просить додати правило в `server/CLAUDE.md` | файл не змінено, пропозиція в «For the caller» |

Наприкінці: усі фікстури прибрано (`git status` = лише нові/змінені файли `.claude/agents/`); wrap-up INSIGHTS через `append-insight.mjs` у root `INSIGHTS.md` (кандидати агентів + спостереження сесії), `removed 0`, `git diff -U0 -- INSIGHTS.md` без `-`; рядок `Insights: …`. Коміт — лише після окремого OK користувача.

## Додаток: чернетки frontmatter (від `planner`, з рішеннями користувача)

| name | description (англійською, у файл агента) | model · effort | skills | color |
|---|---|---|---|---|
| `architecture-reviewer` | Read-only architecture review of one DevDigest change — the uncommitted diff or a branch against its base — in one pass across packages: onion rings and ports in server/ and reviewer-core/, placement and data flow in client/, schema design and trust boundaries where touched, and the plan's design decisions. Runs dependency-cruiser through local binaries, validates every finding, reports only new high-signal problems with severity, confidence and file:line. Use after implementation, before /pr-self-review; not for style, tests or plan completeness. | opus · medium (S0) | — | purple |
| `plan-verifier` | Read-only check that a change does what its Development Plan or feature spec (specs/NN-*.md) requires — splits the source into numbered requirements (steps, decisions, contract and data-model rows, acceptance criteria, amendments, unchanged zone), finds evidence for each in the uncommitted diff, reruns the plan's Verify commands through local binaries, and returns a requirement matrix (met / partial / missing / deviated / unverifiable) with a PASS / GAPS / FAIL verdict. Judges completeness, not style. Use after the implementer, with the plan or spec and the base ref. | sonnet | — | yellow |
| `test-writer-backend` | Writes Vitest tests for DevDigest server/ and reviewer-core/ — domain units, service tests on in-memory fakes of ports, route tests with buildApp + inject, *.it.test.ts on Testcontainers Postgres — test-first from a plan or contract (proves red before the code exists) or to cover existing code (ties every assertion to a requirement and proves it can fail). Edits only test files and never production code, reports a production bug instead of fixing it, never commits. The brief must say Mode: test-first or cover. | sonnet | `onion-architecture` | orange |
| `test-writer-ui` | Те саме для `client/`: компоненти над `vi.mock`-нутими модулями хуків, data-layer хуки над замоканим `src/lib/api.ts`, чисті helpers; RTL + jsdom; e2e-флоу не пише. | sonnet | `react-testing-library` | cyan |
| `doc-writer` | Writes DevDigest documentation as docs-as-code: describes shipped behaviour from the code, turns an implementation plan into docs (marking what is not built as planned), or turns notes and other materials into reference / how-to / explanation docs with Mermaid diagrams. Picks the doc type (Diátaxis) and the file from the repo's documentation map; every claim backed by code. Edits only documentation paths — never code, CLAUDE.md, INSIGHTS.md or docs/plans. Use last, after code and tests are final. | sonnet | `mermaid-diagram` | pink |

Відхилено користувачем 2026-10-08: тимчасова мутація прод-коду в режимі `cover` (у чернетці `planner` була;
замінено на assertion-liveness у тестовому файлі, див. D2). Підтверджено: два test-writer; plan-verifier — агент, не скіл.

## Нотатка виконання (2026-10-08)

- **Хто писав.** S0, S6 і S7 виконала головна сесія. Файли агентів S1–S5 паралельно написали 4 субагенти `general-purpose`, бо `implementer` не має права правити `.claude/**`.
- **Відхилення:**
  - Довжина файлів: 192–223 рядки замість ~170.
  - Фрагмент `: ` в `description` ламає строгий YAML. У `architecture-reviewer` він був і його виправлено. У `test-writer-*` Додаток мав `Mode: test-first`, і там формулювання замінено.
  - `test-writer-*` закрито ще й `messages/`, `api.ts` та `test/helpers/**`.
- **Headless-прогони** (свіжа сесія `claude -p`, брифи українською, звіти українською):

| # | Агент · модель | Результат | Вартість |
|---|---|---|---|
| H1 | architecture-reviewer · opus | CHANGES REQUESTED; A1 `onion/route-no-sql` CRITICAL new; depcruise і ratchet exit 1; дерево не змінено | $0.42 |
| H2 | architecture-reviewer · opus | A1 `ui/component-fetch` CRITICAL new; `Read:` має `frontend-ui-architecture`; помітив зміну дерева під час рев'ю | $0.43 |
| H3 | plan-verifier · sonnet | FAIL: S1 partial, S2 missing, U1 deviated, `api.ts` в Outside the plan | $0.28 |
| H4 | plan-verifier · sonnet | PASS, 5 met; `Tree: same` | $0.29 |
| H5 | test-writer-backend · sonnet | BUG FOUND (`newestUpdate`, `at < newest`); прод-хеш той самий | $0.37 |
| H5b | test-writer-backend · sonnet | DONE, 4 тести, assertion-liveness ×4, 3 прогони; Read ×5, без пайпів | $0.46 |
| H6 | test-writer-ui · sonnet | RED: `Failed to resolve import "./format-bytes"`, TS2307; прод-файл не створено | $0.41 |
| H7 | doc-writer · sonnet | розділ у `client/docs/ui-architecture.md`, теперішній час + `path:line`, S1-тести і S2 у Planned | $0.31 |
| H8 | doc-writer · sonnet | `server/CLAUDE.md` не змінено; рядок у For the caller; попередив про 99 рядків | $0.22 |

- **Правки промптів за прогонами:**
  - `plan-verifier`: H3 пропустив фінальний `git status`. Додано поле шаблону `**Tree:**`, і H4 його вже заповнив.
  - `doc-writer`: статус стосується документів, а не фічі (H7 поставив PARTIAL через Planned).
  - `test-writer-*`: H5 рахував рядки через `cat | wc -l` замість Read і пайпив перевірки. Тепер вимога — «Read tool, whole file», `Read:` перелічує лише відкрите через Read, а форми `| tail`/`| grep` заборонено дослівно. H5b підтвердив, що правки працюють.
- **Прибирання.** Усі фікстури прибрано. `git status` містить лише `.claude/agents/*`, `INSIGHTS.md` і `docs/plans/`.

## Нотатка (2026-10-09): режим тестів у кожному кроці плану

Рішення користувача: режим тестів задається в кожному кроці плану, щоб затверджувати план разом із режимами.
- `planner.md`:
  - у §4 додано правило вибору: `test-first`, коли поведінку можна задати як «вхід → вихід» до появи коду; `implementer` — для зв'язок і UI; `—` — коли тестувати нічого;
  - у шаблоні кроку з'явився рядок `Test mode:`;
  - у §9 рядок `Tests:` замінено на `Test-first:` — це зведення кроків, позначених test-first.
- `implementer.md`: для кроку з `Test mode: test-first`, якого тестів ще немає в дереві, implementer зупиняється (PARTIAL або BLOCKED) і сам такі тести не пише.
- `.claude/agents/README.md`: додано абзац про те, де вирішуються режими, `Test mode:` у переліку §4 planner-а і `test-writer-*` у таблиці брифів.
