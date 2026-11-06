# Tests

About 500 checks across the site and the Supabase functions. They run on every pull request (GitHub > Actions > **Tests**); a red check means something broke, and the run's **test-output** download has screenshots from the failing suite.

## Run them yourself

```bash
npm install
npx playwright install chromium
npm test
```

`npm test -- comps qa` runs only the suites whose file names contain those words. The two function suites need [Deno](https://deno.com) and are skipped without it.

## What's here

| Path | What it covers |
| --- | --- |
| `web/*.test.cjs` | The site (`web/index.html`) in Chromium, against an in-memory stand-in for Supabase (`web/mock-supabase.js`). Nothing touches the live database, Kensho or Microsoft. |
| `web/concurrency.test.cjs` | Two people editing the same record: field-level saves, the conflict panel, deleted-while-open, presence. |
| `web/qa.test.cjs` | CEO questions, Add to calendar files, the board pack's per-deal slides. |
| `functions/comps_test.ts` | The comps function's maths on W. R. Berkley's reported figures, and its handling of Kensho answers and errors. |
| `functions/digest_test.ts` | The weekly email digest. |
| `fixtures/` | Test data. **Every person, email and deal codename in it is made up**; firm names are real (the import tests check firm matching and logos). |
| `out/` | Screenshots, board packs and calendar files from the last run. Not committed. |

## Rules for test data

The repository is public. Never put real people, real email addresses, deal codenames, targets or financials in a test. Use made-up names like the ones in `fixtures/`.

## Adding a test

Copy the nearest suite in `web/`, keep its `ok(name, condition, detail)` checks, and end with `console.log(`${pass} passed, ${fail} failed`)` and a non-zero exit code on failure; `run.mjs` picks up any `*.test.cjs` file. When a change is meant to alter behaviour that a test checks, update the test in the same pull request.
