# Research digest — нові субагенти (2026-10-08)

Зведення п'яти звітів `researcher`. Позначки: [P] первинне джерело, [S] вторинне,
[inf] висновок дослідника без прямого джерела, [WF] цитата з WebFetch-підсумку
(перед вставкою в промпт звірити з сирою сторінкою — root INSIGHTS, 2026-10-08).
Claude Code docs читались сирим markdown через curl (точні цитати).

## Джерела

- CC-BP https://code.claude.com/docs/en/best-practices.md [P]
- CC-SA https://code.claude.com/docs/en/sub-agents.md [P]
- AN-CR https://raw.githubusercontent.com/anthropics/claude-code/main/plugins/code-review/commands/code-review.md [P]
- GOOG-CR https://google.github.io/eng-practices/review/reviewer/looking-for.html [P]
- TW-FF https://www.thoughtworks.com/insights/articles/fitness-function-driven-development [P]
- DC-CLI https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/doc/cli.md [P]
- NYGARD https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions [P]
- TL-PRIO https://testing-library.com/docs/queries/about/#priority [P][WF]
- TL-GP https://testing-library.com/docs/guiding-principles/ [P][WF]
- KCD https://kentcdodds.com/blog/testing-implementation-details [P][WF]
- FOWLER https://martinfowler.com/articles/practical-test-pyramid.html [P][WF]
- VITEST https://vitest.dev/guide/mocking.html [P][WF]
- TESTGEN https://arxiv.org/abs/2402.09171 (Meta TestGen-LLM) [P]
- ACH https://arxiv.org/abs/2501.12862 (Meta mutation-guided tests) [P]
- SPECKIT https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/analyze.md [P]
- GSD https://raw.githubusercontent.com/gsd-build/get-shit-done/main/agents/gsd-verifier.md [S]
- MTB https://arxiv.org/abs/2306.05685 (LLM-as-judge biases; лише abstract) [P]
- DIAT https://diataxis.fr/compass/ (+ /reference/, /how-to-guides/, /explanation/) [P]
- GSTYLE https://developers.google.com/style/highlights, /tense [P]
- C4 https://c4model.com/diagrams [P]
- MERMAID https://mermaid.js.org/intro/ (+ syntax/sequenceDiagram, entityRelationshipDiagram, stateDiagram) [P]
- WTD https://www.writethedocs.org/guide/docs-as-code/ [P]
- Колекції [S]: wshobson/agents (test-automator, architect-review, docs-architect), VoltAgent/awesome-claude-code-subagents (architect-reviewer — НЕ read-only: має Write/Edit; qa-expert — "coverage > 90%" як антипатерн; technical-writer)

## Спільне для всіх чотирьох (CC-SA, CC-BP)

- "Design focused subagents: each subagent should excel at one specific task"; "Limit tool access".
- `tools` = allowlist, `disallowedTools` = denylist; "If both are set, `disallowedTools` is applied first".
- `description` короткий (коли делегувати), деталі — у тілі промпту.
- "A fresh context improves code review since Claude won't be biased toward code it just wrote";
  рев'юер "sees only the diff and the criteria you give it, not the reasoning that produced the change".
- "Have Claude show evidence rather than asserting success: the test output, the command it ran and what it returned";
  "so the agent doing the work isn't the one grading it".
- "Tell the reviewer to flag only gaps that affect correctness or the stated requirements, and treat the rest as optional." / "Report gaps, not style preferences."
- Обмежити Write/Edit певними шляхами frontmatter не вміє: лише PreToolUse-hook або permissions.deny.
  **У цьому репо hooks заборонені до стабілізації harness** → обмеження шляхів = prompt-правила.

## test-writer

1. Перевірка pass/fail і показ виводу, не "готово" (CC-BP).
2. Test-first: тести з вимог/плану/Zod-контракту → запустити → показати, що падають (red) → лише тоді код.
   CC-BP: "have one Claude write tests, then another write code to pass them". Прямого "TDD: confirm they fail" у CC-BP немає [inf].
