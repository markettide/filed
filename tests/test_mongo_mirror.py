import datetime
import unittest

import mongo_mirror


class MongoMirrorTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.datetime(2026, 9, 26, tzinfo=datetime.timezone.utc)

    def test_expiry_seconds(self):
        got = mongo_mirror._expiry(["SET", "key", "value", "EX", "90"], self.now)
        self.assertEqual(got, self.now + datetime.timedelta(seconds=90))

    def test_expiry_milliseconds(self):
        got = mongo_mirror._expiry(["SET", "key", "value", "PX", "1500"], self.now)
        self.assertEqual(got, self.now + datetime.timedelta(milliseconds=1500))

    def test_no_expiry(self):
        self.assertIsNone(mongo_mirror._expiry(["SET", "key", "value"], self.now))


if __name__ == "__main__":
    unittest.main()
