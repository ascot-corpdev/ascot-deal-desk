# Ascot deal desk

M&A deal tracker and banker CRM for Corporate Development, styled on the Ascot PPT template.

- **CEO view (read only):** pipeline headline, stat tiles, pipeline by stage, next 30 days, deal summaries with each deal's profile and other docs (SharePoint links), what changed, outcomes and peer benchmarks.
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
| `supabase/functions/digest` | Supabase Edge Function | Optional weekly email digest (overdue, stalled, due this week, cold bankers, what changed), sent through Resend on a Supabase Cron schedule (`supabase/digest_schedule.sql`). |
| `supabase/functions/comps` | Supabase Edge Function | Optional public comps from S&P Global via Kensho (kfinance) for the Comps tab, CEO view and board pack. Credentials stay in its secrets; nothing is stored. |
| `supabase/functions/claude` | Supabase Edge Function | Not used by the site at present (the Claude panel is switched off with `AI_PANEL` in `web/index.html` in favour of Ask Copilot). Kept so it can be turned back on. |
| `scripts/logins.mjs` | Your machine | Creates, resets and removes logins with the Supabase service role key. |
| `web/auth.html` | GitHub Pages (static) | Return page for "Sign in with Microsoft" in the Ask Copilot panel. Hands the sign-in back to the tracker tab and closes. |
| `.github/workflows/pages.yml` | GitHub Actions | Writes `web/config.js` from repository variables and publishes `web/` to Pages. |

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

The **Comps** tab shows listed specialty insurance peers (revenue, premiums, premium growth, net income, loss ratio, combined ratio, ROE, book value per share growth, market cap, P/B, P/E, earnings call dates), with medians. A toggle switches between the latest quarter, year to date (YTD) and the last twelve months (LTM); each browser remembers its choice, and the CEO view strip and board pack follow it. The CEO view shows the peer medians and the board pack gets a peers slide. Data comes from S&P Global through Kensho's API (kfinance), fetched when someone opens the page and never written to the database. You need Kensho API access (kfinance) for your firm; ask your S&P Global / Kensho contact.

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
