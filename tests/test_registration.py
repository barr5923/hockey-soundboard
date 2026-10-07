import os
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

import server


class RegistrationPasswordConfirmationTests(unittest.TestCase):
    def run_registration(self, body):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        database_path = os.path.join(temporary_directory.name, 'users.db')
        @contextmanager
        def get_test_db():
            connection = sqlite3.connect(database_path, timeout=10)
            connection.row_factory = sqlite3.Row
            try:
                with connection:
                    yield connection
            finally:
                connection.close()

        with patch.object(server, 'DB_PATH', database_path), \
                patch.object(server, 'INVITE_CODE', ''), \
                patch.object(server, 'get_db', get_test_db):
            server.init_db()
            handler = server.Handler.__new__(server.Handler)
            handler.headers = {}
            handler.read_json = lambda: body
            handler.send_json = Mock()
            handler.issue_email_verification = Mock(return_value=True)
            handler.api_register()

        connection = sqlite3.connect(database_path)
        try:
            users = connection.execute("SELECT username FROM users WHERE username != 'admin'").fetchall()
        finally:
            connection.close()
        return handler, users

    def test_rejects_mismatched_passwords_without_creating_account(self):
        handler, users = self.run_registration({
            'username': 'newuser',
            'password': 'first-password',
            'passwordConfirmation': 'different-password',
            'email': 'user@example.com',
        })

        self.assertEqual(users, [])
        handler.issue_email_verification.assert_not_called()
        status, payload = handler.send_json.call_args.args[:2]
        self.assertEqual(status, 400)
        self.assertEqual(payload['error'], 'Passwords do not match.')

    def test_rejects_missing_confirmation_without_creating_account(self):
        handler, users = self.run_registration({
            'username': 'newuser',
            'password': 'first-password',
            'email': 'user@example.com',
        })

        self.assertEqual(users, [])
        status, payload = handler.send_json.call_args.args[:2]
        self.assertEqual(status, 400)
        self.assertEqual(payload['error'], 'Passwords do not match.')

    def test_creates_account_when_passwords_match(self):
        handler, users = self.run_registration({
            'username': 'newuser',
            'password': 'matching-password',
            'passwordConfirmation': 'matching-password',
            'email': 'user@example.com',
        })

        self.assertEqual(users, [('newuser',)])
        handler.issue_email_verification.assert_called_once()
        self.assertEqual(handler.send_json.call_args.args[0], 200)


if __name__ == '__main__':
    unittest.main()