3. Не підганяти тест під код: очікування не виводити з реалізації; розбіжність з вимогою = знахідка, не правка assert [inf з KCD/TL-GP].
4. Доказ сили тесту: ручна мутація продакшн-коду (інвертувати умову, прибрати виклик) → тест падає → повернути. Інакше "false positive" (KCD, TESTGEN).
5. Фільтр згенерованих тестів: збирається → проходить стабільно (кілька прогонів) → додає виявлення дефектів. TestGen-LLM: 75% build, 57% pass reliably, 25% increased coverage. ACH: цілитись у конкретні незловлені збої.
6. Спостережувана поведінка, не деталі реалізації: тест, що ламається на рефакторингу, = "false negative" (KCD, FOWLER "Test for observable behaviour instead").
7. UI: query priority getByRole → getByLabelText → getByPlaceholderText → getByText → getByDisplayValue → getByAltText/getByTitle → getByTestId (TL-PRIO); "The more your tests resemble the way your software is used…" (TL-GP).
8. Моки лише на межах; у сервісних тестах — fakes (наш onion-architecture); "Always remember to clear or restore mocks" (VITEST).
9. Не дублювати рівні: тест якнайнижче по піраміді; e2e лише наскрізні флоу (FOWLER).
10. Баг у продакшн-коді, знайдений тестом: зупинитись, звітувати (file:line, мінімальний падаючий тест, очікувано vs фактично); не правити код і не послаблювати тест [inf з CC-BP].
11. Один агент чи два (UI / backend): джерела не вирішують; є лише "focused subagents". Контексти різні (RTL/jsdom vs Fastify/Drizzle/testcontainers) → або два вузькі, або один з розділеними розділами і preload лише потрібних skills [inf].
12. Антипатерн: метрика покриття як ціль (VoltAgent qa-expert "coverage > 90%").

## architecture-reviewer (read-only)

