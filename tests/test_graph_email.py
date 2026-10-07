import io
import json
import os
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

import server


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class GraphEmailTests(unittest.TestCase):
    def test_send_graph_email_posts_plain_text_to_signed_in_mailbox(self):
        with patch.object(server, 'get_graph_access_token', return_value='access-token'), \
                patch.object(server.urllib.request, 'urlopen', return_value=FakeResponse()) as urlopen:
            server.send_graph_email('recipient@example.com', 'Test subject', 'Test body')

        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, 'https://graph.microsoft.com/v1.0/me/sendMail')
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(request.get_header('Authorization'), 'Bearer access-token')
        self.assertEqual(request.get_header('Content-type'), 'application/json')
        self.assertEqual(json.loads(request.data), {
            'message': {
                'subject': 'Test subject',
                'body': {'contentType': 'Text', 'content': 'Test body'},
                'toRecipients': [{'emailAddress': {'address': 'recipient@example.com'}}],
            },
        })

    def test_send_graph_email_reports_graph_http_failure(self):
        failure = urllib.error.HTTPError(
            'https://graph.microsoft.com/v1.0/me/sendMail',
            403,
            'Forbidden',
            {},
            io.BytesIO(b''),
        )
        with patch.object(server, 'get_graph_access_token', return_value='access-token'), \
                patch.object(server.urllib.request, 'urlopen', side_effect=failure):
            with self.assertRaisesRegex(RuntimeError, 'HTTP 403'):
                server.send_graph_email('recipient@example.com', 'Test subject', 'Test body')

    def test_get_graph_access_token_refreshes_and_persists_cache(self):
        class FakeCache:
            has_state_changed = True

            def deserialize(self, serialized):
                self.loaded = serialized

            def serialize(self):
                return '{"refreshed": true}'

        class FakeApp:
            def get_accounts(self):
                return [{'username': 'benjamin@example.com'}]

            def acquire_token_silent(self, scopes, account):
                self.scopes = scopes
                self.account = account
                return {'access_token': 'refreshed-token'}

        with tempfile.TemporaryDirectory() as directory:
            cache_path = os.path.join(directory, 'graph-token-cache.json')
            with open(cache_path, 'w', encoding='utf-8') as cache_file:
                cache_file.write('{"existing": true}')
            cache = FakeCache()
            app = FakeApp()
            with patch.dict(os.environ, {
                'SOUNDBOARD_GRAPH_CLIENT_ID': 'client-id',
            }), patch.object(server, 'graph_token_cache_path', return_value=cache_path), \
                    patch.object(server.msal, 'SerializableTokenCache', return_value=cache), \
                    patch.object(server.msal, 'PublicClientApplication', return_value=app):
                token = server.get_graph_access_token()

            self.assertEqual(token, 'refreshed-token')
            self.assertEqual(cache.loaded, '{"existing": true}')
            self.assertEqual(app.scopes, server.GRAPH_SCOPES)
            with open(cache_path, encoding='utf-8') as cache_file:
                self.assertEqual(cache_file.read(), '{"refreshed": true}')


if __name__ == '__main__':
    unittest.main()
