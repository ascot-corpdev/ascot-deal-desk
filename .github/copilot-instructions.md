# Ascot deal desk: notes for Copilot

Read this before changing anything. `README.md` is the setup guide for people; this file is how the code works and the rules for changing it.

## What it is

An M&A deal tracker and banker CRM for Ascot's Corporate Development team, styled on the Ascot PowerPoint template.

- **Site:** one static page, `web/index.html` (about 2,300 lines of HTML, CSS and plain JavaScript). There's no framework, bundler or build step. GitHub Pages serves `web/` as is.
- **Data:** Supabase (Postgres, Auth, Realtime), called from the browser with the publishable key. Row-level security decides what each login can do.
- **Server code:** three Supabase Edge Functions (Deno, TypeScript) in `supabase/functions/`.
- **Users:** a CEO login (read only) and Corp Dev logins (can edit). Logins are created by `scripts/logins.mjs`; there is no sign-up.

## Repository map

| Path | What it is |
| --- | --- |
| `web/index.html` | The whole site. |
| `web/config.js` | Supabase URL and publishable key, plus the optional Entra app IDs for the Copilot panel (`copilotClientId`, `copilotTenantId`). Blank in the repo; the Pages workflow writes it from repository variables. Never commit real values or any `sb_secret_` key. |
| (Deals tab) Teams chat card | `tcSectionHTML()`, state `S.tc`, config `teamsChatId`. Production only (`tcEnabled()`: `canEditNow()`, not `demoMode()` or `S.dbMissing`); never on the CEO view. Shows only a Teams link (`tcLink()`) unless a sign-in app is set (`msClientId()`: `msClientId`, or the Copilot app). Then it's read only: Graph v1.0 `/chats/{id}/messages` (`Chat.Read`; `msScopes()` asks for Copilot's permissions only when `cpEnabled()`). Polls every 30 s while the Deals tab is visible. Message HTML becomes text through `DOMParser`, then `esc()`. Never use `innerHTML` with message content. |
| `web/auth.html` | Redirect page for Microsoft sign-in in the Copilot panel. Posts the response to the tracker tab over `BroadcastChannel("dealdesk-auth")` and closes. Keep it self-contained: no external scripts. |
| `.github/workflows/pages.yml` | On every push to `main`: writes `web/config.js` and publishes `web/` to GitHub Pages. **A merge to `main` is a deploy.** |
| `supabase/migrations/0001..0004_*.sql` | Schema, roles, RLS, change history trigger, settings table. Run by hand in the Supabase SQL editor. |
| `supabase/functions/comps/` | Public comps from S&P Global via Kensho (kfinance). `core.ts` is the pure maths (tested), `kensho.ts` is auth and HTTP, `index.ts` is the handler. |
| `supabase/functions/digest/` | Weekly email digest through Resend, run by `supabase/digest_schedule.sql` (pg_cron). |
| `supabase/functions/claude/` | Claude assistant backend. **Not used at present** (see "Assistant" below). |
| `supabase/config.toml` | `verify_jwt = false` for functions that check the login themselves. |
| `scripts/logins.mjs` | Creates, resets and removes logins. Needs the Supabase secret key, so it runs on the owner's machine only. |

## Running it

```bash
npm run serve        # http://localhost:8080 (needs web/config.js filled in to sign in)
```

Without a Supabase URL in `web/config.js` the page shows a setup message. With an empty database it shows example data held only in memory (`DEMO`, `demoMode()`); it is never written.

## How `web/index.html` is organised

Sections are marked with `/* ---------- name ---------- */` comments, in this order: constants, example data, state, helpers, routing, render (CEO view, Deals, Comps, Team, Banker CRM), drawer, writes, concurrent editing, change history, board pack, email, import, CSV export, Microsoft 365 Copilot, Claude helper, events, data, auth, boot.

The patterns used throughout:

