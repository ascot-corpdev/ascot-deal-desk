# Ascot deal desk

M&A deal tracker and banker CRM for Corporate Development, styled on the Ascot PPT template.

- **CEO view (read only):** pipeline headline, stat tiles, pipeline by stage, next 30 days, deal summaries with SharePoint deck links, banker relationships, latest team notes.
- **Deals and Banker CRM (Corp Dev):** add, edit and delete deals, bankers and notes; SharePoint links per deal; CSV export.
- **Claude assistant (Corp Dev):** reads the tracker, drafts CEO summaries, preps banker calls, and proposes edits that the user approves before anything is saved.

## How it fits together

| Part | Where it runs | What it does |
| --- | --- | --- |
| `web/` | GitHub Pages (static) | The site. Talks to Supabase from the browser. |
| `supabase/migrations/0001_deal_desk.sql` | Supabase Postgres | Tables, roles and row-level security: every login reads, only `corpdev` logins write, anonymous visitors get nothing. |
| `supabase/migrations/0002_merge_stages.sql` | Supabase Postgres | Optional: rewrites stored IOI stages to LOI and Signed to Closed. The page already reads them that way. |
| `supabase/migrations/0003_history.sql` | Supabase Postgres | Change history: a trigger records who changed which deal or banker field, from what, to what. Shown in each drawer and in "What changed" on the CEO view. Run once after 0001. |
| `supabase/functions/claude` | Supabase Edge Function | Checks the caller is a Corp Dev login, then calls Claude with the Anthropic API key kept server side. |
| `scripts/logins.mjs` | Your machine | Creates, resets and removes logins with the Supabase service role key. |
| `.github/workflows/pages.yml` | GitHub Actions | Writes `web/config.js` from repository variables and publishes `web/` to Pages. |

Passwords are checked by Supabase Auth on the server, and the database refuses reads and writes that a login's role does not allow, so the public URL shows nothing without a valid login.

## Setup (about 20 minutes)

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com) (the free tier is enough to start).
2. **SQL editor:** paste and run `supabase/migrations/0001_deal_desk.sql`.
3. **Authentication > Sign In / Providers > Email:** keep Email enabled and turn **off** "Allow new users to sign up". Logins are created only by the script.
4. **Project settings > API Keys:** note the **publishable key** (`sb_publishable_...`, safe for the website) and the **secret key** (`sb_secret_...`, only for the login script on your computer). The Project URL is under **Project settings > Data API** (`https://YOUR_PROJECT_REF.supabase.co`). Never put the secret key in the site or in GitHub. (Older projects show `anon` and `service_role` keys instead; they work the same way.)

### 2. Claude assistant function

Needs the [Supabase CLI](https://supabase.com/docs/guides/cli) and an Anthropic API key from [console.anthropic.com](https://console.anthropic.com).

```bash
supabase login
```

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... ALLOWED_ORIGIN=https://YOUR_GITHUB_USER.github.io
```

```bash
supabase functions deploy claude --no-verify-jwt
```

`--no-verify-jwt` is safe: the function checks the caller's login itself and only answers Corp Dev logins.

The assistant uses Claude Opus 5.5 at medium effort, with Anthropic's server-side fallback switched on (if Opus 5.5's safety checks decline a request, the API retries it on Anthropic's recommended fallback model). To use another model, set the secret `CLAUDE_MODEL`.

### 3. Logins (CEO, Corp Dev 1, Corp Dev 2)

```bash
npm install
```

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co SUPABASE_SECRET_KEY=sb_secret_YOUR_KEY npm run logins -- seed
```

This creates `ceo` (CEO, read only), `corpdev1` and `corpdev2` (Corp Dev, can edit and use Claude) and prints their passwords once. Send each one privately; people can change their own password after signing in.

On Windows PowerShell, set the variables first: `$env:SUPABASE_URL="https://..."; $env:SUPABASE_SECRET_KEY="sb_secret_..."`, then run `npm run logins -- seed`.

Other commands (same two environment variables):

```bash
npm run logins -- add jsmith corpdev "Jane Smith"
```

```bash
npm run logins -- reset ceo
```

```bash
npm run logins -- remove corpdev2
```

```bash
npm run logins -- list
```

Usernames become `username@deal-desk.local` behind the scenes; no email is ever sent. If Supabase rejects that address, set `USERNAME_DOMAIN` (for example your company domain) for the script and as a repository variable, and use the same value in both.

### 4. GitHub Pages

1. **Settings > Pages > Build and deployment > Source:** GitHub Actions. (Pages on a private repository needs a paid GitHub plan; on a free plan, make the repository public. The code holds no secrets.)
2. **Settings > Secrets and variables > Actions > Variables:** add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (and `USERNAME_DOMAIN` if you changed it). Use the publishable key, never the secret key.
3. Push to `main`, or run the "Deploy site to GitHub Pages" workflow. The site appears at `https://YOUR_GITHUB_USER.github.io/REPO_NAME/`.

## Running locally

Fill in `web/config.js` with the Project URL and publishable key, then:

```bash
npm run serve
```

Open http://localhost:8080. Add `http://localhost:8080` to `ALLOWED_ORIGIN` (comma-separated values are not supported; use `*` while testing) if you want the assistant locally.

## Notes

- **Data model:** each deal, banker and note is a JSON document (`id`, `doc`) so fields can change without migrations. `updated_at` and `updated_by` are stamped by the database.
- **Live updates:** open pages refresh within a second when anyone saves, through Supabase Realtime.
- **SharePoint links** are stored as links. Opening one still needs SharePoint access to that file.
- **Costs:** Supabase free tier; GitHub Pages free; Claude is billed per use on your Anthropic account (each assistant question sends the tracker snapshot, so cost grows with the size of the pipeline).
