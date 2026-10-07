import os
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

import server


class AdminTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, 'users.db')

        @contextmanager
        def get_test_db():
            connection = sqlite3.connect(self.path, timeout=10)
            connection.row_factory = sqlite3.Row
            try:
                with connection:
                    yield connection
            finally:
                connection.close()

        for target, value in (('DB_PATH', self.path), ('INVITE_CODE', ''), ('get_db', get_test_db)):
            patcher = patch.object(server, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        server.init_db()

    def query(self, sql, *args):
        connection = sqlite3.connect(self.path)
        try:
            return connection.execute(sql, args).fetchall()
        finally:
            connection.close()

    def call(self, method, acting_as, body=None):
        handler = server.Handler.__new__(server.Handler)
        handler.headers = {}
        handler.read_json = lambda: body
        handler.send_json = Mock()
        handler.current_user = lambda: acting_as
        getattr(handler, method)()
        return handler.send_json.call_args.args[:2]

    def user(self, username):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            return connection.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        finally:
            connection.close()

    def test_default_admin_seeded_once_with_default_password(self):
        server.init_db()
        row = self.user('admin')
        self.assertEqual(self.query('SELECT COUNT(*) FROM users'), [(1,)])
        self.assertEqual(row['is_admin'], 1)
        self.assertEqual(server.hash_password('admin', row['salt']), row['hash'])

    def test_non_admin_forbidden_and_anonymous_unauthorized(self):
        normal = {'id': 5, 'username': 'x', 'is_admin': 0}
        for method in ('api_admin_users', 'api_admin_set_password', 'api_admin_set_admin', 'api_admin_create_user'):
            self.assertEqual(self.call(method, normal, {})[0], 403)
            self.assertEqual(self.call(method, None, {})[0], 401)

    def test_admin_creates_user_and_sets_password(self):
        admin = self.user('admin')
        status, payload = self.call('api_admin_create_user', admin, {
            'username': 'bob', 'password': 'longenough', 'isAdmin': True})
        self.assertEqual(status, 200)
        bob = self.user('bob')
        self.assertEqual((bob['is_admin'], bob['email']), (1, None))
        self.assertEqual(self.call('api_admin_create_user', admin, {
            'username': 'bob', 'password': 'longenough'})[0], 409)
        self.assertEqual(self.call('api_admin_set_password', admin, {'userId': bob['id'], 'password': 'short'})[0], 400)
        self.assertEqual(self.call('api_admin_set_password', admin, {'userId': bob['id'], 'password': 'new-password'})[0], 200)
        bob = self.user('bob')
        self.assertEqual(server.hash_password('new-password', bob['salt']), bob['hash'])
        users = self.call('api_admin_users', admin)[1]['users']
        self.assertEqual([u['username'] for u in users], ['admin', 'bob'])

    def test_cannot_remove_last_admin(self):
        admin = self.user('admin')
        status, payload = self.call('api_admin_set_admin', admin, {'userId': admin['id'], 'isAdmin': False})
        self.assertEqual(status, 400)
        self.assertEqual(self.user('admin')['is_admin'], 1)
        self.call('api_admin_create_user', admin, {'username': 'bob', 'password': 'longenough'})
        bob = self.user('bob')
        self.assertEqual(self.call('api_admin_set_admin', admin, {'userId': bob['id'], 'isAdmin': True})[0], 200)
        self.assertEqual(self.call('api_admin_set_admin', admin, {'userId': admin['id'], 'isAdmin': False})[0], 200)

    def test_change_password_requires_matching(self):
        admin = self.user('admin')
        handler = server.Handler.__new__(server.Handler)
        handler.headers = {}
        handler.client_address = ('127.0.0.1', 1)
        handler.current_user = lambda: admin
        handler.start_session = Mock(return_value=('Set-Cookie', 'x'))

        def change(body):
            handler.read_json = lambda: body
            handler.send_json = Mock()
            handler.api_change_password()
            return handler.send_json.call_args.args[0]

        self.assertEqual(change({'password': 'new-password', 'passwordConfirmation': 'other-password'}), 400)
        self.assertEqual(change({'password': 'new-password', 'passwordConfirmation': 'other-password'}), 400)
        self.assertEqual(change({'password': 'short', 'passwordConfirmation': 'short'}), 400)
        self.assertEqual(change({'password': 'new-password', 'passwordConfirmation': 'new-password'}), 200)
        row = self.user('admin')
        self.assertEqual(server.hash_password('new-password', row['salt']), row['hash'])


if __name__ == '__main__':    unittest.main()

