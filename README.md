# Ascot deal desk

M&A deal tracker and banker CRM for Corporate Development, styled on the Ascot PPT template.

- **CEO view (read only):** pipeline headline, stat tiles, pipeline by stage, next 30 days, deal summaries with each deal's profile and other docs (SharePoint links), what changed, outcomes and peer benchmarks.
- **Pipeline slide (CEO view):** switch the CEO view from Dashboard to Pipeline slide for the one-page table (company, ownership, HQ, 2025 key stats, project name, Vision 2030 type, description, current status, sell-side advisor), grouped Acquire, Add and Passed deals. **Download slide (.pptx)** builds it as 16:9 slides in the browser (`Ascot-pipeline-YYYY-MM-DD.pptx`, about 11 rows a slide). It follows Ascot styling (Arial, magenta title, navy header, spectrum stripe, footer) but isn't built from the official Ascot template file, so paste it into the template if you need the exact master.
- **Add and Acquire:** each deal is either Acquire (buying all or part of a company; blue) or Add (business or capacity without buying a company: MGA / program, reinsurance / capacity, partnership; teal). It follows the deal type unless changed on the deal; the CEO view (with an All / Acquire / Add filter), Deals filters and board pack show the split.
- **Deals and Banker CRM (Corp Dev):** add, edit and delete deals, bankers and notes; SharePoint links per deal; CSV export.
- **Team chat (production only, optional):** with step 9 set up, the Deals tab has a card for the team's Teams group chat. With only the chat ID set, it opens the chat in Teams. With a Microsoft sign-in app as well, it shows the latest messages, read only. Each person signs in with their own Microsoft account and sees the messages only if they're a member of the chat.
- **Ask Copilot (every login):** with step 8 set up, opens a chat panel beside the tracker that asks Microsoft 365 Copilot through Microsoft's Copilot Chat API. You sign in with your Microsoft account, and each question carries a plain-text brief of the tracker (deals, bankers, latest notes; under 15,000 characters) as context. Without step 8, it copies that brief and opens Microsoft 365 Copilot in a new tab to paste it into. In a banker's email box, **Draft with Copilot** copies a drafting prompt the same way. Use your company's Microsoft 365 sign-in so Copilot's enterprise data protection applies.