- **State:** one global object `S`. Change `S`, then call `render()` for the main view or `renderDrawer()` for the side drawer. Views are built as template strings.
- **Clicks:** every button carries `data-act="..."` (and `data-id`, `data-v` and so on). One delegated `switch` in the events section handles them all. Add a new `case` there; don't attach listeners to individual elements.
- **Escaping:** anything from the database or a user goes through `esc()` before it is put into HTML, and links go through `safeUrl()`. Keep it that way.
- **Routing:** hash routes `#ceo`, `#deals`, `#bankers`, `#team`, `#comps`, `#deal/<id>`, `#banker/<id>`. Use `goRecord()`, `openRoute()` and `closeDrawer()`.
- **Data access:** `S.db.collection(table).doc(id).set/update/delete` (section "data"). Tables `deals`, `bankers`, `notes` each hold `{id text, doc jsonb, updated_at, updated_by}`, so new fields need no migration; the database stamps `updated_at` and `updated_by`.
- **Concurrent editing (don't break this):** `update()` goes through `casWrite()`, a compare-and-set on `updated_at`. The drawer keeps `dr.orig` (record when opened) and `dr.base` (form when first shown) and saves only the fields this user changed, merged onto the latest row. If someone else changed the same field, a conflict panel asks whose value to keep. Presence shows "X is editing" through Realtime. Any new editable field must go into `DEAL_FIELDS` or `BANKER_FIELDS` and `FIELD_LABELS` so diffs, history and conflicts include it.
- **Questions:** a CEO question is a note `{kind:"Question", dealId, text, authorId}`; replies carry `replyTo` (Corp Dev: kind `"Answer"`; CEO follow-ups: `"Question"`), and Corp Dev can close one with `closedAt`. `qThreads()` works out open/answered. Any login may insert questions only through RLS in `0005_ceo_questions.sql`, so the CEO's writes use a plain `insert`, not `set` (upsert). Question/Answer notes are kept out of "Recent context" and don't count as deal activity.
- **Stages:** `STAGES` = Screening, NDA signed, LOI, Diligence, Closed, On hold, Dead. Old values map through `STAGE_ALIAS` (`IOI` → LOI, `Signed` → Closed) in `normDeal()`.
- **Deal links:** each link is `{label, url, type}` with `type` `"profile"` or `"other"`. Older links without a type count as the profile when the label contains "profile" (`isProfile()`).
- **Roles:** `isCEO()` and `canEditNow()`. The CEO login is read only in the page and in RLS; never rely on the page alone for permissions.
- **Board pack:** `exportBoardPack()` builds a PowerPoint in the browser with PptxGenJS 4.0.1, lazy-loaded from jsDelivr, in Ascot house style.
- **Libraries:** only from CDNs with exact versions (supabase-js 2.117.2, PptxGenJS 4.0.1). Don't add a build step or npm packages to the site.

## Comps (Kensho)

- The page POSTs `{tickers, period}` to `/functions/v1/comps` with the user's token. `period` is `quarter`, `ytd` or `ltm`.
- The function calls kfinance: `ids`, `statements/` (income in the chosen series, 5 periods; balance sheet quarterly, 5 periods), `market_cap/{id}/{start}/{end}` (also carries shares outstanding), `earnings/{id}`. Results are cached in memory for 10 minutes and never stored.
- Everything calculated is labelled "(derived)": loss ratio = policy benefits / premiums; combined ratio = (total operating expenses − non-insurance expenses) / premiums; ROE annualised in quarter and YTD views; equity = assets − liabilities − minority interest when not reported; BVPS growth = equity / shares at the latest quarter end versus a year earlier; P/E on twelve-month net income; P/B and P/E blank when market cap and accounts are in different currencies.
- Peers and the AGL financials link live in the `settings` table (row `benchmark`). AGL financials themselves must never be stored; only the link.
- Changes to `supabase/functions/comps/*` need a redeploy by the owner (below) as well as a merge.

## Assistant

The header button is **Ask Copilot**. When `copilotClientId` is set (`cpEnabled()`), it opens a side panel (`renderCP()`, state `S.cp`, root `#cpRoot`, body class `cp-docked`) that calls the Microsoft 365 Copilot Chat API (Graph beta `/copilot/conversations`) as the user's Microsoft account. Sign-in is hand-written OAuth code flow with PKCE in a popup (`cpSignIn()`), with no MSAL library, so nothing is added from a CDN. Tokens stay in memory only and are cleared on tracker sign-out. Each question sends `copilotBrief(false)` as `additionalContext`; web grounding is off unless the user ticks "Include web results". The panel's **Copy and open Copilot** and the not-configured path both copy the brief (`copilotBrief()`, under 15,000 characters) and open Microsoft 365 Copilot in a new tab. "Draft with Copilot" in a banker's email box does the same with a drafting prompt. The older in-page Claude panel is switched off with `AI_PANEL = false`; its code and `supabase/functions/claude` remain so it can be turned back on.

## Rules

- **Never** put secrets in the repo, the page or a commit: no `sb_secret_` key, Anthropic key, Kensho refresh token or private key, Resend key or passwords. The publishable key is the only key the site uses.
- Work on a branch and open a pull request; merging to `main` publishes the site.
- Database changes go in a new numbered migration (`0005_...sql`) that is safe to run once, keeps RLS on, and revokes access from `anon`. Don't edit migrations that have already been run.
- Keep the phone layout working: no sideways scroll at 390px wide.
- Writing style on the page follows the Ascot house style: plain English, sentence case, "n/d" for missing numbers, $M with commas, dates like "5 Nov" (year added when it isn't the current year).

## What only the owner can do

These need the Supabase CLI or SQL editor and the Supabase secret key. Write the code, then give the owner the exact commands:

```bash
supabase functions deploy comps --no-verify-jwt
supabase functions deploy digest --no-verify-jwt
supabase secrets set NAME=value
```

```bash
SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run logins -- add <username> <ceo|corpdev> "<Full name>"
```

SQL migrations: paste into **Supabase > SQL editor** and run.

## Checking changes

Run the tests before opening a pull request (see `tests/README.md`):

```bash
npm install && npx playwright install chromium
npm test                 # everything (function suites need Deno)
npm test -- comps        # just the suites whose names contain "comps"
```

The **Tests** workflow runs the same on every pull request; don't merge with a red check. If a change is meant to alter something a test checks, update that test in the same pull request, and add a test for new behaviour (copy the nearest `tests/web/*.test.cjs`). Never weaken or delete a check just to get it green.

The repository is public: test data must use made-up people, emails and deal codenames (see `tests/fixtures/`), never real ones.
