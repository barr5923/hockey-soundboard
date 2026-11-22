import os
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

import server


class RegistrationPasswordConfirmationTests(unittest.TestCase):
    def run_registration(self, body, invite_code='', saved_code=None):
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
                patch.object(server, 'INVITE_CODE', invite_code), \
                patch.object(server, 'get_db', get_test_db):
            server.registration_attempts.clear()
            server.init_db()
            if saved_code:
                with get_test_db() as connection:
                    server.save_registration_code(connection, saved_code)
            handler = server.Handler.__new__(server.Handler)
            handler.headers = {}
            handler.client_address = ('127.0.0.1', 1234)
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
            'invite': 'admin-code',
        }, saved_code='admin-code')

        self.assertEqual(users, [('newuser',)])
        handler.issue_email_verification.assert_called_once()
        self.assertEqual(handler.send_json.call_args.args[0], 200)

    def test_registration_is_closed_without_configured_code(self):
        handler, users = self.run_registration({
            'username': 'newuser',
            'password': 'matching-password',
            'passwordConfirmation': 'matching-password',
            'email': 'user@example.com',
        })

        self.assertEqual(users, [])
        status, payload = handler.send_json.call_args.args[:2]
        self.assertEqual(status, 403)
        self.assertEqual(payload['error'], 'Registration is closed. Contact an administrator for access.')

    def test_rejects_invalid_admin_registration_code(self):
        handler, users = self.run_registration({
            'username': 'newuser',
            'password': 'matching-password',
            'passwordConfirmation': 'matching-password',
            'email': 'user@example.com',
            'invite': 'wrong-code',
        }, saved_code='correct-code')

        self.assertEqual(users, [])
        status, payload = handler.send_json.call_args.args[:2]
        self.assertEqual(status, 403)
        self.assertEqual(payload['error'], 'Invalid registration code.')

    def test_environment_registration_code_remains_supported(self):
        handler, users = self.run_registration({
            'username': 'newuser',
            'password': 'matching-password',
            'passwordConfirmation': 'matching-password',
            'email': 'user@example.com',
            'invite': 'environment-code',
        }, invite_code='environment-code')

        self.assertEqual(users, [('newuser',)])
        self.assertEqual(handler.send_json.call_args.args[0], 200)


if __name__ == '__main__':
    unittest.main()
