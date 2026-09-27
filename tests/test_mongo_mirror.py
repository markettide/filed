import datetime
import os
import unittest

import mongo_mirror


class FakeCursor(list):
    pass


class FakeCollection:
    def __init__(self):
        self.rows = {}

    def update_one(self, query, update, upsert=False):
        key = query["_id"]
        row = self.rows.setdefault(key, {"_id": key})
        row.update(update.get("$set", {}))
        for field in update.get("$unset", {}):
            row.pop(field, None)

    def delete_many(self, query):
        for key in query["_id"]["$in"]:
            self.rows.pop(key, None)

    def find(self, query, projection):
        now = query["$or"][1]["expiresAt"]["$gt"]
        keys = query["_id"]["$in"]
        return FakeCursor(
            row for key in keys
            if (row := self.rows.get(key))
            and ("expiresAt" not in row or row["expiresAt"] > now)
        )


class MongoStorageTests(unittest.TestCase):
    def setUp(self):
        self.original_uri = os.environ.get("MONGODB_URI")
        os.environ["MONGODB_URI"] = "mongodb://not-used"
        self.collection = FakeCollection()
        mongo_mirror._collection = self.collection

    def tearDown(self):
        mongo_mirror._collection = None
        if self.original_uri is None:
            os.environ.pop("MONGODB_URI", None)
        else:
            os.environ["MONGODB_URI"] = self.original_uri

    def test_set_get_mget_and_delete(self):
        self.assertEqual(mongo_mirror.execute(["SET", "a", "one"]), "OK")
        self.assertEqual(mongo_mirror.execute(["SET", "b", "two"]), "OK")
        self.assertEqual(mongo_mirror.execute(["GET", "a"]), "one")
        self.assertEqual(
            mongo_mirror.execute(["MGET", "a", "missing", "b"]),
            ["one", None, "two"],
        )
        self.assertEqual(mongo_mirror.execute(["DEL", "a", "b"]), 2)
        self.assertEqual(mongo_mirror.execute(["GET", "a"]), None)

    def test_expired_values_are_not_read(self):
        self.collection.rows["old"] = {
            "_id": "old",
            "value": "gone",
            "expiresAt": datetime.datetime.now(datetime.timezone.utc)
            - datetime.timedelta(seconds=1),
        }
        self.assertIsNone(mongo_mirror.execute(["GET", "old"]))


if __name__ == "__main__":
    unittest.main()
