import datetime as dt
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from watchlist_news_job import load_companies, load_sources, main
from watchlist_news_phase2 import parse_llm_decision, process_pending_reviews
from watchlist_news_store import _merge_story_documents


class FakeReviewer:
    def __init__(self, decisions):
        self.decisions = list(decisions)

    def configured(self):
        return True

    def review(self, pair):
        value = self.decisions.pop(0)
        if isinstance(value, Exception):
            raise value
        return value


class Phase2Test(unittest.TestCase):
    def test_high_confidence_yes_can_merge(self):
        decision = parse_llm_decision(
            '{"same_event":true,"confidence":0.93,"reason":"Same acquisition"}',
            model="test-model",
        )
        self.assertTrue(decision["sameEvent"])
        self.assertEqual(decision["model"], "test-model")

    def test_low_confidence_yes_does_not_merge(self):
        decision = parse_llm_decision(
            {"same_event": True, "confidence": 0.62, "reason": "Possibly related"}
        )
        self.assertFalse(decision["sameEvent"])

    def test_queue_is_bounded_and_audited(self):
        queue = [{"_id": "a:b"}, {"_id": "c:d"}, {"_id": "e:f"}]
        completed = []
        released = []

        def claim():
            return queue.pop(0) if queue else None

        reviewer = FakeReviewer([
            {"sameEvent": True, "confidence": 0.9, "reason": "same", "model": "fake"},
            ValueError("bad model output"),
        ])
        result = process_pending_reviews(
            reviewer=reviewer,
            maximum=2,
            services={
                "claim": claim,
                "complete": lambda review, decision: completed.append((review, decision)),
                "release": lambda review_id, error: released.append((review_id, str(error))),
            },
        )
        self.assertEqual(result["processed"], 1)
        self.assertEqual(result["merged"], 1)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(len(queue), 1)
        self.assertEqual(completed[0][0]["_id"], "a:b")
        self.assertEqual(released[0][0], "c:d")

    def test_story_merge_preserves_sources_and_articles(self):
        now = dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc)
        merged = _merge_story_documents(
            {
                "articleIds": ["a"],
                "companyKeys": ["fortishealthcare"],
                "title": "Fortis expansion",
                "description": "Short",
                "publishedAt": now,
                "sources": [{"name": "One", "url": "https://one.example/a"}],
            },
            {
                "articleIds": ["b"],
                "companyKeys": ["fortishealthcare"],
                "title": "Fortis announces a major hospital expansion",
                "description": "A longer and more useful description",
                "publishedAt": now + dt.timedelta(hours=1),
                "sources": [{"name": "Two", "url": "https://two.example/b"}],
            },
        )
        self.assertEqual(merged["articleIds"], ["a", "b"])
        self.assertEqual(merged["sourceCount"], 2)
        self.assertEqual(merged["dedupeMethod"], "llm")
        self.assertIn("major hospital", merged["title"])

    def test_empty_source_registry_is_safe(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sources.json"
            path.write_text(json.dumps({"sources": []}), encoding="utf-8")
            self.assertEqual(load_sources(path), [])

    def test_approved_gdelt_registry_loads_free_provider(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sources.json"
            path.write_text(json.dumps({
                "providers": {
                    "gdelt": {
                        "enabled": True,
                        "commercialUseAllowed": True,
                        "termsUrl": "https://www.gdeltproject.org/about.html",
                    }
                },
                "sources": [],
            }), encoding="utf-8")
            sources = load_sources(path)
        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].source_id, "gdelt")

    def test_company_discovery_deduplicates_across_storage_shapes(self):
        class Collection:
            def __init__(self, rows):
                self.rows = rows

            def find(self, *args, **kwargs):
                return list(self.rows)

        class Database:
            def __init__(self):
                self.collections = {
                    "users": Collection([
                        {"watchlist": [{"name": "Fortis Healthcare Ltd", "ticker": "FORTIS"}]},
                        {"watchlistCompanies": [{"company": "Infosys Limited", "symbol": "INFY"}]},
                    ]),
                    "watchlists": Collection([
                        {"companies": [{"name": "Fortis Healthcare Ltd", "ticker": "FORTIS"}]}
                    ]),
                }

            def __getitem__(self, name):
                return self.collections[name]

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("WATCHLIST_NEWS_COMPANIES_JSON", None)
            companies = load_companies(Database())
        self.assertEqual([row["ticker"] for row in companies], ["FORTIS", "INFY"])

    def test_disabled_job_never_reaches_ingestion(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"WATCHLIST_NEWS_ENABLED": "0"}, clear=False), \
                patch("watchlist_news_job.run_ingestion", side_effect=AssertionError(
                    "disabled job attempted ingestion"
                )), redirect_stdout(output):
            self.assertEqual(main(), 0)
        self.assertIn('"enabled": false', output.getvalue().lower())


if __name__ == "__main__":
    unittest.main()

