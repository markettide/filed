import datetime as dt
import unittest

from watchlist_news import (
    canonical_url,
    cluster_articles,
    company_key,
    normalize_gnews_article,
    relevance,
)


UTC = dt.timezone.utc


def article(article_id, title, description, hour, url, companies=("reliance",)):
    return {
        "id": article_id,
        "title": title,
        "description": description,
        "url": url,
        "imageUrl": "",
        "sourceName": "Test News",
        "publishedAt": dt.datetime(2026, 10, 1, hour, tzinfo=UTC),
        "companyKeys": list(companies),
    }


class WatchlistNewsTest(unittest.TestCase):
    def test_canonical_url_removes_tracking(self):
        self.assertEqual(
            canonical_url("https://www.example.com/story/?utm_source=x&id=7#top"),
            "https://example.com/story?id=7",
        )

    def test_company_key_removes_legal_suffixes(self):
        self.assertEqual(company_key("Reliance Industries Limited"), "reliance")

    def test_gnews_normalization_and_relevance(self):
        row = normalize_gnews_article({
            "title": "Reliance Industries announces new investment",
            "description": "The company announced the plan on Wednesday.",
            "url": "https://news.example/reliance?utm_medium=rss",
            "publishedAt": "2026-10-01T08:00:00Z",
            "source": {"name": "Example News", "url": "https://news.example"},
        })
        self.assertEqual(row["provider"], "gnews")
        self.assertEqual(
            relevance(row, [{"name": "Reliance Industries Ltd", "ticker": "RELIANCE"}]),
            ["reliance"],
        )

    def test_same_url_is_one_story(self):
        left = article("a", "Reliance wins solar order", "Order is worth Rs 500 crore", 8,
                       "https://one.example/story")
        right = article("b", "Reliance solar order update", "A Rs 500 crore order was won", 9,
                        "https://one.example/story")
        result = cluster_articles([left, right])
        self.assertEqual(len(result["stories"]), 1)
        self.assertEqual(result["stories"][0]["sourceCount"], 1)

    def test_near_duplicate_headlines_merge(self):
        left = article("a", "Reliance wins large solar power order",
                       "Reliance has received a solar power order worth Rs 500 crore", 8,
                       "https://one.example/a")
        right = article("b", "Reliance wins large solar power order",
                        "The solar power order received by Reliance is worth Rs 500 crore", 9,
                        "https://two.example/b")
        result = cluster_articles([left, right])
        self.assertEqual(len(result["stories"]), 1)
        self.assertEqual(result["stories"][0]["sourceCount"], 2)
        self.assertEqual(result["stories"][0]["dedupeMethod"], "heuristic")

    def test_borderline_pair_is_queued_for_llm_not_merged(self):
        left = article("a", "Reliance plans major retail expansion",
                       "The group plans new stores across India", 8,
                       "https://one.example/a")
        right = article("b", "New investment planned by Reliance retail arm",
                        "Reliance will expand stores in several Indian cities", 9,
                        "https://two.example/b")
        result = cluster_articles([left, right])
        self.assertEqual(len(result["stories"]), 2)
        self.assertEqual(len(result["reviewPairs"]), 1)
        self.assertEqual(result["reviewPairs"][0]["leftArticle"]["id"], "a")
        self.assertEqual(result["reviewPairs"][0]["rightArticle"]["id"], "b")

    def test_different_events_are_not_merged(self):
        left = article("a", "Reliance reports quarterly profit growth",
                       "Quarterly revenue and profit increased", 8,
                       "https://one.example/a")
        right = article("b", "Reliance appoints new finance chief",
                        "A new chief financial officer was appointed", 9,
                        "https://two.example/b")
        result = cluster_articles([left, right])
        self.assertEqual(len(result["stories"]), 2)
        self.assertEqual(result["reviewPairs"], [])


if __name__ == "__main__":
    unittest.main()

