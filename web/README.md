# Waitlist site

A one-page Next.js site that collects email signups. Deploys to Vercel.

## Run it locally

```bash
npm install --prefix web
```

```bash
npm run dev --prefix web
```

Then open http://localhost:3000. Locally, signups append to
`web/waitlist.local.jsonl` — that file is gitignored.

## Deploy to Vercel

Import the repo at [vercel.com/new](https://vercel.com/new) and set
**Root Directory** to `web`. Everything else is detected automatically.

### Member access

Dashboard and Daily Brief use passwordless email verification. Configure these
private environment variables in Vercel for Production, Preview and Development:

- `MONGODB_URI` — MongoDB connection string used for reader profiles
- `MONGODB_DB` — optional database name; defaults to `market_tide`
- `AUTH_SECRET` — a long random value used to sign sessions and OTP hashes
- `RESEND_API_KEY` — current transactional provider key; this will be replaced by Brevo for OTP
- `RESEND_FROM` — verified sender; defaults to `Market Tide <brief@markettide.in>`
- `REPLY_TO_EMAIL` — reply destination; defaults to `market.tide27@gmail.com`
- `KIT_API_KEY` — Kit V4 API key used to add each explicit newsletter signup to the Kit audience
- `KIT_FROM_EMAIL` — verified Kit sender address; defaults to `brief@markettide.in`
- `KV_REST_API_URL` and `KV_REST_API_TOKEN` — Upstash Redis used for market data and briefs
- `CRON_SECRET` — random value of at least 16 characters; Vercel sends it to the cron route
- `GITHUB_DISPATCH_TOKEN` — GitHub token with Actions write access, used only to start the PDF worker
- `ADMIN_PATH_TOKEN` — long random token used in the private `/control/<token>` URL
- `ADMIN_PASSWORD` — password required before any admin data is returned
- `ADMIN_SESSION_SECRET` — optional separate secret for the 12-hour admin session; falls back to `AUTH_SECRET`

New readers enter email and mobile number, then verify the email with a six-digit
code. Their normalized mobile number is stored in MongoDB only after successful
verification. Returning readers enter only their email, and a signed session
keeps them logged in for 30 days.

`SESSION_VERSION` is embedded in every signed login cookie. Changing it signs
out every account on the next request. The Premium-trial launch includes a new
default version, so cookies created by earlier deployments are rejected and all
readers must sign in again once.

The Daily Brief page uses a Market Tide-owned signup form. After the member signs
in and explicitly subscribes, the server saves the subscription in MongoDB first
and upserts the address into the Kit audience. The Kit operation is idempotent,
so subscribing twice does not create duplicate subscribers.

### Cashfree sandbox checkout

Each verified account can start one card-free seven-day Premium trial. Trial
access expires automatically; the Daily Brief stays free while the dashboard,
insider-trading and bulk/block-deal tools lock. A reader may purchase Premium
during the trial or wait until it ends. An early purchase starts the paid
three-month term immediately after Cashfree verifies the payment.

The paid Premium plan is a one-time ₹299 payment for three months of access,
with no automatic renewal. Add the Payment Gateway test App ID and Secret Key
to `.env.local`, set `CASHFREE_ENV=sandbox`, and open `/pricing`. Orders are
created on the server, so the price and secret key are never trusted to the
browser.

Cashfree returns the customer to `/payment/return`, where the server checks the
order directly before enabling Premium. `/api/payments/webhook` provides the
same verified activation path for deployed environments. Webhook signatures
are checked against the untouched request body, and duplicate payment events do
not extend the same order twice.

Cashfree cannot deliver a webhook to localhost without a public tunnel. The
server-side return check makes the complete successful-payment flow testable
locally; use a Vercel preview URL or a secure tunnel when testing webhook
delivery itself.

To create a one-time CSV containing only explicit Daily Brief subscribers, run:

```bash
npm run export:substack
```

The default export includes only records whose subscription source is `brief`.
After manually confirming that an older landing form clearly promised the Daily
Brief, include those records with `SUBSTACK_IMPORT_SOURCES=brief,landing`.

### Morning brief schedule

Vercel Cron calls `/api/cron/brief` at `02:00 UTC`, which is `07:30 IST`.
GitHub Actions no longer owns the schedule; it remains only the PDF-building
worker dispatched by that Vercel endpoint. Cron jobs become active after a
production deployment containing `vercel.json`.

Vercel Pro invokes cron jobs with per-minute precision. On Vercel Hobby, a
daily cron may run anywhere within the scheduled hour, so an exact 07:30
delivery requires Pro or another precise clock.

### Analytics

The root layout includes Vercel Web Analytics. Enable Web Analytics once in the
Vercel project dashboard, then redeploy to begin collecting anonymous page-view
statistics.

## Where the emails go

MongoDB is the durable user/profile and traffic database. Existing Redis
visitor totals are captured once as a baseline during deployment so public
counters do not reset. Upstash Redis continues to hold the published market
snapshots, brief PDFs and mailing list. Market-data readers reuse each snapshot
for one minute to avoid charging Redis repeatedly for identical responses.

### Redis to MongoDB migration

Market-data publishers can dual-write successful Redis `SET` and `DEL`
operations into MongoDB's isolated `redis_mirror` collection. Add
`MONGODB_URI` and `MONGODB_DB` to the GitHub repository secrets to enable the
mirror. Redis remains the source of truth during this stage.

Inventory the market keys without writing anything:

```bash
python tools/migrate_redis_to_mongo.py
```

Copy and verify them without deleting or changing Redis:

```bash
python tools/migrate_redis_to_mongo.py --write --verify
```

After the initial copy and dual writes have been observed, set
`MONGO_MIRROR_REQUIRED=1` in the publishing workflows before switching reads.
That makes any missed MongoDB write fail visibly rather than silently relying
on Redis. Once `MONGODB_URI` is configured, MongoDB becomes the preferred
market-data reader, while any missing or expired mirror value automatically
falls back to Redis. Set `MONGO_MARKET_READS=0` in Vercel for an immediate
Redis-only rollback if required.

**Upstash Redis (recommended).** In your Vercel project go to Storage → Upstash
Redis → Create. It injects `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` for you. The mailing list de-duplicates emails
automatically.

**Any webhook.** Set `WAITLIST_WEBHOOK_URL` to a Google Apps Script, Zapier,
Make, Slack or Discord endpoint. Each signup is POSTed as JSON.

## Getting your list out

Set an `ADMIN_KEY` environment variable, then visit:

```
https://yoursite.vercel.app/api/waitlist/export?key=YOUR_ADMIN_KEY
```

That downloads a CSV. Without `ADMIN_KEY` set the endpoint returns 404, so it's
off by default rather than open to the world.

`GET /api/waitlist` returns the signup count — handy if you want to show
"join 400 others" on the page later.

## Changing the copy

Everything you'd want to edit is at the top of `app/page.jsx`:

- `SITE` — the name and the headline numbers.
- `SAMPLES` — the example summary cards. These are real output from the
  scraper; swap in fresher ones as you go.

The name lives in `SITE.name` in `app/page.jsx` and in the
`metadata` block in `app/layout.jsx`.

## Spam handling

There's a hidden honeypot field. Bots fill it in, people can't see it, and
anything that fills it gets a success response without being stored. Emails are
lowercased and trimmed before saving, so `A@B.com` and `a@b.com` are one person.