For Copilot (and other coding assistants): how the code works and the rules for changing it are in [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## How it fits together

| Part | Where it runs | What it does |
| --- | --- | --- |
| `web/` | GitHub Pages (static) | The site. Talks to Supabase from the browser. |
| `supabase/migrations/0001_deal_desk.sql` | Supabase Postgres | Tables, roles and row-level security: every login reads, only `corpdev` logins write, anonymous visitors get nothing. |
| `supabase/migrations/0002_merge_stages.sql` | Supabase Postgres | Optional: rewrites stored IOI stages to LOI and Signed to Closed. The page already reads them that way. |
| `supabase/migrations/0003_history.sql` | Supabase Postgres | Change history: a trigger records who changed which deal or banker field, from what, to what. Shown in each drawer and in "What changed" on the CEO view. Run once after 0001. |
| `supabase/migrations/0004_settings.sql` | Supabase Postgres | Shared settings: the Comps peer list and the AGL financials link (link only). |
| `supabase/migrations/0005_ceo_questions.sql` | Supabase Postgres | CEO questions on deals: lets any login add a question to a deal in their own name. Corp Dev answers with notes. Run once after 0001. |
| `supabase/functions/digest` | Supabase Edge Function | Optional weekly email digest (overdue, stalled, due this week, cold bankers, what changed), sent through Resend on a Supabase Cron schedule (`supabase/digest_schedule.sql`). |
| `supabase/functions/comps` | Supabase Edge Function | Optional public comps from S&P Global via Kensho (kfinance) for the Comps tab, CEO view and board pack. Credentials stay in its secrets; each result is saved to `kensho_store` (section 7c). |
| `supabase/functions/comps-chat` | Supabase Edge Function | Optional Claude chat on the Comps tab. Answers from S&P Global data via Kensho only (the table on screen plus lookups it makes itself); never sees the deal tracker. Any login. |
| `supabase/functions/league` | Supabase Edge Function | Optional league table on the Banker CRM: which banks advised on M&A involving the Comps peers and other companies you list, from S&P Global via Kensho. Any login; each result is saved to `kensho_store`. See sections 7b and 7c. |
| `supabase/functions/claude` | Supabase Edge Function | Not used by the site at present (the Claude panel is switched off with `AI_PANEL` in `web/index.html` in favour of Ask Copilot). Kept so it can be turned back on. |
| `scripts/logins.mjs` | Your machine | Creates, resets and removes logins with the Supabase service role key. |
| `scripts/backup.mjs`, `scripts/restore.mjs` | Your machine | Encrypted backup of the tracker to `~/Documents/ascot-deal-desk-backups/`, and restore from it (`npm run backup`, `npm run restore`). See section 10. |
| `supabase/migrations/0007_kensho_store.sql` | Supabase Postgres | The last Kensho results for the Comps tab and league table, so pages open at once and Kensho is asked only on Refresh. Written by the functions, read by any login. See section 7c. |
| `supabase/migrations/0006_keepalive.sql`, `.github/workflows/keepalive.yml` | Supabase, GitHub Actions | A daily call that keeps the free-tier project from pausing. Reads no data. See section 10. |
| `web/auth.html` | GitHub Pages (static) | Return page for "Sign in with Microsoft" in the Ask Copilot panel. Hands the sign-in back to the tracker tab and closes. |
| `.github/workflows/pages.yml` | GitHub Actions | Writes `web/config.js` from repository variables and publishes `web/` to Pages. |
| `tests/`, `.github/workflows/tests.yml` | GitHub Actions | About 500 automated checks of the site and the functions, run on every pull request (`npm test` locally). See `tests/README.md`. |

Passwords are checked by Supabase Auth on the server, and the database refuses reads and writes that a login's role does not allow, so the public URL shows nothing without a valid login.

## Setup (about 20 minutes)

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com) (the free tier is enough to start).
2. **SQL editor:** paste and run `supabase/migrations/0001_deal_desk.sql`.
3. **Authentication > Sign In / Providers > Email:** keep Email enabled and turn **off** "Allow new users to sign up". Logins are created only by the script.
4. **Project settings > API Keys:** note the **publishable key** (`sb_publishable_...`, safe for the website) and the **secret key** (`sb_secret_...`, only for the login script on your computer). The Project URL is under **Project settings > Data API** (`https://YOUR_PROJECT_REF.supabase.co`). Never put the secret key in the site or in GitHub. (Older projects show `anon` and `service_role` keys instead; they work the same way.)

### 2. Claude assistant function (not needed now)

The site uses Ask Copilot instead, so skip this step. It only matters if you set `AI_PANEL=true` in `web/index.html` to bring back the in-page Claude panel.

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

This creates `ceo` (CEO, read only), `corpdev1` and `corpdev2` (Corp Dev, can edit) and prints their passwords once. Send each one privately; people can change their own password after signing in.

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

### 5. Change history (recommended)

In the **SQL editor**, run `supabase/migrations/0003_history.sql` once. From then on every change to a deal or banker is recorded (who, which field, from what, to what, when). It shows in each deal and banker drawer and in "What changed" on the CEO view. Logins can read the history; nobody can edit or delete it. Before you run it, the site shows recent updates only.

### 5a. CEO questions on deals (recommended)

In the **SQL editor**, run `supabase/migrations/0005_ceo_questions.sql` once. The CEO can then ask a question on any deal from its drawer (and follow up). Corp Dev sees open questions flagged on the Deals tab (an **Open questions** filter and a tag on the deal), replies from the deal, or marks a question answered. The CEO view shows the same tag, and replies appear live. The rule lets any login add only a question, on a deal, in their own name; the CEO still can't edit or delete anything. Until it's run, the CEO sees a message asking Corp Dev to run it.

