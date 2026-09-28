# Market Tide — Complete Project Handoff

Prepared: **28 September 2026**, India Standard Time (UTC+05:30).  
Code inspected: **`bb7c98f` — Let R2 verification runs finish**.  
Latest supplied production screenshots: **27 September 2026**; no fresh production audit was performed for this documentation task.  
Purpose: give a new developer or AI the context needed to continue without the earlier chat.

### Follow-up investigation — 28 September 2026

This update supersedes the earlier unknown-root-cause discussion below. Authenticated GitHub logs now prove that `R2_ACCOUNT_ID` contained the full endpoint URL. The writer consequently constructed a malformed `https://https:/...r2.cloudflarestorage.com.r2.cloudflarestorage.com/...` destination. The latest completed run checked before the fix had 13 archive warnings and no successful archive lines. The apparently successful smoke-step status was misleading because the workflow uses `continue-on-error`.

Only the GitHub `R2_ACCOUNT_ID` secret was corrected, at `2026-09-28T05:52:56Z`. The other credentials and bucket settings were not changed. A bounded normal publishing run was dispatched with `days=0`, `max_summaries=1`, and `loop_seconds=0`: [run 36383924586](https://github.com/markettide/filed/actions/runs/36383924586). It completed successfully. Authenticated logs confirm 12 accepted R2 uploads: one `system` object, seven insider-trading snapshots (22–28 September), and four bulk/block snapshots (22–25 September). This proves uploads now work; production object readback has not yet been performed.

No announcement snapshot was uploaded in that bounded test: the data-protection guard kept the stored day with 16 summaries instead of replacing it with the test's one-summary result. The BSE request also logged a JSON decoding failure. Do not bypass that guard with `--force`; archive the fuller retained dataset or verify a normal complete pass next. The normal publishing workflow ran with its existing MongoDB/feed updates; no database was deleted or manually rewritten.

Local, not-yet-pushed changes now validate account-ID format, trim surrounding configuration whitespace, bound S3 connection/read timeouts, and add payload readback to the smoke tool. Eleven archive tests and two Mongo adapter tests passed. Production is still running the earlier code; the configuration correction is already applied independently. Do not mistake the new local readback test for a production readback result.

### Quick navigation

- [Current status](#4-status-what-is-done-versus-what-is-not-proven)
- [Source-code map](#6-source-code-map)
- [MongoDB storage and retention](#8-mongodb-data-model-and-retention)
- [Unresolved R2 problem and diagnosis](#10-the-unresolved-empty-bucket-problem)
- [Configuration inventory](#12-configuration-inventory--names-only-never-values)
- [Development setup and tests](#13-set-up-another-development-environment)
- [Next-work roadmap](#14-next-work-plan-safe-order-of-implementation)
- [Continuation brief for another AI/developer](#19-ready-to-use-continuation-brief)

### Next-phase preparation — retained-data preservation

Implemented locally (not yet pushed or run in write mode):

- `tools/archive_retained_market_data.py`: default read-only inventory; explicit `--write` copies market-only documents from `redis_mirror` to R2 and verifies both bytes and decoded payloads.
- `.github/workflows/archive-retained.yml`: dedicated manual workflow with `write=false` by default and no scraper, alert, newsletter, or MongoDB write step.
- `tests/test_archive_retained.py`: 21 safety tests; alongside 11 R2 and 2 Mongo adapter tests, all 34 passed.

A live read-only inventory on 28 September found 55 dataset/day snapshots, all structurally reconstructable at capture time:

| Dataset | Dates discovered | Range | Records |
| --- | --- | --- | --- |
| Announcements | 18 | 11–28 September 2026 | 3,651 important + 8,705 other |
| Bulk/block deals | 14 | 7–25 September 2026 | 557 |
| Insider trading | 23 | 6–28 September 2026 | 914 |

These are retained records, not a completeness guarantee against the exchanges or proof of continuous date coverage. The exporter discovers keys even outside live indexes and preserves expired-but-not-yet-deleted documents. It reads MongoDB directly without creating indexes or changing TTLs.

Copies go under `retained/<dataset>/YYYY/MM/DD/<sha256>.json.gz`, separate from live daily objects. Each contains exact source values/metadata plus a reconstructed normal payload when valid. A checksum-addressed key is reused only if its bytes match. Raw incomplete days are preserved but flagged incomplete; changed source captures are rejected for retry. Two matching reads are not a multi-document transactional snapshot. Every write is read back, and a run manifest is stored in `retained/manifests/`. The local report is `retained-archive-report.json` (gitignored).

Commands from repository root with private environment configuration:

```text
python tools/archive_retained_market_data.py
python tools/archive_retained_market_data.py --write
python tools/archive_retained_market_data.py --dataset announcements --from-date 2026-09-11 --to-date 2026-09-28
```

`--write` is required for copying; otherwise no R2 credentials are needed and R2 is not contacted. Errors/incomplete days return a nonzero exit code, with partial progress retained in the report when possible. The script does not request old exchange data, generate AI summaries, shorten Mongo retention, or send messages. Source documents remain untouched. A 2023–present backfill is still a later phase.

Next execution step: obtain the requested approval to push these changes to `main`, then run the dedicated workflow first in inventory mode and then in copy mode. GitHub already holds R2 credentials, while the local environment does not. Do not claim these 55 snapshots have been copied until the write-mode report and readbacks prove it.

## 1. Read this first

Market Tide is a live Indian stock-market filings product. It collects NSE/BSE announcements, filters routine paperwork, extracts and summarises important filings, and provides a website, daily brief, insider-trading and bulk/block-deal views, company watchlists, and Telegram alerts.

**The immediate task is to get Cloudflare R2 archiving verifiably working. After that, build a safe historical archive and website access for announcements, bulk/block deals, and insider trading from 2023 to the present.**

The current architecture is:

```text
NSE / BSE public filings and trading disclosures
                       |
              GitHub Actions + Python
       collect -> filter -> extract -> summarise
                       |
             +---------+-------------------+
             |                             |
        MongoDB Atlas                Cloudflare R2
     Live application data       Compressed daily snapshots
      and recent market data     CODE ADDED; CONTENTS UNVERIFIED
             |
        Vercel / Next.js
     Website + authenticated APIs
             |
      Telegram / email integrations
```

Important distinctions:

- Redis/Upstash has been removed from the inspected production runtime code. MongoDB is the live database.
- `redis_mirror` is a **MongoDB collection name**, not a remaining Redis service. Do not delete or rename it casually.
- Cloudflare R2 is currently an **additional market-data archive**, not a replacement for MongoDB or Vercel.
- R2 upload code exists, but the latest supplied dashboard screenshot still shows an empty bucket. **Do not say the Cloudflare migration is complete.**
- No complete 2023–present import or historical website reader has been implemented or verified.
- Existing data, customer accounts, subscriptions, watchlists, and current website behaviour must be preserved.

This file supplies project context, not a copy of the source code or access credentials. A new environment still needs repository access and secrets supplied privately by the owner. Do not put secrets into this document, chat, screenshots, or Git.

## 2. Owner priorities and intended outcome

The owner wants:

1. No data loss during migrations or maintenance.
2. Low operating costs, using free allowances where practical without pretending that growth is unlimited or always free.
3. A working live website throughout the transition.
4. Complete independence from Redis/Upstash for normal application operation.
5. Long-term retention of announcements, bulk/block deals, and insider-trading data, starting in 2023.
6. The ability to view/search that history on the website, not just files sitting in a storage bucket.
7. Simple Telegram connection and reliable alerts for followed companies.
8. Clear, non-technical explanations and step-by-step dashboard instructions when owner action is needed.

The owner explored whether Cloudflare could replace both database and hosting. That is **not the architecture implemented so far**. Do not turn the current R2 archive task into an unsolicited full hosting/database rewrite. Moving private application data, adopting D1, or moving Next.js from Vercel would be separate decisions.

## 3. Repository, website, and working-copy identity

| Item | Value / guidance |
| --- | --- |
| Repository | [markettide/filed](https://github.com/markettide/filed) |
| Production website | [www.markettide.in](https://www.markettide.in) |
| Alternate public address | [markettide.in](https://markettide.in), previously observed redirecting to the `www` host |
| Vercel project | `filed`; application root directory is `web` |
| GitHub Actions | [Workflow runs](https://github.com/markettide/filed/actions) |
| Scraping workflow | [Scrape announcements](https://github.com/markettide/filed/actions/workflows/scrape.yml) |
| MongoDB database | `market_tide`, unless overridden by `MONGODB_DB` |
| Cloudflare bucket | `market-tide-archive`, Standard storage, public access disabled in screenshots |
| Current source checkout on original computer | `C:\Users\Shubh Tanna\Documents\ChatGPT\markettide\cron-push-worktree` |
| Local branch at handoff | `dev`, at `bb7c98f`, ahead of its `origin/dev` tracking reference by 23 commits |

The latest work was previously pushed to remote `main` using the current checkout. **Do not infer production state from the local branch name.** Verify remote `main`, the Vercel production deployment, and the actual commit checked out by the running workflow before further deployment.

Other folders on the original computer, including `filed-main` and `filed-deploy`, are older working copies. The local `main` branch in `filed-main` is stale relative to this handoff. Do not copy those versions over the current code or force-push to resolve this naming mismatch.

For a new machine, clone the repository and inspect its latest remote state. For this existing computer, inspect the current working tree before pulling, switching branches, or modifying anything. Preserve unrelated changes. The inspected checkout was clean before adding this handoff document; this document itself is not committed or pushed by its creation.

## 4. Status: what is done versus what is not proven

“Code-confirmed” below means inspected source, not a fresh end-to-end audit of all production services.

| Area | Status at handoff |
| --- | --- |
| Next.js website and Python data pipeline | Implemented; live product exists |
| OTP/login moved off Upstash | Code-confirmed MongoDB storage; email delivery still depends on its provider |
| Market-data publishers and website reads on MongoDB | Code-confirmed |
| Brief storage, rate limits, broadcast state, traffic state off Redis | Code-confirmed |
| Watchlists and Telegram connection state on MongoDB | Code-confirmed |
| Removing Upstash runtime credentials from workflows/code | Commit `f9b5448` implements this |
| Actual deletion/cancellation of old Upstash database/integration | Not independently confirmed; inspect provider settings before claiming billing stopped |
| R2 bucket creation | Shown in owner screenshots |
| Four R2 secrets configured in GitHub | Reported during setup; values/scopes/destination still require verification |
| R2 writer wired into all three market-data publishers | Code-confirmed in `996d318` |
| R2 smoke-check workflow step | Added in `bb7c98f`; an earlier investigation recorded a successful step |
| Actual readable production R2 market-data objects | **Not verified; latest owner screenshot shows no objects** |
| 2023–present backfill | Not implemented or run |
| Website reading historical R2 data | Not implemented |
| MongoDB application data moved to Cloudflare | Not done and not required for current archive phase |
| Website hosting moved to Cloudflare | Not done |

The owner previously reported that the website was working after the MongoDB transition. Earlier Mongo screenshots showed migrated documents and later new `source: "announcements"` writes. That supports historical progress, but document counts and screenshots are not substitutes for current read/write and completeness checks.

## 5. Technology stack

- Frontend/server: Next.js App Router, React, JavaScript, CSS, deployed to Vercel.
- `web/package.json`: Next `^15.1.0`, React/React DOM `^19.0.0`, MongoDB driver `^6.21.0`, ExcelJS `^4.4.0`, Vercel Analytics `^2.0.1`. The lockfile determines actual installed versions.
- Data jobs: Python; GitHub workflow uses Python 3.12.
- Python requirements include `requests`, `pypdf`, `pymongo`, and `boto3`.
- Website CI uses Node 20.
- AI summary providers: Groq, Gemini, and OpenRouter integration. Configuration, selected models, and quotas must be inspected rather than assumed from old README pricing/model examples.
- MongoDB Atlas: application state and Redis-shaped live market-data records.
- Cloudflare R2: S3-compatible object storage used by Python `boto3` for gzip JSON archives.
- Telegram Bot API: connection, confirmation, and company alerts.
- Resend: current transactional email implementation, including OTP/contact messages.
- Kit: newsletter subscription/broadcast integration code.
- Substack: current brief workflow is configured to prepare for manual newsletter scheduling, not to automatically publish to Substack.
- Cashfree: one-time paid Premium checkout.

The package name `market-tide-waitlist` and the “one-page waitlist” introduction in `web/README.md` are legacy names. This is now a full application.

## 6. Source-code map

All paths in the following tables are repository-relative, so they remain useful after cloning elsewhere.

### Data collection and publishing

| Path | Responsibility |
| --- | --- |
| `sources.py` | NSE/BSE announcement collection and source-session behaviour |
| `pipeline.py` | Collection/processing orchestration |
| `rules.py`, `triage.py` | Category/importance rules and filtering |
| `dedupe.py` | Duplicate handling |
| `summarize.py`, `providers.py` | PDF extraction, AI summaries, provider routing/budgets |
| `mcap.py` | Market-cap data used by the pipeline |
| `publish.py` | Recent announcement publication to MongoDB, plus R2 snapshot hook |
| `insider.py`, `publish_insider.py` | Insider-trading ingestion/publication and archive hook |
| `deals.py`, `publish_deals.py` | Bulk/block-deal ingestion/publication and archive hook |
| `mongo_mirror.py` | MongoDB adapter preserving the old GET/MGET/SET/DEL data shape |
| `r2_archive.py` | Optional compressed R2 snapshot writer |
| `newsletter.py` | Daily brief selection, HTML/PDF generation, MongoDB publication, optional delivery |
| `run.py`, `dashboard.py` | Older local HTML-dashboard entry point, distinct from production publishing |

### Website

| Path | Responsibility |
| --- | --- |
| `web/app/layout.jsx`, `Nav.jsx`, `SiteAuth.jsx` | Site shell, navigation, account state |
| `web/app/AuthGate.jsx`, `PremiumGate.jsx` | Sign-in and Premium UI access gates |
| `web/app/FilingCard.jsx`, `fmt.js` | Filing display and formatting |
| `web/lib/announcements.js`, `insider.js`, `deals.js` | Market-data readers |
| `web/lib/market-mirror.js`, `server-cache.js` | Mongo market-key reads and short-lived server caching |
| `web/lib/otp.js`, `session.js`, `users.js` | OTPs, signed sessions, user profiles |
| `web/lib/entitlements.js` | Free/trial/paid access rules |
| `web/lib/cashfree.js`, `payments.js` | Payment verification and durable payment state |
| `web/lib/watchlist.js`, `companies.js` | Watchlists, company catalogue lookup, matching |
| `web/data/companies.json` | Committed company catalogue; rebuild tool is `tools/build_company_list.py` |
| `web/lib/telegram.js` | Bot names/links, login payload verification, messages |
| `web/app/watchlist/page.jsx`, `web/app/watchlist.css` | Watchlist interface |
| `web/lib/operational-state.js`, `rate-limit.js` | Expiring operational state, broadcast claims, link tokens |
| `web/lib/brief.js`, `brief-access.js`, `brief-worker-auth.js` | Brief reads/access and purpose-specific worker authentication |
| `web/lib/notify.js`, `kit.js`, `kit-broadcast.js` | Transactional email and newsletter integrations |
| `web/lib/engagement.js`, `admin-data.js`, `admin-trials.js` | Visits, admin reporting, trial analytics |
| `web/lib/admin-auth.js` | Private admin authentication |

### Operations and testing

| Path | Responsibility |
| --- | --- |
| `.github/workflows/scrape.yml` | Live publishing, checks, secondary feeds, alert dispatch, handover |
| `.github/workflows/brief.yml` | On-demand PDF worker |
| `.github/workflows/web.yml` | Website install, auth test, build |
| `.github/workflows/connectivity.yml` | Source connectivity diagnosis |
| `web/vercel.json` | Vercel daily brief cron |
| `tools/check_r2_archive.py` | Writes an R2 `system` smoke object; currently no readback |
| `tools/verify_live.py` | Public pages and authenticated market-API checks |
| `tools/ensure_brief.py` | Brief watchdog/worker dispatch |
| `tools/audit_categories.py`, `reconcile_feeds.py` | Data quality checks |
| `tools/migrate_redis_to_mongo.py` | Legacy migration/audit utility, not a normal runtime dependency |
| `tests/`, `web/tests/` | Python and Node regression tests |
| `web/.env.example`, `config.example.json` | Non-secret configuration examples |

## 7. Product behaviour and important routes

### Reader experience

- `/`: marketing/home page.
- `/login`, `/join`, `/subscribe`: sign-in/onboarding and subscription-related flows.
- `/dashboard`, `/sme`: corporate filing views.
- `/brief`, `/brief/<day>`: daily brief page and PDF delivery.
- `/insider`, `/deals`: trading-disclosure views.
- `/watchlist`: saved companies, matching recent filings, Telegram settings.
- `/profile`, `/pricing`, `/payment/return`: account, plans, checkout return.
- `/contact`, `/privacy`, `/terms`, `/refund`: support/legal pages.
- `/control/<ADMIN_PATH_TOKEN>`: private admin entry; never include the actual token in a handoff or public URL.

### Authentication, trials, and payments

- Passwordless email login uses a six-digit OTP. New-reader onboarding collects a phone number; successful verification saves the profile. Returning readers use email.
- OTP state and limits are in MongoDB, not Redis. An empty OTP collection after expiry/consumption is normal; it does not prove OTP storage is broken.
- `mt_session` is a signed session cookie, normally valid for 30 days. Changing `SESSION_VERSION` invalidates older sessions on subsequent requests.
- Eligible accounts can explicitly start one card-free seven-day Premium trial using `/api/trial/start`.
- Premium is active when a valid paid term or trial is active. Access is checked server-side; hiding a frontend button is not sufficient protection.
- The inspected paid plan is **₹299 once for three months**, not a recurring automatic debit. `PREMIUM_PRICE` and `PREMIUM_MONTHS` are in `web/lib/cashfree.js`.
- Cashfree order creation, status confirmation, raw-body webhook signature verification, and idempotent activation are server-side. Never trust a browser-only “payment successful” result.
- Sandbox is the code default unless `CASHFREE_ENV=production`. Production account/provider status must be checked separately.
- Daily Brief remains the free newsletter offering; premium market tools are gated. Preserve existing entitlement rules when adding historical access.

### Watchlist and Telegram

- Free account: 5 companies; trial or paid Premium: 50.
- Watchlists are stored on `users` as `portfolio`, not a separate Redis list. Existing `portfolio` field names are intentionally retained.
- Entries include ISIN, company/ticker information, a normalized matching key, and date added. Adds use server-side company catalogue data, not arbitrary user-supplied company names.
- On plan downgrade, excess entries are parked in `portfolioOverflow`, not simply deleted. They can be restored when the limit increases.
- Website matching uses the current filings feed; saving a company does not invent filings or request a 2023 history backfill.
- Latest connection UX uses Telegram's signed Login Widget with messaging permission. The callback verifies the payload, sends a confirmation, then saves the linked Telegram details to the signed-in user's MongoDB profile.
- Bot username normalization fixes earlier double-`@`/bad-link problems. Older `/start` deep-link and webhook routes remain in the code.
- BotFather's login domain must match the canonical production host, documented as `www.markettide.in`.
- `/api/watchlist` reports the saved connection status. A one-time success banner alone is not proof that a later refresh reads the persisted link correctly.
- The owner prefers a simple connect flow, comparable to clicking a bot link and pressing Start once. Do not reintroduce mandatory command-copying as the default UX.

Alert behaviour is narrower than “every filing is sent instantly”:

1. `/api/cron/alerts` reads the important-filings feed after the scraper workflow reaches its alert step.
2. A filing must have a summary and normally be no older than 36 hours.
3. The company must match a saved watchlist key.
4. The reader must have active Premium/trial access, a linked chat, and alerts enabled.
5. The current cap is 15 messages per reader per run. Recent filing IDs are stored for deduplication, capped at 300 IDs.
6. There is no exchange push connection or guaranteed instant delivery. Scrape/summary/job timing matters.

**Known alert reliability concern discovered during this handoff:** after attempting sends, the route marks all `due` IDs, not just successful sends. This intentionally discards over-cap items, but also appears to mark failed/unattempted items after a send error. Concurrent alert runs also lack a visible per-message atomic send claim. Therefore “nothing is missed or duplicated” is not a verified guarantee. Review/test this before promising reliable historical or high-volume notifications. This documentation task did not change that code.

### Newsletter, brief, and contact

- Explicit newsletter signup is saved to MongoDB and has Kit audience integration. Keep consent separate from merely logging in.
- `web/tools/export-substack-subscribers.mjs` exports subscribers. Default export is limited to explicit brief-source subscribers; do not bulk-enrol every account without consent.
- Current brief workflow sets `NEWSLETTER_DELIVERY=substack`; `newsletter.py` then prepares the issue for **manual** scheduling, rather than automatically sending it through Substack.
- Optional Kit broadcast code exists in Python and `/api/cron/brief/send`; its existence does not prove a production schedule is configured. Calling the send endpoint can message the audience.
- Current email code uses Resend. The README mention of a future switch to Brevo is not an implemented migration.
- `/api/contact` validates and rate-limits messages, then emails support. The inspected route does **not** save message bodies to a separate MongoDB contact-message collection. The MongoDB migration here concerns rate-limit state, not a newly implemented support inbox.

## 8. MongoDB data model and retention

### Collections

| Collection | Purpose |
| --- | --- |
| `users` | Profiles, newsletter flags, trials/paid access, watchlists, Telegram links, alert history |
| `auth_otps` | Expiring OTP challenges |
| `auth_otp_limits` | OTP send/attempt control |
| `redis_mirror` | Live market keys and brief payloads, despite its legacy name |
| `payment_orders` | Durable payment-order records |
| `payment_webhook_events` | Webhook idempotency/history, with expiry policy |
| `rate_limits` | Shared expiring operational limits |
| `brief_broadcasts` | Broadcast claims/status to prevent repeated scheduling |
| `telegram_link_tokens` | Expiring one-time legacy bot-link tokens |
| `visit_sessions`, `site_visitors`, `site_metrics` | Traffic/session records and aggregate/baseline metrics |

`mongo_mirror.py` uses the configured database, defaulting to `market_tide`. Typical mirror document fields are:

```text
_id        old-style key, such as mt:day:2026-09-27
value      serialized value, often a JSON string
source     writer label, such as announcements, brief, or migration
updatedAt  update timestamp
expiresAt  optional expiry timestamp
```

There is a TTL index on `expiresAt` and an index on `updatedAt`. Readers also check expiry. Do not assume physical TTL deletion happens at the exact expiry instant. Do not accidentally assign expiring cache policies to permanent user/payment records.

### Key families and effective retention

| Data | Keys | Current behaviour |
| --- | --- | --- |
| Important announcements | `mt:day:<date>` and optional chunks/parts | Current rolling 7-day publication window; expiring payload writes use 9-day TTL |
| Other announcements | `mt:all:<date>` and chunks/parts | Same recent publication window |
| Announcement counts/index/meta | `mt:count:<date>`, `mt:index`, `mt:meta` | Index rebuilt from recent stored data; not a historical catalogue |
| Insider trading | `mt:insider:<date>`, index/meta, chunks/parts | Payload TTL 400 days, index capped at 90 dates; actual coverage depends on ingestion |
| Bulk/block deals | `mt:deals:<date>`, index/meta, chunks/parts | Payload TTL 400 days, index capped at 90 dates; actual coverage depends on ingestion |
| Brief PDF | `mt:brief:<date>:<part>`, `:parts`, `mt:brief:index` | Base64 PDF chunks; configured TTL 60 days, **but publishing a new issue explicitly deletes older indexed issues** |

The website's recent display window, the index length, TTL, and actual number of collected days are different concepts. Do not repeat “everything is stored for only seven days” or assume a 400-day TTL means 400 days have already been collected.

Announcement records are split into chunks to avoid oversized individual payloads. Preserve each dataset's reader/writer chunk convention. Do not copy only the index, only the first chunk, or only the part-count key and call that a complete migration.

`publish.py` includes guards against replacing a richer day with a suspiciously smaller scrape. These are helpful but not a transactional backup mechanism. Multi-key publication and parallel writers still need careful consistency handling.

The original Redis-to-Mongo migration retained key names and data shape to reduce disruption. Compatibility functions called `redis()` or `_redis()` now call MongoDB. A text search for “redis” alone will therefore overstate remaining dependencies.

## 9. Cloudflare R2: exactly what has been built

### Implemented archive layout

```text
market-tide-archive/
  announcements/YYYY/MM/DD.json.gz
  insider-trading/YYYY/MM/DD.json.gz
  bulk-block/YYYY/MM/DD.json.gz
  system/YYYY/MM/DD.json.gz
```

- Announcement payload: `schema`, `day`, `important`, `other`, `counts`.
- Insider payload: `schema`, `day`, `trades`.
- Bulk/block payload: `schema`, `day`, `deals`.
- Smoke payload: `schema`, `status`, `checkedAt`.

These are publisher snapshots, not guaranteed unfiltered copies of every original exchange response. They are also not a complete original-PDF archive. Historical preservation needs an explicit decision about raw records, normalized records, summaries, and original attachments.

`r2_archive.py`:

- Requires all four R2 variables; if any is absent it returns `False` without writing.
- Uses `boto3`, S3 Signature V4, region `auto`, and the account's R2 S3 endpoint.
- Produces compact UTF-8 JSON, sorted keys, gzip level 9, and `mtime=0` for deterministic compressed bytes.
- Sets JSON content type, gzip content encoding, and small metadata fields for schema/day/kind.
- Uploads after the associated MongoDB writes in the publishers.
- Logs an `R2 archive:` line on successful `put_object`; catches upload exceptions and logs `R2 archive warning:`.
- Intentionally avoids breaking the live MongoDB publication on an R2 error.

**Limitations:** no durable retry queue, readback verification, completeness manifest, per-date locking, historical reader, or historical backfill. Identical data can be uploaded repeatedly. The daily key is overwritten on repeat writes: despite the module's “append-by-date” wording, this is **not immutable append-only storage or versioned backup**.

`tools/check_r2_archive.py` writes a `system` object and reports success if the upload call succeeds. It does **not** fetch the object back, compare its checksum, or prove that the owner is viewing the same account/bucket.

No private user accounts, OTPs, payment state, or watchlists are intentionally migrated to R2 by this implementation. Public exchange disclosures can themselves contain personal names, so still treat the dataset responsibly.

## 10. The unresolved empty-bucket problem

### Evidence available

1. The owner repeatedly supplied screenshots of the intended bucket with an empty Objects list and `0 B` storage.
2. The latest screenshot around 20:58 IST on 27 September showed 15 Class A and 13 Class B operations, but still no listed objects.
3. Earlier investigation recorded cancellation of some scraping runs. Cancellation can prevent reaching publication, but it was not proven to be the only problem.
4. The R2 smoke-check step in a later manual run was recorded as successful. This conflicts with the empty-bucket view and requires investigation, not another assumption.
5. Authenticated detailed logs and an object readback were not obtained as part of the evidence available to this handoff. One earlier unauthenticated log-download attempt returned 403; that says nothing about R2 credentials.

Relevant runs to inspect:

- [Manual run on the initial archive change](https://github.com/markettide/filed/actions/runs/36325076841): previously observed cancelled during the main scraping step.
- [Manual R2 verification run](https://github.com/markettide/filed/actions/runs/36328690539): associated with `bb7c98f`; earlier inspection recorded the verification step succeeding at approximately 15:12 UTC / 20:42 IST. Its final outcome and actual resulting objects must be rechecked.

Earlier troubleshooting suggestions blamed general API-token versus S3 credentials, and at another point cancellation. **Neither is an established root cause.** Do not preserve those guesses as facts or rotate credentials blindly.

Operation counts do not prove successful scraper uploads: R2 Class A includes listing operations and Class B includes reads/metadata operations. The dashboard itself can contribute activity. A successful write followed by a verified read of the expected object is much stronger evidence. See [Cloudflare's operation classifications](https://developers.cloudflare.com/r2/pricing/).

### Next diagnosis, in order

1. Confirm which Cloudflare account and exact bucket the owner is viewing. Compare with the configured account endpoint and bucket name without exposing secret values.
2. Inspect the actual run logs and the workflow's “which code is running” output. The workflow checks out `main`, so inspect the checkout commit, not only the run title or event SHA.
3. Inspect `Verify the R2 archive connection`, the first `R2 archive:`/`R2 archive warning:` lines, and the stages reached before cancellation.
4. Confirm all four variables are available in the relevant GitHub job. A secret stored in Vercel alone is not automatically available to GitHub Actions. Check repository/environment secret scope and exact names.
5. Confirm credentials are a valid R2 S3 Access Key ID / Secret Access Key pair with bucket-scoped object read/write access. `R2_ACCOUNT_ID` is the Cloudflare account ID, not a token ID. A general API bearer token is not directly interchangeable with the S3 secret passed to `boto3`.
6. With the same credentials and destination as the job, list the known prefix and try `HEAD`/`GET` for the expected `system/YYYY/MM/DD.json.gz`. Use the run's UTC date for the smoke key.
7. If another smoke upload is authorized, use a clearly identifiable harmless test object, then immediately read it back, decompress it, and compare the payload. Never use a customer record as a smoke test.
8. Once the test works, verify a real publisher object: decompress it, inspect its day/schema, compare IDs/counts against the corresponding MongoDB dataset, and record any missing rows.
9. Only then mark live archiving working. If it fails, capture a sanitized exact error such as access denied, signature mismatch, missing bucket, or network failure and fix that demonstrated cause.

Use [Cloudflare's R2 authentication documentation](https://developers.cloudflare.com/r2/api/tokens/) for S3 credentials and bucket-scoped permissions. The provider also documents deriving S3 credentials from suitable API tokens; therefore a screenshot of the generic token screen alone does not establish that the credentials being used are invalid.

Keep public access disabled. Backend credentials can upload/read private objects; making the bucket public is not a fix for writer authentication.

## 11. Workflows and scheduling pitfalls

### Scrape announcements

`.github/workflows/scrape.yml` has UTC schedules at minute 7 and 37 of each hour, plus `18:09 UTC` (23:39 IST) for the nightly path. Inspect the YAML rather than older comments for the actual times. Scheduling is not a promise of exact execution time.

It supports manual inputs:

- `days`: normal path is today; nightly/full-week path uses 7.
- `max_summaries`: `0` means no summary-count cap, not “disable AI.”
- `loop_seconds`: normal blank default is a long-running handover loop; full-week path normally runs without that loop.

Important ordering: install dependencies/tests -> R2 smoke check -> announcement scrape/publish loop -> live verification/data checks -> insider/deal updates -> brief watchdog -> Telegram alerts -> cache/handover work. Several later steps use `always()` or `continue-on-error`.

Operational details that matter:

- Concurrency group is `scrape-${{ github.event_name }}` with cancellation enabled within a group. This separates scheduled and manual runs but allows them to overlap each other.
- Scheduled/manual overlap can cause concurrent writes to the same MongoDB and R2 date keys. There is no demonstrated global per-day write lock or compare-and-swap protection.
- The main loop has a `set +e` wrapper and prints the Python exit code, then can exit successfully. A green step is not proof that every publication succeeded.
- The R2 verification step has `continue-on-error: true`. Read its own result/logs; do not rely on the overall green tick.
- Main scraping can run for hours before the later alert step. Alerts are not invoked inside every inner scrape pass by this workflow.
- **For a genuinely single-pass/no-handover manual run, use `loop_seconds=0`, not `1`.** With `1`, the implementation can still sleep until the next half-hour boundary and its nonzero-loop handover can dispatch another workflow.
- Even `loop_seconds=0` runs later pipeline steps, can publish to live MongoDB, and can send eligible Telegram alerts. It is not a side-effect-free R2 diagnostic.
- `DISPATCH_TOKEN` is used for GitHub workflow handovers. Do not repeatedly dispatch full production jobs just to troubleshoot a bucket.
- Existing publisher `--days` flags are recent-data tools, not a safe multi-year backfill interface. `publish.py` still enforces its current retention cutoff.

### Morning brief

- `web/vercel.json` schedules `/api/cron/brief` at `02:00 UTC` / 07:30 IST.
- The endpoint checks whether today's brief exists, then dispatches `.github/workflows/brief.yml` using `GITHUB_DISPATCH_TOKEN`.
- The GitHub brief workflow itself is dispatch-only. It uses Chrome for PDF generation and uploads PDF artifacts with 14-day retention.
- The scraper's `tools/ensure_brief.py` is an additional watchdog.
- `newsletter.py` currently uses a 07:00 IST selection cutoff; an older workflow comment says 06:45. Use code as the source of truth when reconciling the intended product deadline.
- Current Substack delivery is a manual scheduling path. Do not confuse “PDF generated,” “PDF stored,” and “newsletter sent.”

### Website CI and Vercel deployment

- `.github/workflows/web.yml` installs with `npm ci`, runs `node tests/auth.test.mjs`, and builds the site.
- It does not currently run every file in `web/tests/`.
- Vercel production deployment readiness is separate from a successful GitHub website test. Check the deployed commit and environment scope.
- Changes to provider environment variables generally require a new deployment/process to be used; verify the new deployment, not an old open browser tab.

## 12. Configuration inventory — names only, never values

### Website / Vercel / local Next.js

| Variable | Purpose / notes |
| --- | --- |
| `MONGODB_URI` | Required private connection string |
| `MONGODB_DB` | Database name; default `market_tide` |
| `AUTH_SECRET` | Session signing and authentication secret material |
| `SESSION_VERSION` | Session invalidation version; sample default `premium-trial-2026-09-19` |
| `RESEND_API_KEY` | Transactional email provider |
| `RESEND_FROM` | Verified sender, e.g. `Market Tide <brief@markettide.in>` |
| `REPLY_TO_EMAIL` | Support/reply destination |
| `SEND_WELCOME_EMAILS` | Optional welcome-email behaviour; sample is `false` |
| `KIT_API_KEY`, `KIT_FROM_EMAIL` | Newsletter audience/broadcast integration |
| `TELEGRAM_BOT_TOKEN` | Bot credential, server-only |
| `TELEGRAM_BOT_NAME` | Bot username without `@`; not a secret, but must identify the right bot |
| `TELEGRAM_WEBHOOK_SECRET` | Independent random webhook authentication value |
| `CRON_SECRET` | Authenticates protected cron endpoints; shared with relevant workers |
| `GITHUB_DISPATCH_TOKEN` | Website-to-GitHub workflow dispatch permission |
| `BRIEF_WORKER_SECRET` | Shared worker authentication secret; prefer explicit matching configuration |
| `ADMIN_PATH_TOKEN`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` | Private admin protection |
| `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET` | Payment provider credentials |
| `CASHFREE_ENV` | `sandbox` for testing, `production` only when intentionally configured |
| `CASHFREE_API_VERSION` | Current code default `2025-01-01` |
| `APP_BASE_URL` | Local example `http://localhost:3000`; use intended deployment base for real callbacks |

Optional/legacy signup integrations such as `WAITLIST_WEBHOOK_URL`, export `ADMIN_KEY`, and `SUBSTACK_IMPORT_SOURCES` must be checked against the relevant route/tool before enabling them. Do not blindly restore every historical variable.

Local Next.js configuration belongs in ignored `web/.env.local`. The earlier owner said relevant secrets were placed there; their current values or completeness are not disclosed or revalidated by this document.

### Python / GitHub Actions

| Variable | Purpose / scope |
| --- | --- |
| `MONGODB_URI`, `MONGODB_DB` | Same intended live database as the website |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | AI providers used by the job/configuration |
| `DISPATCH_TOKEN` | GitHub workflow handover/watchdog dispatch; distinct name from Vercel's `GITHUB_DISPATCH_TOKEN` |
| `SITE_URL` | Website target for checks/alerts; current intended host is `https://www.markettide.in` |
| `CRON_SECRET` | Must match Vercel for alert calls |
| `BRIEF_WORKER_SECRET` | Must match website authentication choice when present |
| `NEWSLETTER_DELIVERY` | Current brief workflow explicitly uses `substack` |
| `R2_ACCOUNT_ID` | Cloudflare account ID, not API token ID |
| `R2_ACCESS_KEY_ID` | R2 S3 access-key identifier |
| `R2_SECRET_ACCESS_KEY` | R2 S3 secret; never a public/browser variable |
| `R2_BUCKET_NAME` | `market-tide-archive` |

The R2 writer is a GitHub/Python responsibility today. There is no current R2 website reader requiring these keys in Vercel. For a future reader, prefer a separately scoped read-only credential rather than exposing the writer credential.

Python does not automatically load Next.js `.env.local`. Use a secure environment loader or explicitly supplied process environment. Do not assume a local file, GitHub secret, Vercel secret, and Cloudflare credential are synchronized automatically.

The worker HMAC currently falls back to `MONGODB_URI` when `BRIEF_WORKER_SECRET` is absent. Both sides must choose the same secret. Setting the explicit secret in only one environment can break authenticated live checks/brief generation even if database access works. Never log the URI or derived authorization headers.

Legacy runtime variables removed from normal use include `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, and `REDIS_URL`. Offline migration utilities may still reference historical Redis credentials. Keep secure backups during retirement; do not delete provider data as a substitute for verifying independence.

## 13. Set up another development environment

1. Obtain repository access and clone `https://github.com/markettide/filed.git`.
2. Inspect latest remote `main` and compare it to this handoff's `bb7c98f` baseline. Preserve any newer work.
3. Use Python 3.12 and the Node version used by CI, or deliberately verify compatibility before upgrading.
4. Install Python dependencies from repository `requirements.txt`.
5. In `web`, install the lockfile-pinned dependencies with `npm ci`.
6. Create ignored `web/.env.local` from `web/.env.example`, obtaining real secrets privately. Prefer a separate development MongoDB database and sandbox payment credentials.
7. If using local provider configuration, create ignored `config.json` from `config.example.json`; inspect provider/environment handling before executing a costly scrape.
8. Start Next.js locally. A clean environment should not write production data or send customer alerts by accident.

Example commands, run from the cloned repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci --prefix web
npm run dev --prefix web
```

The local website is normally at `http://localhost:3000`. Supply secrets through private files/settings; no real credentials should be pasted into command examples or committed.

### Tests and verification

Offline Python checks, from repository root:

```powershell
$env:PYTHONPATH = '.'
python -m unittest discover -s tests -p 'test_*.py'
```

Use the virtual environment's Python if dependencies were installed there. For website regression checks, after dependency installation:

```powershell
Get-ChildItem -LiteralPath web/tests -Filter '*.test.mjs' | ForEach-Object {
    node $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "A website test failed." }
}
npm run build --prefix web
```

Existing test coverage includes authentication, sessions, entitlements, payment security, Cashfree, Telegram, watchlist contracts, Mongo market reads, server caches, brief-worker authentication, cron, Kit, and admin/trial behaviour. These are not a substitute for an isolated integration test of live external services.

**Checks actually rerun while preparing this handoff:** 3 tests in `test_r2_archive.py` and 2 in `test_mongo_mirror.py` passed. They use test doubles; this does not prove production credentials or data completeness. The complete website build and all external integrations were not rerun for this documentation-only task.

Useful checks with side effects distinguished:

| Check | Caution |
| --- | --- |
| `python tools/verify_live.py --url https://www.markettide.in` | Network reads; protected API requires matching worker authentication |
| `python tools/check_r2_archive.py` | **Writes/overwrites today's UTC `system` object**; currently no readback |
| Authorized `/api/cron/alerts?dry=1` | Computes matches without sending messages or marking delivery; protect the cron credential |
| `/api/cron/alerts` without dry mode | Can send real customer messages and update delivery markers |
| `newsletter.py --publish` | Writes brief state and removes older indexed brief issues; delivery mode may trigger email |
| Full scrape workflow | Writes market data, may trigger alerts/brief work and successor workflows |
| Migration tools with write flags | Mutate databases; inventory/backup and scope approval first |

Do not use a hard-coded company as an eternal alert test. Earlier the owner used Fortis and Reliance. For a new test, first find a currently stored, recent summarised filing, match its exact company catalogue entry, then use an owner-controlled test account. Use dry mode before any real send and do not message all subscribers for a smoke test.

## 14. Next-work plan: safe order of implementation

### Phase A — Verify and stabilize live R2 archiving

- [ ] Resolve the empty-bucket contradiction using Section 10.
- [ ] Verify one smoke object and at least one real object for each dataset that has source records.
- [ ] Compare parsed object data with the corresponding MongoDB snapshot, not just byte size.
- [ ] Add readback/checksum/schema checks and report actual destination safely.
- [ ] Make archive failures observable separately from website health.
- [ ] Add a durable retry/reconciliation mechanism so failed uploads are retried before live data expires.
- [ ] Prevent older/incomplete concurrent jobs from replacing richer snapshots.
- [ ] Confirm no lifecycle policy unintentionally deletes intended historical archives.
- [ ] Retain secure backups; do not delete MongoDB data after the first successful R2 PUT.

**Done means:** the expected objects are listable/readable using the production configuration, contents are validated, future runs keep them fresh, failures are visible/recoverable, and normal website operation remains intact.

### Phase B — Preserve what already exists

- [ ] Inventory all currently retained MongoDB market-data dates, including data not reachable from the recent index.
- [ ] Reconstruct all chunks correctly and export only market datasets into the archive.
- [ ] Record source counts, IDs, checksums, schema versions, and any incomplete dates.
- [ ] Copy and verify first; do not shorten TTLs or remove source data during the copy.
- [ ] If older backups/exports exist, inventory them with the owner before assuming the exchange is the only remaining source.

This is time-sensitive because recent announcement payloads expire. Nonblocking R2 failure handling protects the live website, but without retries it does not protect long-term history from expiring before it is archived.

### Phase C — Build a separate 2023–present backfill

This is new work. Do not run the current publisher with an enormous `--days` value and call it a historical importer.

- [ ] Build a separate date-range interface with explicit dataset/start/end parameters.
- [ ] Start with a small sample from 2023 and validate source availability, pagination, schemas, and completeness.
- [ ] Respect source access rules, rate limits, and redistribution constraints; verify permitted data access before large ingestion.
- [ ] Keep raw and normalized data distinctions explicit. Decide whether original PDFs must be copied or merely linked.
- [ ] Use stable exchange filing/trade identifiers, deterministic deduplication, and versioned schemas.
- [ ] Make imports resumable and idempotent, with checkpoints and a per-date manifest.
- [ ] Distinguish “verified no records on this date” from “source request failed.”
- [ ] Apply bounded retries/backoff and bounded concurrency.
- [ ] Preserve stronger existing data when a partial source response arrives.
- [ ] Keep historical imports away from live recent indexes, alert dispatch, newsletter sending, and account state.
- [ ] Do not generate AI summaries for years of history by default. Preserve existing summaries and estimate costs before enabling bulk AI work.
- [ ] Estimate total compressed storage and operation/runtime costs from the sample before a full import.

**Done means:** a manifest shows the date coverage per dataset from the agreed 2023 start date through the present, exceptions are documented, data is readable and validated, and rerunning a completed range is safe.

### Phase D — Make the archive usable on the website

- [ ] Design a historical query/index layer. R2 objects do not automatically give the app indexed company/category/date search.
- [ ] Keep live MongoDB queries fast; do not download years of daily files for every page request.
- [ ] Consider small metadata/index records pointing to private R2 objects. Select MongoDB or another index only after measuring size/query needs.
- [ ] Add date-range, company, exchange, and category filters with pagination and sensible defaults.
- [ ] Add a server-side R2 reader using least-privilege access and caching.
- [ ] Preserve authentication/Premium rules; never ship storage credentials to the browser.
- [ ] Display coverage/missing-date status honestly and distinguish historical records from newly filed ones.
- [ ] Keep original source links, summary availability, and source dates visible.
- [ ] Test empty ranges, partial source days, expired sessions, large result sets, and slow/unavailable storage.

Adding Cloudflare D1, Workers, or a full hosting migration is an option to evaluate later, not an existing implementation or mandatory part of this phase.

### Phase E — Reliability, cleanup, and cost review

- [ ] Fix/test the alert delivery-marker concern in Section 7 and define the intended overflow/backlog policy.
- [ ] Review same-day write concurrency and chunk-publication consistency.
- [ ] Expand CI beyond one website auth test.
- [ ] Add archive lag/failed-date monitoring and a tested restore procedure.
- [ ] Confirm all application and worker traffic is independent of Redis, including old deployments and external jobs.
- [ ] Only with verified backups and owner confirmation, complete legacy provider retirement and check final billing.
- [ ] Update older README comments so they no longer contradict current storage, retention, and newsletter behaviour.

## 15. Cost and storage expectations

Cloudflare R2 Standard has included monthly usage, not an unlimited free database. Official pricing checked while preparing this handoff lists **10 GB-month storage, 1 million Class A operations, and 10 million Class B operations** in the free allowance. Above those allowances, Standard rates are **$0.015/GB-month, $4.50/million Class A, and $0.36/million Class B**; billing-unit rounding applies. Internet egress is listed as free. The allowance does not apply to Infrequent Access. Recheck [official R2 pricing](https://developers.cloudflare.com/r2/pricing/) before making a spending decision.

Project-specific costs are not yet measured. A bucket creation screen showing `$0/month` does not cap future usage or prove several years of data will be free.

Practical controls for this project:

- Measure compressed bytes per dataset/day from representative samples, including busy reporting days.
- Estimate JSON-only storage separately from original PDFs, which can be much larger.
- Avoid re-uploading unchanged historical objects once checksum/manifest support exists.
- Keep archive reads bounded and cached; use an index rather than scanning every object.
- Avoid broad historical AI summarisation without an explicit budget.
- Include GitHub job runtime, AI providers, MongoDB, Vercel, and email delivery in total cost estimates.
- Check actual MongoDB/Vercel account plans, capacity, and use terms; this handoff does not certify they can serve unlimited commercial history for free.
- Do not assume a billing alert is a hard spending cap. Verify provider controls before relying on one.

## 16. Migration chronology and commit landmarks

Use Git history for exact diffs; the table records major milestones rather than claiming every one was freshly production-tested.

| Commit | Milestone |
| --- | --- |
| `c49e424` | Company-follow/watchlist feature introduced |
| `e331e97` | Complete MongoDB-only storage cutover |
| `d3ecf1c` | Verify watchlists on MongoDB |
| `1276e59` | Activate MongoDB-backed Telegram alerts |
| `87ed1e9`, `e097349` | Earlier Telegram Web/deep-link fallback changes |
| `db8cd39` | Normalize bot usernames |
| `b86c244` | Replace command-copy/start flow with one-click Telegram login |
| `9a03d16` | Document canonical Telegram login domain |
| `208ba38` | Show saved Telegram connection status |
| `83cb29c` | Watchlist interface improvements |
| `f9b5448` | Remove remaining Upstash runtime credentials |
| `996d318` | Add R2 archive writer and publisher integration |
| `bb7c98f` | Add verification/run changes so R2 checks can run independently of scheduled cancellation |

Earlier business/technical history:

- Upstash free monthly command quota was exhausted. The owner considered paid usage, alternative accounts, reducing requests, and migration.
- OTP/login was separated from Upstash, then the remaining application storage moved to MongoDB.
- Request caching/batching and reduced unnecessary work were part of cost reduction, but no current measured savings percentage is established here.
- The owner tested MongoDB writes through Atlas and reported the website functioning.
- A watchlist feature arrived during migration and was checked/kept on MongoDB.
- Telegram connection problems included bad URLs/duplicated `@`, missing persisted status, and friction around manual commands. The current code reflects subsequent login/status/UI fixes.
- The owner then sought multi-year data retention; a private R2 archive bucket was created and writer code added.
- Repeated empty-bucket screenshots are the unresolved stopping point before this handoff request.

## 17. Safety rules for continuing

1. Never delete or rename `users`, `redis_mirror`, payment collections, the old Redis database, or the R2 bucket just to “start clean.”
2. Do not shorten retention or change TTL indexes until verified copies and an explicit retention decision exist.
3. Back up and compare counts/IDs/content before cutover; test restores, not just exports.
4. Keep source and destination during verification. Preserve rollback compatibility for schemas and chunk formats.
5. Use least-privilege server-side credentials. Never introduce `NEXT_PUBLIC_` storage/database secrets.
6. Do not rotate shared secrets in only one environment or remove the only working access path before testing the replacement.
7. Avoid printing full provider errors if they may include credentials or private records; sanitize logs/evidence.
8. Do not run broadcasts, bulk tests, or alert sends against all real users without specific authorization.
9. Do not treat a green workflow, a document count, a connected banner, or an API-operation counter as full end-to-end proof.
10. Do not promise guaranteed zero loss from the current implementation: retry, locking, retention, and restore gaps must be addressed to meet the owner's requirement.

A safe rollback normally reverts application changes to a known compatible deployment while leaving verified data copies intact. Do not roll back to Redis-dependent code after disconnecting Redis, and do not overwrite newer Git history with a stale local branch.

## 18. Completion checklist for the next developer

- [ ] Confirm current repository/deployment/workflow revisions.
- [ ] Preserve current website, users, payments, watchlists, and MongoDB data.
- [ ] Resolve R2 empty-bucket issue with authenticated logs and readback evidence.
- [ ] Verify production market objects and durable retry/reconciliation.
- [ ] Preserve currently retained history before expiry.
- [ ] Implement and validate bounded historical import for all three datasets.
- [ ] Estimate costs before full import or large AI processing.
- [ ] Implement indexed historical website access without exposing R2 credentials.
- [ ] Test alerts separately from website history; fix marker/error handling.
- [ ] Verify backups, restore, data coverage, and provider retirement before calling migration complete.
- [ ] Record what changed, tests run, remaining unknowns, and owner actions in an updated handoff.

## 19. Ready-to-use continuation brief

> Continue Market Tide from the repository linked in this document. First inspect the current code and deployment state; preserve any work newer than `bb7c98f`. The website and application storage are MongoDB-based, hosted on Vercel. Cloudflare R2 snapshot-writing code exists, but the intended bucket was still empty in the latest supplied screenshot, despite an earlier successful smoke-step result. Diagnose that contradiction from actual logs/configuration and object readback; do not assume a credential cause or claim migration complete. Keep all existing data safe and the live site working. After verified live archiving and preservation of existing retained data, implement a resumable, cost-controlled 2023–present archive for announcements, bulk/block deals, and insider trading, then add efficient authenticated historical browsing/search. Do not replace MongoDB/Vercel, send customer broadcasts, perform destructive cleanup, or start a costly full backfill without the relevant owner decision. Use this handoff's status distinctions, source map, configuration inventory, known limitations, and acceptance checklists. Ask only for genuinely missing access or material product choices; explain progress plainly.

---

**Bottom line:** MongoDB is the inspected live runtime store. R2 archiving is implemented but not yet verified in production. The next priority is proving and stabilizing the archive, followed by safe historical import and website access—not deleting another database or starting another full migration.
