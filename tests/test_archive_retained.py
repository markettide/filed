import copy
import datetime as dt
import gzip
import io
import json
import pathlib
import re
import sys
import unittest
from contextlib import redirect_stdout

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from tools.archive_retained_market_data import (
    DATASETS, InvalidDay, export_retained, inventory, put_verified, read_array, snapshot,
)

DAY = "2026-09-27"


class Collection:
    """Only find is available: accidental Mongo mutations fail these tests."""
    def __init__(self, docs):
        self.docs = docs

    def find(self, query, projection):
        pattern = re.compile(query['_id']['$regex'])
        return [{k: copy.deepcopy(v) for k, v in row.items() if k in projection}
                for row in self.docs if pattern.fullmatch(row['_id'])]


class Missing(Exception):
    response = {'Error': {'Code': 'NoSuchKey'}}


class Store:
    def __init__(self):
        self.objects = {}
        self.writes = 0
        self.streams = []

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise Missing()
        body = io.BytesIO(self.objects[Key])
        self.streams.append(body)
        return {'Body': body}

    def put_object(self, **kwargs):
        self.writes += 1
        self.objects[kwargs['Key']] = kwargs['Body']


def documents(values):
    return [{'_id': k, 'value': v} for k, v in values.items()]


def announcement_docs():
    return documents({
        f'mt:day:{DAY}': '[{"id":"one"}]', f'mt:day:{DAY}:parts': '1',
        f'mt:all:{DAY}': '[]', f'mt:all:{DAY}:parts': '1',
        f'mt:count:{DAY}': '{"important":1,"other":0}',
    })


