import gzip
import io
import json
import os
import pathlib
import sys
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import r2_archive
from tools import check_r2_archive


class FakeR2:
    def __init__(self):
        self.calls = []

    def put_object(self, **kwargs):
        self.calls.append(kwargs)

    def get_object(self, **kwargs):
        uploaded = next(call for call in reversed(self.calls)
                        if call['Bucket'] == kwargs['Bucket'] and call['Key'] == kwargs['Key'])
        self.stream = io.BytesIO(uploaded['Body'])
        return {'Body': self.stream}


class BrokenR2:
    def put_object(self, **kwargs):
        raise ConnectionError("temporary outage")


class R2ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.original = {name: os.environ.get(name)
                         for name in r2_archive.REQUIRED_ENV}
        os.environ.update({
            "R2_ACCOUNT_ID": "a" * 32,
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

    def test_account_id_rejects_endpoint_url_without_echoing_it(self):
        value = 'https://' + 'a' * 32 + '.r2.cloudflarestorage.com'
        os.environ['R2_ACCOUNT_ID'] = value
        with self.assertRaisesRegex(ValueError, 'not the endpoint URL') as error:
            r2_archive.configuration()
        self.assertNotIn(value, str(error.exception))

    def test_settings_trim_whitespace(self):
        os.environ['R2_ACCOUNT_ID'] = '  ' + 'a' * 32 + '\n'
        os.environ['R2_BUCKET_NAME'] = ' market-tide-archive '
        settings = r2_archive.configuration()
        self.assertEqual(settings['R2_ACCOUNT_ID'], 'a' * 32)
        self.assertEqual(settings['R2_BUCKET_NAME'], 'market-tide-archive')

    def test_whitespace_only_secret_is_missing(self):
        os.environ['R2_SECRET_ACCESS_KEY'] = ' \n '
        self.assertFalse(r2_archive.configured())
        with self.assertRaisesRegex(ValueError, 'R2_SECRET_ACCESS_KEY'):
            r2_archive.configuration()

    def test_readback_matches_payload_and_closes_response(self):
        payload = {'schema': 1, 'items': [{'id': 'one'}]}
        r2_archive.archive_json('system', '2026-09-28', payload, log=lambda *_: None)
        self.assertTrue(r2_archive.verify_json('system', '2026-09-28', payload))
        self.assertTrue(self.fake.stream.closed)

    def test_readback_rejects_changed_payload_and_closes_response(self):
        r2_archive.archive_json('system', '2026-09-28', {'id': 'one'}, log=lambda *_: None)
        with self.assertRaisesRegex(ValueError, 'did not match'):
            r2_archive.verify_json('system', '2026-09-28', {'id': 'two'})
        self.assertTrue(self.fake.stream.closed)

    def test_smoke_check_verifies_upload_and_readback(self):
        with redirect_stdout(io.StringIO()) as output:
            self.assertEqual(check_r2_archive.main(), 0)
        self.assertIn('upload and readback', output.getvalue())
        self.assertTrue(self.fake.stream.closed)

    def test_smoke_check_invalid_account_does_not_upload(self):
        os.environ['R2_ACCOUNT_ID'] = 'https://wrong-endpoint.example'
        with redirect_stdout(io.StringIO()) as output:
            self.assertEqual(check_r2_archive.main(), 1)
        self.assertIn('32-character', output.getvalue())
        self.assertEqual(self.fake.calls, [])

    def test_smoke_check_fails_if_readback_fails(self):
        with patch.object(check_r2_archive, 'verify_json', side_effect=PermissionError('private detail')):
            with redirect_stdout(io.StringIO()) as output:
                self.assertEqual(check_r2_archive.main(), 1)
        self.assertIn('readback failed', output.getvalue())
        self.assertNotIn('private detail', output.getvalue())


if __name__ == "__main__":
    unittest.main()
