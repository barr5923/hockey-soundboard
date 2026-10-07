import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

import server

PLAYLISTS = server.DEFAULT_BOARD_PLAYLISTS_KEY
GRID = 'hockey-soundboard-category-grid-v2'


class DefaultBoardTests(unittest.TestCase):
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

        self.get_db = get_test_db
        patcher = patch.object(server, 'get_db', get_test_db)
        patcher.start()
        self.addCleanup(patcher.stop)
        with get_test_db() as conn:
            conn.executescript("""
                CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, is_admin INTEGER NOT NULL DEFAULT 0);
                INSERT INTO users VALUES (1, 'ben', 1), (2, 'craig', 0);
                CREATE TABLE user_data (user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
                                        PRIMARY KEY (user_id, key));
            """)
            ben_playlists = {
                'built-in-sounds': [{'name': 'Horn'}],
                'our-goal-songs': [{'name': 'A', 'played': True}, {'name': 'B', 'played': False}],
                'warmup': [{'name': 'C', 'played': True}],
            }
            conn.executemany('INSERT INTO user_data VALUES (?, ?, ?)', [
                (1, PLAYLISTS, json.dumps(ben_playlists)),
                (1, GRID, '{"our-goal-songs":{"w":1,"h":7}}'),
                (1, 'hockey-soundboard-settings-v1', '{"spotifyAccessToken":"secret"}'),
                (2, PLAYLISTS, '{"our-goal":[]}'),
                (2, 'hockey-soundboard-settings-v1', '{"soundboardName":"Craig"}'),
            ])

    def call(self, method, user, body=None):
        handler = server.Handler.__new__(server.Handler)
        handler.headers = {}
        handler.read_json = lambda: body
        handler.send_json = Mock()
        def require_admin():
            if user and user.get('is_admin'):
                return user
            handler.send_json(403, {'error': 'Admin access required.'})
            return None
        handler.require_admin = require_admin
        getattr(handler, method)()
        return handler.send_json.call_args.args[:2]

    def data(self, user_id):
        with self.get_db() as conn:
            rows = conn.execute('SELECT key, value FROM user_data WHERE user_id = ?', (user_id,)).fetchall()
        return {row['key']: row['value'] for row in rows}

    def test_save_snapshot_resets_played_and_excludes_settings(self):
        ben = {'id': 1, 'username': 'ben', 'is_admin': 1}
        status, payload = self.call('api_admin_save_default_board', ben)
        self.assertEqual(status, 200)
        self.assertEqual((payload['categoryCount'], payload['songCount'], payload['savedBy']), (2, 3, 'ben'))
        with self.get_db() as conn:
            board = server.read_default_board(conn)
        self.assertEqual(set(board['data']), {PLAYLISTS, GRID})
        playlists = json.loads(board['data'][PLAYLISTS])
        self.assertFalse(any(track.get('played') for tracks in playlists.values() for track in tracks))
        self.assertIn('"played": true', self.data(1)[PLAYLISTS])

    def test_apply_replaces_categories_but_keeps_other_settings(self):
        ben = {'id': 1, 'username': 'ben', 'is_admin': 1}
        status, payload = self.call('api_admin_apply_default_board', ben, {'userId': 2})
        self.assertEqual(status, 400)
        self.call('api_admin_save_default_board', ben)
        status, payload = self.call('api_admin_apply_default_board', ben, {'userId': 2})
        self.assertEqual(status, 200)
        craig = self.data(2)
        self.assertIn('our-goal-songs', json.loads(craig[PLAYLISTS]))
        self.assertEqual(craig[GRID], '{"our-goal-songs":{"w":1,"h":7}}')
        self.assertEqual(craig['hockey-soundboard-settings-v1'], '{"soundboardName":"Craig"}')
        self.assertEqual(self.call('api_admin_apply_default_board', ben, {'userId': 99})[0], 404)

    def test_non_admin_cannot_save_or_apply(self):
        craig = {'id': 2, 'username': 'craig', 'is_admin': 0}
        self.assertEqual(self.call('api_admin_save_default_board', craig)[0], 403)
        self.assertEqual(self.call('api_admin_apply_default_board', craig, {'userId': 1})[0], 403)

    def test_save_without_categories_fails(self):
        with self.get_db() as conn:
            conn.execute('DELETE FROM user_data WHERE user_id = 1')
        status, payload = self.call('api_admin_save_default_board', {'id': 1, 'username': 'ben', 'is_admin': 1})
        self.assertEqual(status, 400)
        self.assertIn('no saved categories', payload['error'])

    def test_new_user_gets_board_only_when_saved(self):
        with self.get_db() as conn:
            self.assertFalse(server.apply_default_board(conn, 2))
        self.call('api_admin_save_default_board', {'id': 1, 'username': 'ben', 'is_admin': 1})
        with self.get_db() as conn:
            conn.execute("INSERT INTO users VALUES (3, 'newbie', 0)")
            self.assertTrue(server.apply_default_board(conn, 3))
        self.assertEqual(set(self.data(3)), {PLAYLISTS, GRID})


if __name__ == '__main__':
    unittest.main()
