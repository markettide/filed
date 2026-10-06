# Watchlist company news - phased implementation

## Product goal

For every company in a user's watchlist, show two separate seven-day feeds:

1. Official NSE/BSE announcements.
2. Reputable external news coverage, with duplicate reports grouped into one story.

Only the title, short provider snippet, source, publication time and original
publisher link should be displayed. Full publisher articles must not be copied.

## Phase 1 - foundation (implemented)

- Provider-neutral article shape.
- GNews search adapter, disabled until `GNEWS_API_KEY` is configured.
- One combined OR query for up to five companies to control provider requests.
- Company relevance check to reject unrelated results.
- URL canonicalization and exact duplicate removal.
- High-confidence lexical story grouping.
- Borderline pairs kept separate and queued for LLM comparison.
- MongoDB story and review collections with TTL/index definitions.
- Fourteen-day internal retention and seven-day product window.
- Offline unit tests; nothing is visible to customers yet.

## Phase 2 - LLM event comparison and ingestion job (implemented, disabled)

- Add a small JSON-schema LLM prompt using the existing Groq/Gemini/OpenRouter keys.
- Compare only `reviewPairs`, never every article pair.
- Merge only when the model says both articles describe the same real-world event.
- Record the model, confidence, reason and compared article IDs.
- Add a scheduled discovery command and daily/provider request budgets.
- Add provider health, empty-result and stale-news monitoring.

Phase 2 is protected by two switches: the GitHub repository variable
`WATCHLIST_NEWS_ENABLED` must equal `1`, and every feed must be separately
approved and enabled in `watchlist_news_sources.json`. GDELT is the only
enabled provider for the private trial. Pushing the code alone does not start
collection because the repository switch remains off.

LLM review is disabled by default for the zero-cost private trial. It can later
be enabled with an explicit per-run cap. Exact and
high-confidence lexical duplicates never use an LLM call. A model response can
merge stories only when it returns `same_event: true` with at least 0.80
confidence; invalid or failed responses are released for a later retry.

## Phase 3 - API and watchlist UI

- Add an authenticated `/api/watchlist/news` endpoint.
- Read the user's MongoDB watchlist server-side; never trust company IDs from the browser.
- Return the last seven days, newest first, with pagination.
- Add an `Announcements | News` control on the watchlist page.
- Show one representative headline plus `Covered by N sources` and publisher links.
- Clearly label external coverage and preserve the original-source link.

## Phase 4 - production hardening

- Introduce a second licensed provider only if coverage measurements justify it.
- Add source-quality controls, blocked domains and correction/removal handling.
- Add admin visibility for provider usage, duplicate rate and LLM review volume.
- Add cost ceilings, circuit breakers, retries and a reconciliation job.
- Evaluate personalized ranking only after coverage and duplicate quality are measured.

## Source decision - zero-cost first

Market Tide will start with explicitly permitted RSS/Atom feeds and public
company, exchange and government newsroom sources. Every enabled source must
record its terms URL, allowed domains and confirmed commercial-use permission.
The collector does not open article pages, bypass paywalls or CAPTCHAs, or copy
full articles. It stores a headline, short feed snippet, source, time and link.

The GNews adapter remains optional and disabled. A paid aggregation provider
will be considered only after free-source coverage has been measured and a
material gap has been demonstrated.

### First approved source: GDELT

GDELT DOC 2.0 is enabled in the source registry for private testing. GDELT's
official terms allow unlimited commercial use without a fee, with attribution
and a link to The GDELT Project. Market Tide stores only GDELT discovery
metadata (headline, publisher domain, timestamp, image URL and original link),
never downloads the publisher article, and records the required attribution.

Companies are queried separately so a high-volume name cannot hide results for
the other watchlist entries. Initial discovery is restricted to India-originating
publishers, with 25 results and one company per hourly run. A persisted cursor
rotates through the unique watchlist companies; a five-company watchlist is
therefore fully refreshed within five hours while making only one GDELT request
per run. The collector honors GDELT's `Retry-After` response and retries a
throttled request once. The scheduled job
remains globally disabled until private testing is
explicitly activated through `WATCHLIST_NEWS_ENABLED=1`.