class RetainedArchiveTests(unittest.TestCase):
    def export(self, docs, store=None):
        with redirect_stdout(io.StringIO()):
            return export_retained(Collection(docs), list(DATASETS),
                                   client=store, bucket='bucket')

    def test_inventory_excludes_private_and_indexes_and_finds_unindexed_day(self):
        rows = announcement_docs() + documents({
            'mt:brief:2026-09-27:0': 'private', 'mt:insider:index': '[]',
            'user:email': 'private', 'mt:day:2026-99-99': '[]',
            'mt:deals:2023-01-01:0': '[]',
        })
        self.assertEqual(inventory(Collection(rows), list(DATASETS)),
                         [('announcements', DAY), ('bulk-block', '2023-01-01')])

    def test_inventory_date_bounds(self):
        self.assertEqual(inventory(Collection(announcement_docs()), ['announcements'],
                                   '2026-09-28'), [])

    def test_announcement_base_and_counts(self):
        result = snapshot('announcements', DAY, announcement_docs())
        self.assertTrue(result['complete'])
        self.assertEqual(result['normalized']['important'], [{'id': 'one'}])

    def test_chunked_announcements(self):
        key = f'mt:day:{DAY}'
        values = {key+':parts': '2', key+':0': '[1]', key+':1': '[2]'}
        self.assertEqual(read_array(values, key, announcements=True), [1, 2])

    def test_trade_single_chunk_differs_from_announcement_format(self):
        key = f'mt:insider:{DAY}'
        values = {key: '["stale"]', key+':parts': '1', key+':0': '["new"]'}
        self.assertEqual(read_array(values, key), ['new'])

    def test_trade_base_ignores_stale_chunks(self):
        key = f'mt:deals:{DAY}'
        values = {key: '["new"]', key+':parts': '0', key+':0': '["old"]'}
        self.assertEqual(read_array(values, key), ['new'])

    def test_missing_chunk_is_not_silently_dropped(self):
        with self.assertRaises(InvalidDay):
            read_array({'x:parts': '2', 'x:0': '[]'}, 'x')

    def test_missing_marker_with_chunks_is_incomplete(self):
        with self.assertRaises(InvalidDay):
            read_array({'x': '[]', 'x:0': '[]'}, 'x')

    def test_invalid_json_or_part_count_is_not_an_empty_success(self):
        for values in ({'x': '{'}, {'x:parts': '-1'}, {'x:parts': '1.5'},
                       {'x': '{}'}, {'x:parts': '10001'}):
            with self.assertRaises(InvalidDay):
                read_array(values, 'x')

    def test_count_mismatch_keeps_raw_but_not_normalized(self):
        docs = announcement_docs()
        docs[-1]['value'] = '{"important":10,"other":0}'
        result = snapshot('announcements', DAY, docs)
        self.assertFalse(result['complete'])
        self.assertIsNone(result['normalized'])
        self.assertEqual(result['sourceDocuments'], docs)

    def test_dry_run_does_not_require_r2_and_preserves_expired_source(self):
        docs = announcement_docs()
        docs[0]['expiresAt'] = dt.datetime(2020, 1, 1)
        report = self.export(docs)
        self.assertTrue(report['ok'])
        self.assertEqual(report['mode'], 'dry-run')
        self.assertEqual(report['entries'][0]['status'], 'inventoried')
        self.assertEqual(report['entries'][0]['sourceDocuments'], 5)

    def test_copy_is_verified_and_does_not_overwrite_live_keys(self):
        store = Store()
        store.objects['announcements/2026/09/27.json.gz'] = b'live'
        report = self.export(announcement_docs(), store)
        self.assertTrue(report['ok'])
        entry = report['entries'][0]
        payload = json.loads(gzip.decompress(store.objects[entry['objectKey']]))
        self.assertEqual(payload['sourceDocuments'], sorted(announcement_docs(), key=lambda r:r['_id']))
        self.assertEqual(store.objects['announcements/2026/09/27.json.gz'], b'live')
        self.assertTrue(all(s.closed for s in store.streams))

    def test_rerun_reuses_identical_snapshot(self):
        store = Store()
        first = self.export(announcement_docs(), store)
        second = self.export(announcement_docs(), store)
        self.assertEqual(second['entries'][0]['status'], 'already_verified')
        self.assertEqual(first['entries'][0]['objectKey'], second['entries'][0]['objectKey'])

    def test_existing_different_object_is_never_overwritten(self):
        store = Store()
        store.objects['key'] = b'existing'
        with self.assertRaisesRegex(ValueError, 'refusing to overwrite'):
            put_verified(store, 'bucket', 'key', {})
        self.assertEqual(store.writes, 0)

    def test_failed_read_is_not_treated_as_missing(self):
        class Denied(Store):
            def get_object(self, **kwargs):
                raise PermissionError('secret')
        store = Denied()
        with self.assertRaises(PermissionError):
            put_verified(store, 'bucket', 'key', {})
        self.assertEqual(store.writes, 0)

    def test_corrupt_readback_fails(self):
        class Corrupt(Store):
            def put_object(self, **kwargs):
                super().put_object(**kwargs)
                self.objects[kwargs['Key']] = b'wrong'
        with self.assertRaises(ValueError):
            put_verified(Corrupt(), 'bucket', 'key', {})

    def test_incomplete_day_is_preserved_but_not_marked_complete(self):
        docs = announcement_docs()[:-1]
        store = Store()
        report = self.export(docs, store)
        self.assertFalse(report['ok'])
        self.assertEqual(report['entries'][0]['status'], 'copied_verified')
        self.assertFalse(report['entries'][0]['complete'])

    def test_changing_source_is_rejected(self):
        class Changing(Collection):
            def __init__(self):
                super().__init__(announcement_docs())
                self.reads = 0
            def find(self, query, projection):
                if 'value' in projection:
                    self.reads += 1
                    if self.reads == 2:
                        self.docs[0]['value'] = '[]'
                return super().find(query, projection)
        with redirect_stdout(io.StringIO()):
            report = export_retained(Changing(), ['announcements'])
        self.assertFalse(report['ok'])
        self.assertEqual(report['entries'][0]['status'], 'failed')

    def test_empty_inventory_is_not_success(self):
        self.assertFalse(self.export([])['ok'])

    def test_manifest_failure_preserves_partial_progress_report(self):
        class BrokenManifest(Store):
            def put_object(self, **kwargs):
                if '/manifests/' in kwargs['Key']:
                    raise ConnectionError('private error detail')
                super().put_object(**kwargs)
        report = self.export(announcement_docs(), BrokenManifest())
        self.assertFalse(report['ok'])
        self.assertEqual(report['entries'][0]['status'], 'copied_verified')
        self.assertEqual(report['manifestError'], 'ConnectionError')

    def test_invalid_row_shape_is_reported_and_raw_retained(self):
        docs = documents({f'mt:deals:{DAY}': '[1]', f'mt:deals:{DAY}:parts': '0'})
        data = snapshot('bulk-block', DAY, docs)
        self.assertFalse(data['complete'])
        self.assertEqual(data['sourceDocuments'], docs)


if __name__ == '__main__':
    unittest.main()
