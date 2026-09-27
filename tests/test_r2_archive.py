import gzip
import json
import os
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import r2_archive


class FakeR2:
    def __init__(self):
        self.calls = []

    def put_object(self, **kwargs):
        self.calls.append(kwargs)


class BrokenR2:
    def put_object(self, **kwargs):
        raise ConnectionError("temporary outage")


class R2ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.original = {name: os.environ.get(name)
                         for name in r2_archive.REQUIRED_ENV}
        os.environ.update({
            "R2_ACCOUNT_ID": "account",
            "R2_ACCESS_KEY_ID": "access",
            "R2_SECRET_ACCESS_KEY": "secret",
            "R2_BUCKET_NAME": "market-tide-archive",
        })
        self.fake = FakeR2()
        r2_archive._client = self.fake

    def tearDown(self):
        r2_archive._client = None
        for name, value in self.original.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def test_archive_is_compressed_bucket_scoped_and_date_partitioned(self):
        payload = {"schema": 1, "day": "2026-09-27", "items": [{"id": "x"}]}
        self.assertTrue(r2_archive.archive_json(
            "announcements", "2026-09-27", payload, log=lambda *_: None
        ))
        call = self.fake.calls[0]
        self.assertEqual(call["Bucket"], "market-tide-archive")
        self.assertEqual(call["Key"], "announcements/2026/09/27.json.gz")
        self.assertEqual(call["ContentEncoding"], "gzip")
        self.assertEqual(json.loads(gzip.decompress(call["Body"])), payload)

    def test_missing_credentials_skips_without_touching_r2(self):
        os.environ.pop("R2_SECRET_ACCESS_KEY")
        self.assertFalse(r2_archive.archive_json(
            "announcements", "2026-09-27", {}, log=lambda *_: None
        ))
        self.assertEqual(self.fake.calls, [])

    def test_upload_failure_does_not_raise(self):
        r2_archive._client = BrokenR2()
        messages = []
        self.assertFalse(r2_archive.archive_json(
            "bulk-block", "2026-09-27", {"deals": []}, log=messages.append
        ))
        self.assertIn("R2 archive warning", messages[0])


if __name__ == "__main__":
    unittest.main()
