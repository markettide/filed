import datetime as dt
import unittest

from watchlist_news_free_sources import (
    FeedPolicy,
    GDELTSource,
    PermittedFeedSource,
    normalize_gdelt_article,
    parse_feed,
)


UTC = dt.timezone.utc
START = dt.datetime(2026, 9, 25, tzinfo=UTC)
END = dt.datetime(2026, 10, 2, tzinfo=UTC)
RSS = b"""<?xml version="1.0"?>
<rss version="2.0"><channel><title>Example newsroom</title>
  <item>
    <title>Fortis Healthcare opens a new hospital</title>
    <description><![CDATA[<p>Fortis added hospital capacity in India.</p>]]></description>
    <link>https://news.example.com/fortis-hospital?utm_source=rss</link>
    <pubDate>Wed, 30 Sep 2026 08:00:00 +0000</pubDate>
  </item>
  <item>
    <title>Unrelated sports result</title>
    <link>https://news.example.com/sport</link>
    <pubDate>Wed, 30 Sep 2026 09:00:00 +0000</pubDate>
  </item>
</channel></rss>"""


def policy(**overrides):
    values = {
        "source_id": "example",
        "source_name": "Example Newsroom",
        "feed_url": "https://news.example.com/feed.xml",
        "terms_url": "https://news.example.com/terms",
        "allowed_domains": ("news.example.com",),
        "commercial_use_allowed": True,
        "enabled": True,
    }
    values.update(overrides)
    return FeedPolicy(**values)


class FakeResponse:
    def __init__(self, status=200, content=RSS, headers=None, json_body=None):
        self.status_code = status
        self.content = content
        self.headers = headers or {}
        self.json_body = json_body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self.json_body


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


class SequenceSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.responses.pop(0)


class FreeNewsSourceTest(unittest.TestCase):
    def test_enabled_feed_requires_commercial_permission(self):
        with self.assertRaises(ValueError):
            policy(commercial_use_allowed=False).validate()

    def test_rss_is_normalized_and_filtered_by_company(self):
        rows = parse_feed(
            RSS,
            policy(),
            [{"name": "Fortis Healthcare Limited", "ticker": "FORTIS"}],
            START,
            END,
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["companyKeys"], ["fortishealthcare"])
        self.assertEqual(rows[0]["url"], "https://news.example.com/fortis-hospital")
        self.assertNotIn("<p>", rows[0]["description"])

    def test_article_domain_must_match_policy(self):
        changed = RSS.replace(b"news.example.com/fortis-hospital", b"blocked.example/fortis")
        rows = parse_feed(
            changed,
            policy(),
            [{"name": "Fortis Healthcare"}],
            START,
            END,
        )
        self.assertEqual(rows, [])

    def test_etag_and_last_modified_are_reused(self):
        session = FakeSession(FakeResponse(headers={"ETag": '"v2"'}))
        source = PermittedFeedSource(policy(), session=session)
        result = source.fetch(
            [{"name": "Fortis Healthcare"}],
            START,
            END,
            cache={"etag": '"v1"', "lastModified": "yesterday"},
        )
        headers = session.calls[0][1]["headers"]
        self.assertEqual(headers["If-None-Match"], '"v1"')
        self.assertEqual(headers["If-Modified-Since"], "yesterday")
        self.assertEqual(result["cache"]["etag"], '"v2"')

    def test_304_does_not_reparse_feed(self):
        source = PermittedFeedSource(
            policy(), session=FakeSession(FakeResponse(status=304, content=b""))
        )
        result = source.fetch([], START, END, cache={"etag": '"v1"'})
        self.assertTrue(result["notModified"])
        self.assertEqual(result["articles"], [])

    def test_gdelt_metadata_is_normalized_without_article_content(self):
        row = normalize_gdelt_article(
            {
                "url": "https://publisher.example/fortis?utm_source=gdelt",
                "title": "Fortis Healthcare announces hospital expansion",
                "seendate": "20260930T080000Z",
                "socialimage": "https://publisher.example/image.jpg",
                "domain": "publisher.example",
                "language": "English",
            },
            [{"name": "Fortis Healthcare Limited", "ticker": "FORTIS"}],
            START,
            END,
        )
        self.assertEqual(row["provider"], "gdelt")
        self.assertEqual(row["description"], "")
        self.assertTrue(row["attributionRequired"])
        self.assertEqual(row["url"], "https://publisher.example/fortis")

    def test_gdelt_queries_companies_separately_and_deduplicates_urls(self):
        payload = {"articles": [{
            "url": "https://publisher.example/fortis",
            "title": "Fortis Healthcare announces hospital expansion",
            "seendate": "20260930T080000Z",
            "domain": "publisher.example",
            "language": "English",
        }]}
        session = FakeSession(FakeResponse(json_body=payload))
        source = GDELTSource(
            session=session,
            maximum=25,
            max_batches=2,
            request_interval_seconds=0,
        )
        result = source.fetch(
            [{"name": "Fortis Healthcare"}, {"name": "Infosys Limited"}],
            START,
            END,
        )
        self.assertEqual(len(session.calls), 2)
        self.assertEqual(len(result["articles"]), 1)
        params = session.calls[0][1]["params"]
        self.assertIn('"Fortis Healthcare"', params["query"])
        self.assertIn("sourcecountry:IN", params["query"])
        second = session.calls[1][1]["params"]
        self.assertIn('"Infosys Limited"', second["query"])

    def test_gdelt_honors_429_and_retries_once(self):
        delays = []
        session = SequenceSession([
            FakeResponse(status=429, headers={"Retry-After": "7"}),
            FakeResponse(json_body={"articles": []}),
        ])
        source = GDELTSource(
            session=session,
            max_batches=1,
            request_interval_seconds=0,
            sleeper=delays.append,
        )
        result = source.fetch([{"name": "Fortis Healthcare"}], START, END)
        self.assertEqual(len(session.calls), 2)
        self.assertEqual(delays, [7.0])
        self.assertEqual(result["errors"], [])

    def test_gdelt_rotates_one_company_using_saved_cursor(self):
        session = SequenceSession([
            FakeResponse(json_body={"articles": []}),
            FakeResponse(json_body={"articles": []}),
        ])
        source = GDELTSource(
            session=session,
            max_batches=1,
            request_interval_seconds=0,
        )
        companies = [{"name": "Fortis Healthcare"}, {"name": "Infosys Limited"}]
        first = source.fetch(companies, START, END)
        second = source.fetch(companies, START, END, cache=first["cache"])
        self.assertIn('"Fortis Healthcare"', session.calls[0][1]["params"]["query"])
        self.assertIn('"Infosys Limited"', session.calls[1][1]["params"]["query"])
        self.assertEqual(second["cache"]["nextCompanyIndex"], 0)


if __name__ == "__main__":
    unittest.main()