1. Питання дизайну: "Do the interactions of various pieces of code in the CL make sense? Does this change belong in your codebase…? Does it integrate well with the rest of your system?" (GOOG-CR).
2. Code health: "Don't accept CLs that degrade the code health… Most systems become complex through many small changes"; over-engineering — "Reviewers should be especially vigilant" (GOOG-CR).
3. Не флагати: стиль/нейминг (Google: "Nit:"), pre-existing issues, pedantic nitpicks, "Issues that a linter will catch" (AN-CR, GOOG-CR).
4. High signal: "If you are not certain an issue is real, do not flag it. False positives erode trust"; кожну знахідку валідувати, невалідовані відкидати (AN-CR — Anthropic's own review command).
5. Нове vs існувало: порушення має вноситись диффом (AN-CR "Pre-existing issues").
6. Fitness functions (TW-FF) / dependency-cruiser baseline (DC-CLI): детерміновані правила лишити `pnpm arch`; модель — те, що правилом не виразити; порушення з baseline не репортити. Чи запускати `pnpm arch` самому — джерела не кажуть (AN-CR: "do not run the linter to verify").
7. Звірка з ADR/планом: ADR фіксує "architecturally significant" рішення — "structure, non-functional characteristics, dependencies, interfaces, or construction techniques" (NYGARD).
8. Формат знахідки: severity, впевненість, file:line, "чому важить тут", коротка пропозиція — конкретні поля [inf]; AN-CR має "reason flagged".
9. Цілісний прохід по всьому диффу (міжмодульні/міжпакетні зв'язки) — відмінність від /pr-self-review, який ріже на батчі по лінзах [inf].
10. Tools: Read + Bash лише read-only; приклад code-reviewer у CC-SA має `tools: Read, Glob, Grep`, `model: sonnet`.
11. Відкриті колекції показують, ЩО покривати (coupling, cohesion, boundaries), але не як уникати шуму; взірець — AN-CR.

## plan-verifier

1. Критерії лише з плану/спеки + дифф; reasoning автора не читати (CC-BP fresh context).
2. "Check that every requirement is implemented, the listed edge cases have tests, and nothing outside the task's scope changed. Report gaps, not style preferences." (CC-BP — приклад review-prompt проти PLAN.md).
3. Звіт implementer-а / чекбокси "done" — не доказ: "Do NOT trust SUMMARY.md claims"; старт з гіпотези "Assume the phase goal was not achieved until codebase evidence proves it" (GSD).
4. Розкласти план/спеку на атомарні вимоги з ID (кроки S, рішення D, поля контракту, рядки data model, acceptance criteria, Amendments, Unchanged). Трасування в обидва боки: "Requirements with zero associated tasks" / "Tasks with no mapped requirement" (SPECKIT); "ORPHANED requirements MUST appear" (GSD).
5. Три рівні доказу: існує → змістовний (не stub/TODO) → підключений (викликається/змонтований/зареєстрований). "a stub file satisfies existence but not behavior" (GSD).
6. Сила доказу: команда, яку верифікатор сам запустив (вивід процитовано) / тест, що падає без зміни > `file:line` > опис.
7. Без доказу — не `met`; спостережувана відсутність — `missing`, не `unverifiable` ("Choosing UNCERTAIN instead of FAILED when absence of implementation is observable" — антипатерн, GSD).
8. Scope creep: `git diff --stat` проти файлів плану; файл поза планом і будь-яка зміна в Unchanged — окрема знахідка.
9. Не зменшувати скоуп: спека має N критеріїв — перевірити всі N, навіть якщо план покрив менше ("must-haves must NOT reduce scope", GSD). "NEVER hallucinate missing sections" (SPECKIT).
10. Упередження суддів: position, verbosity, self-enhancement (MTB); не рахувати % виконаних кроків як сигнал ("Letting high task-completion percentage bias judgment toward PASS", GSD); вердикт після доказу.
11. Права: Read + Bash (запуск перевірок) без Write/Edit [inf — прямої рекомендації немає].
12. Неперевірне локально (e2e, Docker, ключ): `unverifiable` з точною командою для людини, не `met`.
13. Запропонована шкала [inf, синтез GSD VERIFIED/FAILED/UNCERTAIN + SPECKIT severity]:
    `met` (є доказ, підключено) · `partial` (що бракує) · `missing` (немає / stub) ·
    `deviated` (зроблено інакше; чи є Amendment) · `unverifiable` (чим і ким перевірити).
    PASS лише без `missing`/`deviated`, а всі `partial`/`unverifiable` винесені людині.

## doc-writer

1. Класифікувати перед писанням (DIAT compass: "action or cognition?" / "acquisition or application?") → tutorial / how-to / reference / explanation; один файл — один тип.
2. Reference: "Neutral description is the key imperative"; структура документа дзеркалить структуру продукту (DIAT) [WF].
3. How-to: "no digression, explanation, teaching" (DIAT); "чому" (рішення, обмеження, альтернативи) → explanation.
4. ADR — окремий тип: Title / Context / Decision / Status / Consequences, 1–2 сторінки; "If a decision is reversed, we will keep the old one around, but mark it as superseded" (NYGARD).
5. Теперішній час лише про наявну поведінку: "Don't use future tense to describe how a product or feature will work after the next release" (GSTYLE). План ≠ зроблене: нереалізоване позначати як planned [inf].
6. Кожне твердження — з прочитаного коду; не підтверджене кодом не писати, а винести як відкрите питання [S + inf].
7. Docs-as-code: "writing documentation with the same tools as code" (WTD); Mermaid як текст у .md ("help documentation catch up with development", MERMAID).
8. Діаграма лише там, де додає: "you don't need to use all 4 levels of diagram; only those that add value"; "the system context and container diagrams are sufficient for most software development teams" (C4). Один рівень деталізації на діаграму. C4 у Mermaid — експериментальний ("caution").
9. Тип Mermaid під зміст: sequence — порядок взаємодій; ER — сутності/зв'язки даних; state — стани/переходи; flowchart — розгалужена логіка/пайплайн (MERMAID). Імена елементів — з реального коду.
10. Стиль: активний стан ("make clear who's performing the action"), звертання до читача, без жаргону (GSTYLE).
11. Заборони в тілі промпту: не вигадувати поведінку, не переписувати чужий текст, не змінювати код.
12. Матеріали користувача (нотатки, плани) перетворювати, зберігаючи зміст; невідоме не добудовувати [inf].

Таблиця типів:
| Тип | Структура | Діаграма |
|---|---|---|
| Reference | дзеркалить структуру коду, лише факти | ER (дані), class/flowchart за потреби |
| Explanation | контекст, причини, альтернативи | C4 context/container, flowchart |
| How-to | кроки до мети, без теорії | рідко; flowchart для розгалужень |
| Tutorial | навчальний шлях | зазвичай без |
| ADR | Title, Context, Decision, Status, Consequences | опційно C4 одного рівня |
| Потік / життєвий цикл | у reference або explanation | sequence / state |

### Карта документації цього репо (repo-researcher, high confidence)

| Вид | Шлях | Що пишуть / що ні | Правило |
|---|---|---|---|
| Огляд і архітектура | `README.md` → `## Architecture` (mermaid) | наскрізний потік між пакетами | `README.md:25-27`, `CLAUDE.md:83-100` |
| Тестування і CI | `TESTING.md` | стратегія, suite map, конвенції | `TESTING.md:1-6,90` |
| Карта агента | `CLAUDE.md` (корінь, `<pkg>/`) | лише потрібне в кожній сесії; < 100 рядків (корінь і server — 99); лише додавати рядки | `checks.mjs:664-666`, `frontend-ui-architecture/SKILL.md:181` |
| Уроки | `INSIGHTS.md` | ТІЛЬКИ через скрипт engineering-insights; агенти повертають Insight candidates | `INSIGHTS.md:3-10`, `engineering-insights/SKILL.md:72-77` |
| Пакетний README | `<pkg>/README.md` | server: API map, DI, env; client: UI route map; reviewer-core: pipeline + Public API; e2e: формат flow | `server/README.md:72-76`, `client/README.md:19` |
| Як працює сьогодні | `<pkg>/docs/*.md` + індекс у `docs/README.md` («Files:») | глибокі розбори; НЕ: API/UI map, indexer, наміри, уроки | `server/docs/README.md:3-15` |
| Фіча-спека | `<pkg>/specs/NN-kebab.md` | Status, Problem, Scope, API / Data, Acceptance criteria; спільна API+UI спека — у `server/specs/`; зміни — `## Amendment (дата)`; `**Unchanged (no diff at all):**` з повними шляхами | `server/specs/README.md:3-18`, `server/specs/01-run-cost-badge.md:85-87`, `server/specs/03-skills.md:70` |
| Контрактна спека | `<pkg>/specs/<kebab>.md` без номера | `# <Name> — contract`, нумеровані правила з цитатою коду і тесту; код і контракт в одному коміті; застарілі `file:line` правити на місці | `client/specs/pages.md:1-5`, `server/specs/review-flow.md:1-3` |
| e2e | `e2e/specs/NN-kebab.flow.json` + `flows.md`; проза — `e2e/docs/` | | `e2e/specs/README.md:1-15` |
| Module README | `server/src/modules/repo-intel/README.md` | індексатор | `CLAUDE.md:83-100` |
| Промпти seed-агентів | `docs/agent-prompts/*.md` + `server/src/db/seed-prompts.ts` (синхронно) | | `docs/agent-prompts/README.md:3-19`, `checks.mjs:682-685` |
| Скіли seed-агентів | `docs/agent-skills/*.md` | frontmatter name/description/type | `docs/agent-skills/README.md:8-36` |
| Субагенти Claude Code | `.claude/agents/README.md` (мапа) + `<agent>.md` | | `.claude/agents/README.md:3-6` |
| Скіли Claude Code | `.claude/skills/README.md` + `<skill>/SKILL.md`; новий скіл → запис у `routing.json` | | `.claude/skills/README.md:9-31`, `routing.json:3` |
| Діаграми | ```mermaid у .md; скіл `mermaid-diagram`, findings ≤ SUGGESTION | | `routing.json:180-185` |
| Цитати | `path:line`; після зміни коду мапити через `git diff -U0`; не цитувати рядки INSIGHTS; голі `:N` — вручну; кожен док один раз після всіх агентів | | root `INSIGHTS.md` What doesn't work; `citations.mjs:2-15` |

Куди doc-writer НЕ пише: `INSIGHTS.md` напряму; `server/clones/**`, `**/src/vendor/**`,
`server/src/db/migrations/**`, lockfiles, `.env*`; переписувати існуючий текст `CLAUDE.md`
або додавати рядки понад 99; прозу в `e2e/specs/` (крім `flows.md`); `docs/agent-prompts/` без
`seed-prompts.ts`; нові `INSIGHTS.md` чи секції; нумеровану спеку для вже зробленого.
Явного правила про мову документів немає; усі наявні доки англійською [inf].