Also on deals: **Add to calendar** next to each next step (in the deal, the editor and Next 30 days) and next to peers' upcoming earnings calls on Comps downloads a calendar file that Outlook opens. The board pack has one slide per deal at LOI or in diligence.

### 6. Weekly email digest (optional)

Every Monday morning the CEO and Corp Dev get an email with overdue next steps, stalled deals (no update or note in 30 days), next steps due that week, bankers not contacted in 90 days and, with the change history on, what changed. Each item links to the record on the site.

1. Create an account at [resend.com](https://resend.com), verify your company's sending domain, and create an API key.
2. Set the function's secrets. `DIGEST_SECRET` is any long random string (at least 24 characters); keep a copy for step 4.

   ```bash
   supabase secrets set DIGEST_SECRET=CHOOSE_A_LONG_RANDOM_STRING RESEND_API_KEY=re_... DIGEST_FROM="Deal desk <dealdesk@yourco.com>" DIGEST_TO="ceo@yourco.com,corpdev1@yourco.com,corpdev2@yourco.com" SITE_URL=https://YOUR_GITHUB_USER.github.io/REPO_NAME/
   ```

3. Deploy it. `--no-verify-jwt` is safe: the function refuses any call without the secret.

   ```bash
   supabase functions deploy digest --no-verify-jwt
   ```

4. Preview it without sending anything:

   ```bash
   curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/digest?dry=1" -H "x-digest-secret: YOUR_DIGEST_SECRET"
   ```

   Drop `?dry=1` to send one now.
5. Schedule it: open `supabase/digest_schedule.sql`, replace the two placeholders (your project URL and the same `DIGEST_SECRET`), and run it in the SQL editor. It sends on Mondays at 07:17 UTC; edit the schedule line to change that.

### 7. Public comps from Kensho and the AGL financials link (optional)

The **Comps** tab shows listed specialty insurance peers (revenue, premiums, premium growth, net income, loss ratio, combined ratio, ROE, book value per share growth, market cap, P/B, P/E, earnings call dates), with medians. A toggle switches between the latest quarter, year to date (YTD) and the last twelve months (LTM); each browser remembers its choice, and the CEO view strip and board pack follow it. The CEO view shows the peer medians and the board pack gets a peers slide. Data comes from S&P Global through Kensho's API (kfinance). With section 7c done, the last fetch is saved and pages open from it; Kensho is asked again only when someone clicks **Refresh from Kensho**. You need Kensho API access (kfinance) for your firm; ask your S&P Global / Kensho contact.

1. **SQL editor:** run `supabase/migrations/0004_settings.sql` once. It holds the peer list and the AGL financials link (the link only; AGL's financials are not stored). Without it the page uses a default peer list.
2. Give the function Kensho credentials, either a refresh token:

   ```bash
   supabase secrets set KENSHO_REFRESH_TOKEN=...
   ```

   or, for ongoing use (Kensho recommends it), a key pair. Make it on a Mac, keeping the files outside this folder:

   ```bash
   mkdir -p ~/.kensho && cd ~/.kensho
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out kensho-private.pem
   openssl pkey -in kensho-private.pem -pubout -out kensho-public.pem
   KID=$(uuidgen | tr 'A-Z' 'a-z')
   N=$(openssl rsa -pubin -in kensho-public.pem -noout -modulus | cut -d= -f2 | tr -d '\n' | perl -pe 's/([0-9a-fA-F]{2})/chr(hex($1))/ge' | base64 | tr -d '\n=' | tr '+/' '-_')
   printf '{"kty":"RSA","alg":"RS256","use":"sig","kid":"%s","e":"AQAB","n":"%s"}\n' "$KID" "$N" > public-key.json
   echo "Key ID: $KID"
   ```

   Email `public-key.json` (never the private key) to support.datafeed.mi@spglobal.com, asking to be added to the `users_kfinance` group. Kensho replies with your Client ID (allow up to three business days). Then save the Client ID, the Key ID printed above (it is also the `kid` in `public-key.json`) and the private key; it must be PKCS#8 (`BEGIN PRIVATE KEY`, as `openssl genpkey` makes it; convert a `BEGIN RSA PRIVATE KEY` file with `openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem`):

   ```bash
   supabase secrets set KENSHO_CLIENT_ID=... KENSHO_KEY_ID=... KENSHO_PRIVATE_KEY="$(cat ~/.kensho/kensho-private.pem)"
   ```

3. Deploy it. `--no-verify-jwt` is safe: the function checks the caller's login itself (CEO and Corp Dev logins).

   ```bash
   supabase functions deploy comps --no-verify-jwt
   ```

4. On the site, open **Comps**, then **Edit peers** to set the tickers (London listings as `LSE:HSX`) and paste the **AGL financials** link (for example the SharePoint file). The link then appears on the Comps tab and in the CEO view.

Ratios are calculated by the function from the reported figures and labelled "(derived)". ROE is annualised in the quarter and YTD views; P/E always uses twelve-month net income. Combined ratio = operating expenses excluding non-insurance businesses / premiums (S&P has no combined ratio line, so it can differ from the ratio a company reports). BVPS growth = equity / shares outstanding at the latest quarter end versus a year earlier, before dividends. Each company shows its own latest fiscal period, so period ends can differ; P/B and P/E are left blank where the market cap and the accounts are in different currencies.

### 7a. Claude chat on the Comps tab (optional)

The Comps tab gets an **Ask Claude about these comps** box for every login (CEO and Corp Dev). Claude answers from S&P Global data via Kensho only: the Comps table on screen, plus what it looks up itself (the same table for other tickers or periods, or one company's reported statements over up to 12 periods). It never sees deals, bankers or notes, doesn't search the web, and says so when the data doesn't cover a question. Each answer lists what it looked up. It uses Claude Opus 5.5 (set the secret `CLAUDE_MODEL` to change it), with Anthropic's server-side fallback switched on.

Needs section 7 done (Kensho credentials) and an Anthropic API key from [console.anthropic.com](https://console.anthropic.com):

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

```bash
supabase functions deploy comps-chat --no-verify-jwt
```

`--no-verify-jwt` is safe: the function checks the caller's login itself. It uses the same `ALLOWED_ORIGIN` secret as the other functions. The comps function shares its Kensho code, so after pulling this change also redeploy it: `supabase functions deploy comps --no-verify-jwt`.

Cost: each question is billed to your Anthropic account (a few cents; more when Claude looks things up). Check that Ascot's Kensho / S&P Global licence allows its data to be sent to an AI provider before switching this on.

### 7b. League table on the Banker CRM (optional)

The **Banker CRM** tab gets a **Bankers / League table** switch. The league table ranks the firms that advised on M&A deals involving the companies we track: the Comps peers plus any others Corp Dev adds with **Edit companies** (up to 40 in all, by ticker). For each company, Kensho lists its deals as buyer, seller or target; the function then asks for each deal's participants and advisors. The page ranks firms by number of deals, with buy-side and sell-side counts, disclosed US dollar deal value, the latest deals and who we know there from the CRM. Click a firm to see its deals. Switches choose both sides, buy-side or sell-side; banks only (S&P's "financial advisor") or all advisors (lawyers and accountants too); and 1, 3 or 5 years. A banker's drawer and their firm's row show the firm's place in the table.

What it is not: a market-wide league table. Kensho lists deals per company, so only these companies' deals count. S&P records no advisors on many smaller deals (most broker tuck-ins), and deals booked under a subsidiary may not appear under the listed parent. Firm names are grouped across legal entities ("Goldman Sachs & Co. LLC" and "Goldman Sachs International" count as Goldman Sachs).

Needs section 7 done (the Kensho secrets apply to every function) and the settings table (`0004_settings.sql`, for the extra companies). Deploy:

```bash
supabase functions deploy league --no-verify-jwt
```

`--no-verify-jwt` is safe: the function checks the caller's login itself. With section 7c done, the table opens from the last fetch, and **Refresh from Kensho** fetches it again.

### 7c. Save Kensho results, refresh on click (recommended with 7 or 7b)

Without this, the Comps tab, the CEO view's peer strip and the league table ask Kensho every time someone opens them, which can take up to a minute. With it, the comps and league functions save each result in a `kensho_store` table, and pages open at once from the last fetch for every login. Kensho is asked again only when someone clicks **Refresh from Kensho**, when a view has never been fetched (a period or year range nobody has opened), or after the peer or company list is saved. If the list changes another way, the saved figures still show, marked out of date, until someone refreshes. The page says when the figures were last fetched.

1. **SQL editor:** run `supabase/migrations/0007_kensho_store.sql`. Every login can read the table; only the functions can write to it (with the service role key Supabase gives every function, so there is no secret to set).
2. Redeploy both functions: `supabase functions deploy comps --no-verify-jwt` and `supabase functions deploy league --no-verify-jwt`.

The table holds S&P Global data (the Comps rows and the deals and advisors behind the league table), so check that Ascot's Kensho / S&P licence allows keeping it. To clear it, delete its rows in the Table Editor; pages will fetch again on the next visit.

### 8. Copilot chat in the page (optional)

Without this step, Ask Copilot copies a brief and opens Copilot in a new tab. With it, Ask Copilot opens a chat panel in the page that talks to the [Microsoft 365 Copilot Chat API](https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/overview).

Before you start:

- **The API is in preview** (Microsoft Graph `beta`). Microsoft says beta APIs can change and aren't supported for production use. If it changes or stops working, the panel shows the error and **Copy and open Copilot** still works.
- **Each person needs a Microsoft 365 Copilot licence.** That includes the CEO if they'll use it.
- **An Entra admin has to approve the app.** The API only works with all seven delegated Microsoft Graph permissions below. They let the page read, as the signed-in person, what Copilot can already see for them: SharePoint and OneDrive, mail, people, meeting transcripts, Teams chats and channel messages, and connector content. The page only calls the Copilot Chat API with them, and tokens stay in the browser tab's memory.

Steps (Entra admin):

1. **Entra admin center > App registrations > New registration.** Name it "Ascot deal desk", choose **Accounts in this organizational directory only**, and set the redirect URI platform to **Single-page application (SPA)** with `https://YOUR_GITHUB_USER.github.io/REPO_NAME/auth.html`. Add `http://localhost:8080/auth.html` too if you test locally.
2. **API permissions > Add a permission > Microsoft Graph > Delegated:** `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All`, `ExternalItem.Read.All`. Then **Grant admin consent for Ascot**.
3. Optional: **Enterprise applications > Ascot deal desk > Properties:** set **Assignment required** to Yes, then add the CEO and Corp Dev people under **Users and groups**.
4. Copy the **Application (client) ID** and **Directory (tenant) ID** from the app's Overview. Neither is a secret, and the app needs no client secret.
5. **GitHub > Settings > Secrets and variables > Actions > Variables:** add `COPILOT_CLIENT_ID` and `COPILOT_TENANT_ID`, then rerun the "Deploy site to GitHub Pages" workflow.

To test locally, put the same two IDs in `web/config.js` as `copilotClientId` and `copilotTenantId`. Remove both variables to switch back to copy-and-open.

### 9. Teams group chat on the Deals tab (optional)

The card appears only in production: on the Deals tab, for a Corp Dev login that can edit live data. It never appears on the CEO view, for the CEO login, in view-only mode or with example data. It doesn't need the Copilot setup in step 8.

**Link only (no IT needed).** In Teams, right-click the group chat and choose **Copy link**. In **GitHub > Settings > Secrets and variables > Actions > Variables**, add `TEAMS_CHAT_ID` and paste either the link or the chat ID inside it (`19:...@thread.v2`). You can also add `TEAMS_CHAT_NAME` for the heading, for example `The Strategizers`. Then rerun the deploy workflow. The card shows an **Open in Teams** button. Corp Dev logins also get a **Team chat** button in the header, next to Ask Copilot, that opens the chat in Teams ("Teams" on phones); the CEO login doesn't.

**Messages in the page (needs a Microsoft app).** To show the latest messages in the card:

1. **Entra admin center > App registrations > New registration.** Name it "Ascot deal desk", choose **Accounts in this organizational directory only**, and set the redirect URI platform to **Single-page application (SPA)** with `https://YOUR_GITHUB_USER.github.io/REPO_NAME/auth.html`.
2. **API permissions:** add Microsoft Graph > Delegated > `Chat.Read`. It's the only permission the card uses. Depending on Ascot's Entra settings, people may be able to approve it for themselves the first time they sign in, or IT may need to **Grant admin consent**.
3. Add the app's **Application (client) ID** as `MS_CLIENT_ID` and its **Directory (tenant) ID** as `MS_TENANT_ID` (repository variables), then rerun the deploy workflow.

People then click **Sign in with Microsoft** on the card. It shows the 10 latest messages, with up to 30 behind **Show more**. Shared files appear as links, and images as "[image]". It refreshes every 30 seconds while the Deals tab is open in a visible tab. It's read only, so replies happen in Teams. People who aren't in the chat see a message saying they can't read it. Nothing from the chat is stored in Supabase or in the browser.

If step 8's Copilot app is set up instead, the card uses that app and no `MS_` variables are needed.

### 10. Keep Supabase awake, and back up to your computer (recommended)

**Keep awake.** The Supabase free tier pauses a project after about a week with no activity. Run `supabase/migrations/0006_keepalive.sql` once in the **SQL editor**. The **Keep Supabase awake** workflow (`.github/workflows/keepalive.yml`) then calls it every day at 06:41 UTC with the publishable key the site already uses. It reads and stores no tracker data. A red run means Supabase didn't answer: open the Supabase dashboard and restore the project if it paused. You can also run it by hand from **Actions > Keep Supabase awake > Run workflow**. GitHub turns scheduled workflows off after 60 days without any commit to the repository; if that happens, it says so on the Actions tab with a button to turn it back on.

**Back up.** The free tier keeps no backups, so make your own, weekly is a good habit. Backups stay on your computer; never put them in this folder or on GitHub (`.gitignore` blocks `backups/` and `*.enc` as a guard, and the script refuses to write inside the repository folder). With the same two variables as the logins script:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co SUPABASE_SECRET_KEY=sb_secret_YOUR_KEY npm run backup
```

It asks for a passphrase (12+ characters, typed twice, not shown) and writes one encrypted file (AES-256-GCM, key from your passphrase by scrypt) to `~/Documents/ascot-deal-desk-backups/`, with profiles, deals, bankers, notes, the change history and settings. Use `npm run backup -- --out <folder>` to choose another folder. **Keep the passphrase safe**: without it the file can't be opened. Logins' passwords aren't included (Supabase keeps them separately).

To restore:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co SUPABASE_SECRET_KEY=sb_secret_YOUR_KEY npm run restore -- ~/Documents/ascot-deal-desk-backups/ascot-deal-desk-YYYY-MM-DD-HHMM.enc
```

It asks for the passphrase, shows how many rows of each table the file holds, and writes only after you type `restore`. Rows are upserted by id: records in the backup replace those with the same id, and anything added since is left alone (nothing is deleted). The change history stays in the file for reference but isn't written back, because it's the audit log. Restoring into a new project: create the logins first with `npm run logins`, then restore.

## Running locally

Fill in `web/config.js` with the Project URL and publishable key, then:

```bash
npm run serve
```

Open http://localhost:8080. Add `http://localhost:8080` to `ALLOWED_ORIGIN` (comma-separated values are not supported; use `*` while testing) if you turn the Claude panel back on.

## Notes

- **Data model:** each deal, banker and note is a JSON document (`id`, `doc`) so fields can change without migrations. `updated_at` and `updated_by` are stamped by the database.
- **Live updates:** open pages refresh within a second when anyone saves, through Supabase Realtime.
- **SharePoint links** are stored as links. Opening one still needs SharePoint access to that file.
- **Costs:** Supabase free tier; GitHub Pages free; Ask Copilot uses your Microsoft 365 Copilot licences (the Chat API is included with them); nothing is billed through this site.
