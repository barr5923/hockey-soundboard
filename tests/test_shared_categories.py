import os
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

import server


class SharedCategoryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = os.path.join(directory.name, 'users.db')

        @contextmanager
        def get_test_db():
            connection = sqlite3.connect(path, timeout=10)
            connection.row_factory = sqlite3.Row
            try:
                with connection:
                    yield connection
            finally:
                connection.close()

        patcher = patch.object(server, 'get_db', get_test_db)
        patcher.start()
        self.addCleanup(patcher.stop)
        with get_test_db() as conn:
            conn.executescript("""
                CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
                INSERT INTO users VALUES (1, 'alice'), (2, 'bob');
                CREATE TABLE shared_categories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, key TEXT NOT NULL,
                    name TEXT NOT NULL, tracks TEXT NOT NULL, updated REAL NOT NULL, UNIQUE (owner_id, key));
            """)

    def call(self, method, user_id, body=None, path='/api/x'):
        handler = server.Handler.__new__(server.Handler)
        handler.headers = {}
        handler.path = path
        handler.read_json = lambda: body
        handler.send_json = Mock()
        handler.current_user = lambda: {'id': user_id} if user_id else None
        getattr(handler, method)()
        return handler.send_json.call_args.args[:2]

    def publish(self, user_id, tracks):
        return self.call('api_shared_publish', user_id, {'key': 'warmup', 'name': 'Warmup', 'tracks': tracks})

    def test_publish_sanitizes_and_other_users_can_read(self):
        status, payload = self.publish(1, [
            {'name': 'Song', 'spotifyUrl': 'https://open.spotify.com/track/1', 'audioStorageId': 'mp3-1', 'startTime': 5},
            {'name': 'Local only', 'audioStorageId': 'mp3-2'},
            {'name': 'Bad', 'spotifyUrl': 'javascript:alert(1)'},
        ])
        self.assertEqual((status, payload['shared'], payload['skipped']), (200, 1, 2))

        status, listing = self.call('api_shared_list', 2)
        self.assertEqual(status, 200)
        self.assertEqual(listing['categories'][0]['owner'], 'alice')
        self.assertFalse(listing['categories'][0]['mine'])

        status, detail = self.call('api_shared_get', 2, path=f"/api/shared-category?id={listing['categories'][0]['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(detail['tracks'][0]['name'], 'Song')
        self.assertNotIn('audioStorageId', detail['tracks'][0])

    def test_only_owner_can_unshare(self):
        self.publish(1, [{'name': 'Song', 'youtubeUrl': 'https://youtu.be/abc'}])
        self.call('api_shared_unshare', 2, {'key': 'warmup'})
        self.assertEqual(len(self.call('api_shared_list', 2)[1]['categories']), 1)
        self.call('api_shared_unshare', 1, {'key': 'warmup'})
        self.assertEqual(self.call('api_shared_list', 2)[1]['categories'], [])

    def test_requires_login(self):
        self.assertEqual(self.call('api_shared_list', None)[0], 401)
        self.assertEqual(self.publish(None, [])[0], 401)


if __name__ == '__main__':
    unittest.main()
